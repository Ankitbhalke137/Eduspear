const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// Serve the static React production files
app.use(express.static(path.join(__dirname, '../client/build')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7, // 10MB payload size limit for files
  pingTimeout: 60000,
  pingInterval: 25000,
});

// --- File-Based Persistence Paths ---
const DB_USERS_PATH = path.join(__dirname, 'db_users.json');
const DB_CHATS_PATH = path.join(__dirname, 'db_chats.json');
const LOG_FILE = path.join(__dirname, 'chat_history.log');

// --- Load Persisted Data ---
function loadJSON(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err.message);
  }
  return defaultValue;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to save ${filePath}:`, err.message);
  }
}

// Debounced save to avoid excessive disk I/O
let chatSaveTimer = null;
function debouncedSaveChats() {
  if (chatSaveTimer) clearTimeout(chatSaveTimer);
  chatSaveTimer = setTimeout(() => {
    const chatData = {
      globalHistory,
      directMessageHistories: Object.fromEntries(directMessageHistories)
    };
    saveJSON(DB_CHATS_PATH, chatData);
  }, 2000);
}

// --- Initialize Databases ---
// registeredUsers: { username -> { passwordHash, encryptedPrivateKey, publicKey, avatarColor } }
const registeredUsers = loadJSON(DB_USERS_PATH, {});

// Load chat histories
const savedChats = loadJSON(DB_CHATS_PATH, { globalHistory: [], directMessageHistories: {} });
let globalHistory = savedChats.globalHistory || [];

// directMessageHistories: sortedUsernamesKey (e.g. "alex:bob") -> Array of messages
const directMessageHistories = new Map(Object.entries(savedChats.directMessageHistories || {}));

// --- Runtime Memory ---
// activeUsers: socketId -> { username, publicKey, avatarColor, socketId }
const activeUsers = new Map();

// Rate limiting: socketId -> Array of message timestamps
const rateLimits = new Map();

let messageIdCounter = 0;

const AVATAR_COLORS = [
  '#34B7F1', '#3F51B5', '#00A884', '#009688', 
  '#FF9800', '#FF5722', '#E91E63', '#9C27B0',
  '#673AB7', '#4CAF50', '#8BC34A', '#E040FB'
];

function generateId() {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

function getAvatarColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function saveMessageToLog(scope, messageData) {
  const logLine = `[Scope: ${scope}] [${messageData.time}] ${messageData.user}: (E2EE Encrypted Payload)\n`;
  fs.appendFile(LOG_FILE, logLine, (err) => {
    if (err) console.error('Failed to save log:', err);
  });
}

// Fallback routing for React
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/socket.io')) {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  } else {
    next();
  }
});

io.on('connection', (socket) => {
  let currentUser = null;

  console.log(`Socket connected: ${socket.id}`);

  // --- Register (Sign Up) ---
  socket.on('register', ({ username, passwordHash, encryptedPrivateKey, publicKey }, callback) => {
    const trimmedUser = username.trim();

    if (!trimmedUser || !passwordHash || !encryptedPrivateKey || !publicKey) {
      return callback({ success: false, error: 'All fields are required.' });
    }

    if (trimmedUser.length < 2 || trimmedUser.length > 15) {
      return callback({ success: false, error: 'Username must be 2-15 characters.' });
    }

    // Check if username is already registered
    const lowerUser = trimmedUser.toLowerCase();
    const userExists = Object.keys(registeredUsers).some(
      u => u.toLowerCase() === lowerUser
    );

    if (userExists) {
      return callback({ success: false, error: `"${trimmedUser}" is already registered. Please log in instead.` });
    }

    const avatarColor = getAvatarColor(trimmedUser);

    // Save user account
    registeredUsers[trimmedUser] = {
      passwordHash,
      encryptedPrivateKey,
      publicKey,
      avatarColor
    };
    saveJSON(DB_USERS_PATH, registeredUsers);

    // Auto-join the network after registration
    currentUser = trimmedUser;
    const userData = {
      username: trimmedUser,
      publicKey,
      avatarColor,
      joinedAt: new Date().toISOString(),
      socketId: socket.id
    };
    activeUsers.set(socket.id, userData);

    callback({
      success: true,
      avatarColor,
      users: Array.from(activeUsers.values()).map(u => ({
        username: u.username,
        avatarColor: u.avatarColor,
        publicKey: u.publicKey,
        socketId: u.socketId
      }))
    });

    // Send global lobby chat history
    socket.emit('chat_history', globalHistory);

    // Broadcast updated active user list
    io.emit('user_list', Array.from(activeUsers.values()).map(u => ({
      username: u.username,
      avatarColor: u.avatarColor,
      publicKey: u.publicKey,
      socketId: u.socketId
    })));

    // Emit system join message
    const sysMsg = {
      id: generateId(),
      user: '__system__',
      text: `${trimmedUser} joined the campus network.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };
    globalHistory.push(sysMsg);
    if (globalHistory.length > 100) globalHistory.shift();
    debouncedSaveChats();

    io.emit('receive_message', sysMsg);
    console.log(`User [${trimmedUser}] registered and joined the network.`);
  });

  // --- Login ---
  socket.on('login', ({ username, passwordHash }, callback) => {
    const trimmedUser = username.trim();

    if (!trimmedUser || !passwordHash) {
      return callback({ success: false, error: 'Username and password are required.' });
    }

    // Find the user (case-insensitive lookup)
    const matchedKey = Object.keys(registeredUsers).find(
      u => u.toLowerCase() === trimmedUser.toLowerCase()
    );

    if (!matchedKey) {
      return callback({ success: false, error: `Account "${trimmedUser}" not found. Please sign up first.` });
    }

    const userRecord = registeredUsers[matchedKey];

    if (userRecord.passwordHash !== passwordHash) {
      return callback({ success: false, error: 'Incorrect password.' });
    }

    // Check if already logged in on another socket
    const alreadyActive = Array.from(activeUsers.values()).find(
      u => u.username.toLowerCase() === matchedKey.toLowerCase()
    );
    if (alreadyActive) {
      // Kick the old session
      const oldSocket = io.sockets.sockets.get(alreadyActive.socketId);
      if (oldSocket) {
        oldSocket.emit('session_kicked', { reason: 'Logged in from another window.' });
        oldSocket.disconnect(true);
      }
      activeUsers.delete(alreadyActive.socketId);
    }

    // Join
    currentUser = matchedKey;
    const userData = {
      username: matchedKey,
      publicKey: userRecord.publicKey,
      avatarColor: userRecord.avatarColor,
      joinedAt: new Date().toISOString(),
      socketId: socket.id
    };
    activeUsers.set(socket.id, userData);

    callback({
      success: true,
      avatarColor: userRecord.avatarColor,
      encryptedPrivateKey: userRecord.encryptedPrivateKey,
      publicKey: userRecord.publicKey,
      users: Array.from(activeUsers.values()).map(u => ({
        username: u.username,
        avatarColor: u.avatarColor,
        publicKey: u.publicKey,
        socketId: u.socketId
      }))
    });

    // Send global lobby chat history
    socket.emit('chat_history', globalHistory);

    // Broadcast updated active user list
    io.emit('user_list', Array.from(activeUsers.values()).map(u => ({
      username: u.username,
      avatarColor: u.avatarColor,
      publicKey: u.publicKey,
      socketId: u.socketId
    })));

    // Emit system join message
    const sysMsg = {
      id: generateId(),
      user: '__system__',
      text: `${matchedKey} is now online.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };
    globalHistory.push(sysMsg);
    if (globalHistory.length > 100) globalHistory.shift();
    debouncedSaveChats();

    io.emit('receive_message', sysMsg);
    console.log(`User [${matchedKey}] logged in.`);
  });

  // --- Send Global Lobby Message (Rate Limited) ---
  socket.on('send_message', (data) => {
    if (!currentUser) return;

    // Rate Limiting
    const now = Date.now();
    if (!rateLimits.has(socket.id)) {
      rateLimits.set(socket.id, []);
    }
    const timestamps = rateLimits.get(socket.id);
    const recentTimestamps = timestamps.filter(t => now - t < 2000);
    recentTimestamps.push(now);
    rateLimits.set(socket.id, recentTimestamps);

    if (recentTimestamps.length > 5) {
      socket.emit('rate_limited', { error: 'You are sending messages too fast. Muted for 5 seconds.' });
      return;
    }

    const user = activeUsers.get(socket.id);
    if (!user) return;

    const msg = {
      ...data,
      id: generateId(),
      user: user.username,
      avatarColor: user.avatarColor,
      timestamp: now,
      readBy: [],
      copiedBy: []
    };

    globalHistory.push(msg);
    if (globalHistory.length > 100) globalHistory.shift();
    debouncedSaveChats();

    io.emit('receive_message', msg);
    saveMessageToLog('global-lobby', msg);
  });

  // --- Send Direct Message (1-to-1 E2EE) ---
  socket.on('send_direct_message', (data) => {
    if (!currentUser) return;

    // Rate Limiting
    const now = Date.now();
    if (!rateLimits.has(socket.id)) {
      rateLimits.set(socket.id, []);
    }
    const timestamps = rateLimits.get(socket.id);
    const recentTimestamps = timestamps.filter(t => now - t < 2000);
    recentTimestamps.push(now);
    rateLimits.set(socket.id, recentTimestamps);

    if (recentTimestamps.length > 5) {
      socket.emit('rate_limited', { error: 'You are sending messages too fast.' });
      return;
    }

    const user = activeUsers.get(socket.id);
    if (!user) return;

    const { toUsername } = data;
    const recipient = Array.from(activeUsers.values()).find(
      u => u.username.toLowerCase() === toUsername.toLowerCase()
    );

    const msg = {
      ...data,
      id: generateId(),
      user: user.username,
      avatarColor: user.avatarColor,
      timestamp: now,
      readBy: [],
      copiedBy: []
    };

    // Save direct message history
    const historyKey = [user.username, toUsername].sort().join(':');
    if (!directMessageHistories.has(historyKey)) {
      directMessageHistories.set(historyKey, []);
    }
    const history = directMessageHistories.get(historyKey);
    history.push(msg);
    if (history.length > 100) history.shift();
    directMessageHistories.set(historyKey, history);
    debouncedSaveChats();

    // Relay to recipient
    if (recipient) {
      io.to(recipient.socketId).emit('receive_direct_message', msg);
    }
    
    // Relay to sender
    socket.emit('receive_direct_message', msg);
    saveMessageToLog(`direct:${historyKey}`, msg);
  });

  // --- Request Direct E2EE Chat History ---
  socket.on('request_direct_history', ({ withUsername }) => {
    if (!currentUser) return;
    const historyKey = [currentUser, withUsername].sort().join(':');
    const history = directMessageHistories.get(historyKey) || [];
    socket.emit('direct_history', { withUsername, history });
  });

  // --- Message Read Status Receipt ---
  socket.on('message_read', ({ id, scope, toUsername }) => {
    if (!currentUser) return;

    if (scope === 'global') {
      const msg = globalHistory.find(m => m.id === id);
      if (msg) {
        msg.readBy = msg.readBy || [];
        if (!msg.readBy.includes(currentUser)) {
          msg.readBy.push(currentUser);
          debouncedSaveChats();
          io.emit('message_read_update', { id, reader: currentUser, scope: 'global' });
        }
      }
    } else if (scope === 'direct' && toUsername) {
      const historyKey = [currentUser, toUsername].sort().join(':');
      const history = directMessageHistories.get(historyKey) || [];
      const msg = history.find(m => m.id === id);
      if (msg) {
        msg.readBy = msg.readBy || [];
        if (!msg.readBy.includes(currentUser)) {
          msg.readBy.push(currentUser);
          debouncedSaveChats();
          
          const recipient = Array.from(activeUsers.values()).find(
            u => u.username.toLowerCase() === toUsername.toLowerCase()
          );
          if (recipient) {
            io.to(recipient.socketId).emit('message_read_update', { id, reader: currentUser, scope: 'direct', peer: currentUser });
          }
          socket.emit('message_read_update', { id, reader: currentUser, scope: 'direct', peer: toUsername });
        }
      }
    }
  });

  // --- Code Snippet Copied Event Tracker ---
  socket.on('code_copied', ({ id, scope, toUsername }) => {
    if (!currentUser) return;

    if (scope === 'global') {
      const msg = globalHistory.find(m => m.id === id);
      if (msg) {
        msg.copiedBy = msg.copiedBy || [];
        if (!msg.copiedBy.includes(currentUser)) {
          msg.copiedBy.push(currentUser);
          debouncedSaveChats();
          io.emit('code_copied_update', { id, copier: currentUser, scope: 'global' });
        }
      }
    } else if (scope === 'direct' && toUsername) {
      const historyKey = [currentUser, toUsername].sort().join(':');
      const history = directMessageHistories.get(historyKey) || [];
      const msg = history.find(m => m.id === id);
      if (msg) {
        msg.copiedBy = msg.copiedBy || [];
        if (!msg.copiedBy.includes(currentUser)) {
          msg.copiedBy.push(currentUser);
          debouncedSaveChats();
          
          const recipient = Array.from(activeUsers.values()).find(
            u => u.username.toLowerCase() === toUsername.toLowerCase()
          );
          if (recipient) {
            io.to(recipient.socketId).emit('code_copied_update', { id, copier: currentUser, scope: 'direct', peer: currentUser });
          }
          socket.emit('code_copied_update', { id, copier: currentUser, scope: 'direct', peer: toUsername });
        }
      }
    }
  });

  // --- Typing Indicator ---
  socket.on('typing', ({ target }) => {
    if (!currentUser) return;
    if (target === 'global') {
      socket.broadcast.emit('user_typing', { username: currentUser, target: 'global' });
    } else {
      const recipient = Array.from(activeUsers.values()).find(
        u => u.username.toLowerCase() === target.toLowerCase()
      );
      if (recipient) {
        io.to(recipient.socketId).emit('user_typing', { username: currentUser, target: 'direct' });
      }
    }
  });

  socket.on('stop_typing', ({ target }) => {
    if (!currentUser) return;
    if (target === 'global') {
      socket.broadcast.emit('user_stop_typing', { username: currentUser, target: 'global' });
    } else {
      const recipient = Array.from(activeUsers.values()).find(
        u => u.username.toLowerCase() === target.toLowerCase()
      );
      if (recipient) {
        io.to(recipient.socketId).emit('user_stop_typing', { username: currentUser, target: 'direct' });
      }
    }
  });

  // --- Multiplayer Game Signaling ---
  socket.on('game_invite', ({ targetUsername }) => {
    if (!currentUser) return;
    const targetUser = Array.from(activeUsers.values()).find(u => u.username === targetUsername);
    if (targetUser) {
      io.to(targetUser.socketId).emit('game_invite_received', {
        from: currentUser,
        socketId: socket.id
      });
    }
  });

  socket.on('game_invite_response', ({ senderSocketId, accepted }) => {
    if (!currentUser) return;
    io.to(senderSocketId).emit('game_invite_result', {
      from: currentUser,
      accepted,
      opponentSocketId: socket.id
    });
  });

  socket.on('game_action', ({ opponentSocketId, action, state }) => {
    io.to(opponentSocketId).emit('game_update', {
      action,
      state
    });
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    rateLimits.delete(socket.id);

    if (currentUser) {
      activeUsers.delete(socket.id);

      // Broadcast updated user list
      io.emit('user_list', Array.from(activeUsers.values()).map(u => ({
        username: u.username,
        avatarColor: u.avatarColor,
        publicKey: u.publicKey,
        socketId: u.socketId
      })));

      // Emit system leave message
      const sysMsg = {
        id: generateId(),
        user: '__system__',
        text: `${currentUser} went offline.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };
      globalHistory.push(sysMsg);
      if (globalHistory.length > 100) globalHistory.shift();
      debouncedSaveChats();

      io.emit('receive_message', sysMsg);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`EduSphere Server running successfully on 0.0.0.0:${PORT}`);
  console.log(`Registered users: ${Object.keys(registeredUsers).length}`);
});
