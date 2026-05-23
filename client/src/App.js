import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { 
  generateECDHKeyPair, 
  exportPublicKey, 
  importPublicKey, 
  deriveSharedKey, 
  deriveKey, 
  encryptData, 
  decryptData,
  hashPasswordForServer,
  encryptPrivateKey,
  decryptPrivateKey
} from './crypto';
import './App.css';
import edusphereLogo from './edusphere-logo.png';

// Dynamic backend url detection
const getBackendUrl = () => {
  const { hostname, port } = window.location;
  if (port === '3000') {
    return `http://${hostname}:3001`;
  }
  return window.location.origin;
};

const socket = io(getBackendUrl(), {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
});

// TRIVIA QUESTIONS BANK
const TRIVIA_QUESTIONS = [
  {
    question: "What does CPU stand for in computer science?",
    options: ["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Control Process Utility"],
    answer: "Central Processing Unit"
  },
  {
    question: "Which data structure operates on a Last-In-First-Out (LIFO) basis?",
    options: ["Queue", "Array", "Stack", "Linked List"],
    answer: "Stack"
  },
  {
    question: "Which chemical element has the symbol 'O' and atomic number 8?",
    options: ["Osmium", "Gold", "Oxygen", "Carbon"],
    answer: "Oxygen"
  },
  {
    question: "What is the speed of light in a vacuum approximately?",
    options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"],
    answer: "300,000 km/s"
  },
  {
    question: "Who is widely considered the father of Computer Science?",
    options: ["Bill Gates", "Alan Turing", "Steve Jobs", "Ada Lovelace"],
    answer: "Alan Turing"
  }
];

// FLASHCARDS BANK
const FLASHCARDS = [
  { topic: "Computer Science", term: "Recursion", definition: "A programming technique where a function calls itself directly or indirectly to solve a problem." },
  { topic: "Biology", term: "Photosynthesis", definition: "The process by which green plants use sunlight to synthesize nutrients from carbon dioxide and water." },
  { topic: "Chemistry", term: "Covalent Bond", definition: "A chemical bond that involves the sharing of electron pairs between atoms." },
  { topic: "Physics", term: "Entropy", definition: "A measure of the level of disorder or randomness in a closed thermodynamic system." },
  { topic: "Mathematics", term: "Derivative", definition: "The rate of change of a function with respect to a variable, representing the slope of the tangent line." }
];

function App() {
  // Auth state
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  
  // App States
  const [isJoined, setIsJoined] = useState(false);
  const [userColor, setUserColor] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [activeTab, setActiveTab] = useState('people');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [rateLimitWarning, setRateLimitWarning] = useState('');

  // activeChat: 'global' or user object: { username, socketId, publicKey, avatarColor }
  const [activeChat, setActiveChat] = useState('global');

  // Cryptographic Keys
  const [myKeyPair, setMyKeyPair] = useState(null);
  const [lobbyCryptoKey, setLobbyCryptoKey] = useState(null);
  const [directKeys, setDirectKeys] = useState({});

  // Message Histories
  const [globalHistory, setGlobalHistory] = useState([]);
  const [directHistories, setDirectHistories] = useState({});

  // Input State
  const [message, setMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);

  // Typing States
  const [globalTypingUsers, setGlobalTypingUsers] = useState([]);
  const [directTypingUsers, setDirectTypingUsers] = useState({});

  // File Sharing States
  const [isUploading, setIsUploading] = useState(false);
  
  // Code Snippet States
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [codeContent, setCodeContent] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('javascript');

  // Multiplayer Game States (Tic-Tac-Toe)
  const [gameInvite, setGameInvite] = useState(null);
  const [gameOpponentSocketId, setGameOpponentSocketId] = useState(null);
  const [opponentName, setOpponentName] = useState('');
  const [gameStatus, setGameStatus] = useState('idle');
  const [board, setBoard] = useState(Array(9).fill(null));
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [mySymbol, setMySymbol] = useState('X');
  const [gameResult, setGameResult] = useState('');
  
  // Trivia States
  const [currentTriviaIdx, setCurrentTriviaIdx] = useState(0);
  const [triviaScore, setTriviaScore] = useState(0);
  const [selectedTriviaOption, setSelectedTriviaOption] = useState(null);
  const [isTriviaAnswered, setIsTriviaAnswered] = useState(false);
  const [triviaQuizFinished, setTriviaQuizFinished] = useState(false);

  // Flashcards States
  const [flashcardIdx, setFlashcardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);

  const chatEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  // Check winner function (memoized)
  const checkWinner = useCallback((newBoard) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]) {
        if (newBoard[a] === mySymbol) {
          setGameResult('wins');
        } else {
          setGameResult('loss');
        }
        return;
      }
    }
    if (newBoard.every(cell => cell !== null)) {
      setGameResult('draw');
    }
  }, [mySymbol]);

  // Connection listeners
  useEffect(() => {
    const handleConnect = () => setConnectionStatus('connected');
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleConnectError = () => setConnectionStatus('disconnected');

    if (socket.connected) {
      setConnectionStatus('connected');
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    socket.on('rate_limited', ({ error }) => {
      setRateLimitWarning(error);
      setTimeout(() => setRateLimitWarning(''), 5000);
    });

    socket.on('session_kicked', ({ reason }) => {
      setIsJoined(false);
      setErrorMsg(reason || 'You were logged out from this window.');
      localStorage.removeItem('edusphere_session');
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('rate_limited');
      socket.off('session_kicked');
    };
  }, []);

  // Auto-login from localStorage on mount
  useEffect(() => {
    const tryAutoLogin = async () => {
      const saved = localStorage.getItem('edusphere_session');
      if (!saved) {
        setIsRestoringSession(false);
        return;
      }

      try {
        const { username: savedUser, password: savedPass } = JSON.parse(saved);
        if (!savedUser || !savedPass) {
          setIsRestoringSession(false);
          return;
        }

        // Wait for socket connection
        const waitForConnection = () => new Promise((resolve) => {
          if (socket.connected) return resolve();
          socket.once('connect', resolve);
          setTimeout(resolve, 3000);
        });
        await waitForConnection();

        const passwordHash = await hashPasswordForServer(savedPass, savedUser);
        const lobbyKey = await deriveKey('global-lobby-shared-secret-passphrase', 'global-lobby');

        socket.emit('login', { username: savedUser, passwordHash }, async (response) => {
          if (response && response.success) {
            // Decrypt the private key
            try {
              const privateKey = await decryptPrivateKey(response.encryptedPrivateKey, savedPass, savedUser);
              const publicKey = await importPublicKey(response.publicKey);
              
              setMyKeyPair({ privateKey, publicKey });
              setLobbyCryptoKey(lobbyKey);
              setUsername(savedUser);
              setPassword(savedPass);
              setUserColor(response.avatarColor);
              setOnlineUsers(response.users);
              setIsJoined(true);
              setErrorMsg('');
              setConnectionStatus('connected');
            } catch (cryptoErr) {
              console.error('Auto-login key decryption failed:', cryptoErr);
              localStorage.removeItem('edusphere_session');
            }
          } else {
            localStorage.removeItem('edusphere_session');
          }
          setIsRestoringSession(false);
        });
      } catch (err) {
        console.error('Auto-login failed:', err);
        localStorage.removeItem('edusphere_session');
        setIsRestoringSession(false);
      }
    };

    tryAutoLogin();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Socket action listeners
  useEffect(() => {
    if (!isJoined || !lobbyCryptoKey) return;

    const decryptMsg = async (msg, cryptoKey) => {
      if (msg.user === '__system__') return msg;
      try {
        const decryptedText = await decryptData(msg.text, cryptoKey);
        return { ...msg, text: decryptedText };
      } catch (err) {
        return { ...msg, text: '🔒 [Decryption Failed]' };
      }
    };

    socket.on('chat_history', async (history) => {
      const decrypted = await Promise.all(history.map(m => decryptMsg(m, lobbyCryptoKey)));
      setGlobalHistory(decrypted);
    });

    socket.on('receive_message', async (data) => {
      const decrypted = await decryptMsg(data, lobbyCryptoKey);
      setGlobalHistory((prev) => [...prev, decrypted]);
    });

    socket.on('direct_history', async ({ withUsername, history }) => {
      let key = directKeys[withUsername];
      if (!key) {
        const peerUser = onlineUsers.find(u => u.username === withUsername);
        if (peerUser && myKeyPair) {
          try {
            const importedPeerPub = await importPublicKey(peerUser.publicKey);
            key = await deriveSharedKey(myKeyPair.privateKey, importedPeerPub);
            setDirectKeys((prev) => ({ ...prev, [withUsername]: key }));
          } catch (err) {
            console.error('Lazy key derivation failed for direct history:', err);
          }
        }
      }
      const decrypted = await Promise.all(history.map(m => decryptMsg(m, key)));
      setDirectHistories((prev) => ({ ...prev, [withUsername]: decrypted }));
    });

    socket.on('receive_direct_message', async (data) => {
      const peer = data.user === username ? data.toUsername : data.user;
      let key = directKeys[peer];
      if (!key) {
        const peerUser = onlineUsers.find(u => u.username === peer);
        if (peerUser && myKeyPair) {
          try {
            const importedPeerPub = await importPublicKey(peerUser.publicKey);
            key = await deriveSharedKey(myKeyPair.privateKey, importedPeerPub);
            setDirectKeys((prev) => ({ ...prev, [peer]: key }));
          } catch (err) {
            console.error('Lazy key derivation failed for live message:', err);
          }
        }
      }
      const decrypted = await decryptMsg(data, key);
      setDirectHistories((prev) => {
        const history = prev[peer] || [];
        return { ...prev, [peer]: [...history, decrypted] };
      });
    });

    socket.on('user_list', (users) => {
      setOnlineUsers(users);
    });

    socket.on('message_read_update', ({ id, reader, scope, peer }) => {
      if (scope === 'global') {
        setGlobalHistory((prev) =>
          prev.map((msg) => {
            if (msg.id === id) {
              const readBy = msg.readBy || [];
              if (!readBy.includes(reader)) {
                return { ...msg, readBy: [...readBy, reader] };
              }
            }
            return msg;
          })
        );
      } else if (scope === 'direct' && peer) {
        setDirectHistories((prev) => {
          const history = prev[peer] || [];
          const updated = history.map((msg) => {
            if (msg.id === id) {
              const readBy = msg.readBy || [];
              if (!readBy.includes(reader)) {
                return { ...msg, readBy: [...readBy, reader] };
              }
            }
            return msg;
          });
          return { ...prev, [peer]: updated };
        });
      }
    });

    socket.on('code_copied_update', ({ id, copier, scope, peer }) => {
      if (scope === 'global') {
        setGlobalHistory((prev) =>
          prev.map((msg) => {
            if (msg.id === id) {
              const copiedBy = msg.copiedBy || [];
              if (!copiedBy.includes(copier)) {
                return { ...msg, copiedBy: [...copiedBy, copier] };
              }
            }
            return msg;
          })
        );
      } else if (scope === 'direct' && peer) {
        setDirectHistories((prev) => {
          const history = prev[peer] || [];
          const updated = history.map((msg) => {
            if (msg.id === id) {
              const copiedBy = msg.copiedBy || [];
              if (!copiedBy.includes(copier)) {
                return { ...msg, copiedBy: [...copiedBy, copier] };
              }
            }
            return msg;
          });
          return { ...prev, [peer]: updated };
        });
      }
    });

    socket.on('user_typing', ({ username: typingUser, target }) => {
      if (target === 'global') {
        setGlobalTypingUsers((prev) => {
          if (prev.includes(typingUser)) return prev;
          return [...prev, typingUser];
        });
      } else {
        setDirectTypingUsers((prev) => ({ ...prev, [typingUser]: true }));
      }
    });

    socket.on('user_stop_typing', ({ username: typingUser, target }) => {
      if (target === 'global') {
        setGlobalTypingUsers((prev) => prev.filter((u) => u !== typingUser));
      } else {
        setDirectTypingUsers((prev) => ({ ...prev, [typingUser]: false }));
      }
    });

    socket.on('game_invite_received', ({ from, socketId }) => {
      setGameInvite({ from, socketId });
      setActiveTab('games');
    });

    socket.on('game_invite_result', ({ from, accepted, opponentSocketId }) => {
      if (accepted) {
        setGameOpponentSocketId(opponentSocketId);
        setOpponentName(from);
        setGameStatus('playing');
        setBoard(Array(9).fill(null));
        setIsMyTurn(true);
        setMySymbol('X');
        setGameResult('');
      } else {
        alert(`${from} declined your invitation to play.`);
        setGameStatus('idle');
      }
    });

    socket.on('game_update', ({ action, state }) => {
      if (action === 'move') {
        setBoard(state.board);
        setIsMyTurn(true);
        checkWinner(state.board);
      } else if (action === 'reset') {
        setBoard(Array(9).fill(null));
        setIsMyTurn(mySymbol === 'X');
        setGameResult('');
      } else if (action === 'quit') {
        alert(`Your opponent left the game.`);
        resetGameStates();
      }
    });

    return () => {
      socket.off('chat_history');
      socket.off('receive_message');
      socket.off('direct_history');
      socket.off('receive_direct_message');
      socket.off('user_list');
      socket.off('message_read_update');
      socket.off('code_copied_update');
      socket.off('user_typing');
      socket.off('user_stop_typing');
      socket.off('game_invite_received');
      socket.off('game_invite_result');
      socket.off('game_update');
    };
  }, [isJoined, lobbyCryptoKey, directKeys, onlineUsers, myKeyPair, mySymbol, username, checkWinner]);

  // Scroll viewport down
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [globalHistory, directHistories, activeChat, globalTypingUsers, directTypingUsers]);

  // Trigger message_read events
  useEffect(() => {
    if (!isJoined) return;
    const history = activeChat === 'global' ? globalHistory : (directHistories[activeChat.username] || []);
    history.forEach((msg) => {
      if (msg.user !== '__system__' && msg.user !== username) {
        const readBy = msg.readBy || [];
        if (!readBy.includes(username)) {
          socket.emit('message_read', {
            id: msg.id,
            scope: activeChat === 'global' ? 'global' : 'direct',
            toUsername: activeChat === 'global' ? null : activeChat.username
          });
        }
      }
    });
  }, [activeChat, globalHistory, directHistories, isJoined, username]);

  // Helper to reset games
  const resetGameStates = () => {
    setGameInvite(null);
    setGameOpponentSocketId(null);
    setOpponentName('');
    setGameStatus('idle');
    setBoard(Array(9).fill(null));
    setIsMyTurn(false);
    setGameResult('');
  };

  // --- SIGN UP ---
  const handleSignUp = async (e) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    const pass = password;

    if (!trimmedUser) {
      setErrorMsg('Please enter a username.');
      return;
    }
    if (trimmedUser.length < 2 || trimmedUser.length > 15) {
      setErrorMsg('Username must be 2-15 characters.');
      return;
    }
    if (!pass || pass.length < 4) {
      setErrorMsg('Password must be at least 4 characters.');
      return;
    }
    if (pass !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setErrorMsg('');
    setConnectionStatus('connecting');

    try {
      // 1. Generate ECDH key pair
      const keys = await generateECDHKeyPair();

      // 2. Export public key
      const publicSpki = await exportPublicKey(keys.publicKey);

      // 3. Hash password for server auth
      const passwordHash = await hashPasswordForServer(pass, trimmedUser);

      // 4. Encrypt private key with password for server escrow
      const encryptedPK = await encryptPrivateKey(keys.privateKey, pass, trimmedUser);

      // 5. Derive lobby key
      const lobbyKey = await deriveKey('global-lobby-shared-secret-passphrase', 'global-lobby');

      // 6. Emit register
      socket.emit('register', {
        username: trimmedUser,
        passwordHash,
        encryptedPrivateKey: encryptedPK,
        publicKey: publicSpki
      }, (response) => {
        if (response && response.success) {
          setMyKeyPair(keys);
          setLobbyCryptoKey(lobbyKey);
          setIsJoined(true);
          setUserColor(response.avatarColor);
          setErrorMsg('');
          setConnectionStatus('connected');
          setOnlineUsers(response.users);

          // Save session to localStorage
          localStorage.setItem('edusphere_session', JSON.stringify({
            username: trimmedUser,
            password: pass
          }));
        } else {
          setErrorMsg(response?.error || 'Registration failed.');
          setConnectionStatus('disconnected');
        }
      });
    } catch (err) {
      console.error(err);
      setErrorMsg('Cryptographic key generation failed.');
      setConnectionStatus('disconnected');
    }
  };

  // --- LOG IN ---
  const handleLogin = async (e) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    const pass = password;

    if (!trimmedUser || !pass) {
      setErrorMsg('Username and password are required.');
      return;
    }

    setErrorMsg('');
    setConnectionStatus('connecting');

    try {
      const passwordHash = await hashPasswordForServer(pass, trimmedUser);
      const lobbyKey = await deriveKey('global-lobby-shared-secret-passphrase', 'global-lobby');

      socket.emit('login', { username: trimmedUser, passwordHash }, async (response) => {
        if (response && response.success) {
          try {
            // Decrypt the private key from escrow
            const privateKey = await decryptPrivateKey(response.encryptedPrivateKey, pass, trimmedUser);
            const publicKey = await importPublicKey(response.publicKey);
            
            setMyKeyPair({ privateKey, publicKey });
            setLobbyCryptoKey(lobbyKey);
            setUsername(trimmedUser);
            setIsJoined(true);
            setUserColor(response.avatarColor);
            setErrorMsg('');
            setConnectionStatus('connected');
            setOnlineUsers(response.users);

            // Save session to localStorage
            localStorage.setItem('edusphere_session', JSON.stringify({
              username: trimmedUser,
              password: pass
            }));
          } catch (cryptoErr) {
            console.error('Key decryption failed:', cryptoErr);
            setErrorMsg('Failed to decrypt your encryption keys. Incorrect password.');
            setConnectionStatus('disconnected');
          }
        } else {
          setErrorMsg(response?.error || 'Login failed.');
          setConnectionStatus('disconnected');
        }
      });
    } catch (err) {
      console.error(err);
      setErrorMsg('Authentication failed.');
      setConnectionStatus('disconnected');
    }
  };

  // --- LOG OUT ---
  const handleLogout = () => {
    localStorage.removeItem('edusphere_session');
    socket.disconnect();
    setIsJoined(false);
    setMyKeyPair(null);
    setLobbyCryptoKey(null);
    setDirectKeys({});
    setGlobalHistory([]);
    setDirectHistories({});
    setOnlineUsers([]);
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setActiveChat('global');
    setErrorMsg('');
    resetGameStates();
    // Reconnect socket for new login
    setTimeout(() => socket.connect(), 500);
  };

  // Handle Input typing changes
  const handleInputChange = (e) => {
    setMessage(e.target.value);
    const target = activeChat === 'global' ? 'global' : activeChat.username;
    socket.emit('typing', { target });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { target });
    }, 1500);
  };

  // Click direct chat user handler
  const openDirectChat = async (user) => {
    setIsSidebarOpen(false);
    if (activeChat !== 'global' && activeChat.username === user.username) return;

    let key = directKeys[user.username];
    if (!key && myKeyPair) {
      try {
        const peerPublicKey = await importPublicKey(user.publicKey);
        key = await deriveSharedKey(myKeyPair.privateKey, peerPublicKey);
        setDirectKeys((prev) => ({ ...prev, [user.username]: key }));
      } catch (err) {
        console.error('ECDH key exchange failed on click:', err);
        alert('Could not establish secure encryption with this peer.');
        return;
      }
    }
    setActiveChat(user);
    socket.emit('request_direct_history', { withUsername: user.username });
  };

  const openGlobalLobby = () => {
    setIsSidebarOpen(false);
    setActiveChat('global');
  };

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || connectionStatus !== 'connected') return;

    const target = activeChat === 'global' ? 'global' : activeChat.username;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('stop_typing', { target });

    try {
      const activeKey = activeChat === 'global' ? lobbyCryptoKey : directKeys[activeChat.username];
      const cipherText = await encryptData(message.trim(), activeKey);

      const payload = {
        text: cipherText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isFile: false
      };

      if (activeChat === 'global') {
        socket.emit('send_message', payload);
      } else {
        socket.emit('send_direct_message', { ...payload, toUsername: activeChat.username });
      }
      setMessage('');
    } catch (err) {
      console.error(err);
    }
  };

  // File uploading handler
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("Maximum file upload size is 10MB.");
      return;
    }
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const base64Data = event.target.result;
        const activeKey = activeChat === 'global' ? lobbyCryptoKey : directKeys[activeChat.username];
        const encryptedFilePayload = await encryptData(base64Data, activeKey);
        const payload = {
          text: encryptedFilePayload,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isFile: true,
          fileName: file.name,
          fileType: file.type
        };
        if (activeChat === 'global') {
          socket.emit('send_message', payload);
        } else {
          socket.emit('send_direct_message', { ...payload, toUsername: activeChat.username });
        }
      } catch (err) {
        alert("Encryption failed during file upload.");
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Code sharing modal submission
  const sendCodeSnippet = async () => {
    if (!codeContent.trim()) return;
    try {
      const activeKey = activeChat === 'global' ? lobbyCryptoKey : directKeys[activeChat.username];
      const encryptedCode = await encryptData(codeContent.trim(), activeKey);
      const payload = {
        text: encryptedCode,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isFile: false,
        isCode: true,
        codeLanguage
      };
      if (activeChat === 'global') {
        socket.emit('send_message', payload);
      } else {
        socket.emit('send_direct_message', { ...payload, toUsername: activeChat.username });
      }
      setCodeContent('');
      setIsCodeModalOpen(false);
    } catch (err) {
      alert("Could not encrypt code snippet.");
    }
  };

  // --- Multiplayer Game Mechanics ---
  const inviteToGame = (user) => {
    if (user.username === username) return;
    setGameStatus('invited');
    setOpponentName(user.username);
    socket.emit('game_invite', { targetUsername: user.username });
  };

  const acceptGameInvite = () => {
    if (!gameInvite) return;
    setGameOpponentSocketId(gameInvite.socketId);
    setOpponentName(gameInvite.from);
    setGameStatus('playing');
    setBoard(Array(9).fill(null));
    setIsMyTurn(false);
    setMySymbol('O');
    setGameResult('');
    socket.emit('game_invite_response', { senderSocketId: gameInvite.socketId, accepted: true });
    setGameInvite(null);
  };

  const declineGameInvite = () => {
    if (!gameInvite) return;
    socket.emit('game_invite_response', { senderSocketId: gameInvite.socketId, accepted: false });
    setGameInvite(null);
  };

  const handleCellClick = (index) => {
    if (!isMyTurn || board[index] || gameResult || !gameOpponentSocketId) return;
    const newBoard = [...board];
    newBoard[index] = mySymbol;
    setBoard(newBoard);
    setIsMyTurn(false);
    socket.emit('game_action', { opponentSocketId: gameOpponentSocketId, action: 'move', state: { board: newBoard } });
    checkWinner(newBoard);
  };

  const requestGameReset = () => {
    if (!gameOpponentSocketId) return;
    socket.emit('game_action', { opponentSocketId: gameOpponentSocketId, action: 'reset' });
    setBoard(Array(9).fill(null));
    setIsMyTurn(mySymbol === 'X');
    setGameResult('');
  };

  const quitGame = () => {
    if (gameOpponentSocketId) {
      socket.emit('game_action', { opponentSocketId: gameOpponentSocketId, action: 'quit' });
    }
    resetGameStates();
  };

  // --- Trivia Mechanics ---
  const handleTriviaAnswer = (option) => {
    if (isTriviaAnswered) return;
    setSelectedTriviaOption(option);
    setIsTriviaAnswered(true);
    if (option === TRIVIA_QUESTIONS[currentTriviaIdx].answer) {
      setTriviaScore((prev) => prev + 10);
    }
  };

  const handleNextTrivia = () => {
    setSelectedTriviaOption(null);
    setIsTriviaAnswered(false);
    if (currentTriviaIdx < TRIVIA_QUESTIONS.length - 1) {
      setCurrentTriviaIdx((prev) => prev + 1);
    } else {
      setTriviaQuizFinished(true);
    }
  };

  const resetTrivia = () => {
    setCurrentTriviaIdx(0);
    setTriviaScore(0);
    setSelectedTriviaOption(null);
    setIsTriviaAnswered(false);
    setTriviaQuizFinished(false);
  };

  const copyToClipboard = (text, msg) => {
    navigator.clipboard.writeText(text);
    alert('Code copied to clipboard!');
    if (msg && msg.id && msg.user !== username) {
      socket.emit('code_copied', {
        id: msg.id,
        scope: activeChat === 'global' ? 'global' : 'direct',
        toUsername: activeChat === 'global' ? null : activeChat.username
      });
    }
  };

  // Filter current active chat history
  const activeChatHistory = activeChat === 'global' ? globalHistory : (directHistories[activeChat.username] || []);
  const activeTyping = activeChat === 'global' 
    ? globalTypingUsers.filter(u => u !== username)
    : (directTypingUsers[activeChat.username] ? [activeChat.username] : []);

  // --- Loading screen while restoring session ---
  if (isRestoringSession) {
    return (
      <div className="login-screen">
        <div className="login-header-banner">
          <div className="login-logo-container">
            <img src={edusphereLogo} alt="EduSphere Logo" style={{ width: '70px', height: '70px', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }} />
            <h1>EduSphere</h1>
          </div>
        </div>
        <div className="login-body">
          <div className="login-card">
            <h2>Restoring Session...</h2>
            <p>Please wait while we securely log you back in.</p>
            <div className="session-loading-spinner"></div>
          </div>
        </div>
      </div>
    );
  }

  // --- Login / Sign Up Screen ---
  if (!isJoined) {
    return (
      <div className="login-screen">
        <div className="login-header-banner">
          <div className="login-logo-container">
            <img src={edusphereLogo} alt="EduSphere Logo" style={{ width: '70px', height: '70px', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }} />
            <h1>EduSphere</h1>
          </div>
        </div>
        <div className="login-body">
          <div className="login-card">
            <h2>Campus Collaboration Network</h2>
            <p>Secure end-to-end encrypted messaging for students.</p>

            {/* Auth Mode Toggle */}
            <div className="auth-toggle">
              <button
                className={`auth-toggle-btn ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setErrorMsg(''); }}
              >
                Log In
              </button>
              <button
                className={`auth-toggle-btn ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signup'); setErrorMsg(''); }}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp}>
              <div className="login-form-group">
                <label className="login-label">Username</label>
                <input
                  type="text"
                  className="login-input"
                  placeholder="e.g. Alex"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={15}
                  required
                />
              </div>

              <div className="login-form-group">
                <label className="login-label">Password</label>
                <input
                  type="password"
                  className="login-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {authMode === 'signup' && (
                <div className="login-form-group">
                  <label className="login-label">Confirm Password</label>
                  <input
                    type="password"
                    className="login-input"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              {errorMsg && (
                <div className="login-error">
                  <span>⚠️ {errorMsg}</span>
                </div>
              )}

              <button type="submit" className="login-button" disabled={connectionStatus === 'connecting'}>
                {connectionStatus === 'connecting' ? 'Securing keys...' : (authMode === 'login' ? 'Log In' : 'Create Account')}
              </button>
            </form>

            <p className="auth-switch-text">
              {authMode === 'login' 
                ? "Don't have an account? " 
                : "Already have an account? "}
              <button 
                className="auth-switch-link" 
                onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setErrorMsg(''); }}
              >
                {authMode === 'login' ? 'Sign Up' : 'Log In'}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {rateLimitWarning && (
        <div className="rate-limit-warning-bar">⚠️ {rateLimitWarning}</div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      {/* Sidebar Tabs */}
      <div className={`chat-sidebar ${isSidebarOpen ? 'active' : ''}`}>
        <div className="sidebar-header">
          <div className="user-profile-card">
            <div className="user-avatar" style={{ backgroundColor: '#00E676', color: '#0a0e17' }}>
              {username.charAt(0).toUpperCase()}
              <div className="user-online-dot"></div>
            </div>
            <div className="user-details">
              <span className="user-name-title">{username}</span>
              <span className="user-status-subtitle">Active Student</span>
            </div>
            <button className="logout-btn-minimal" onClick={handleLogout} title="Log Out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
          </div>
          {isSidebarOpen && (
            <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>✕</button>
          )}
        </div>

        <div className="sidebar-tabs-nav">
          <button className={`tab-nav-btn ${activeTab === 'people' ? 'active' : ''}`} onClick={() => setActiveTab('people')}>People</button>
          <button className={`tab-nav-btn ${activeTab === 'games' ? 'active' : ''}`} onClick={() => setActiveTab('games')}>Games</button>
          <button className={`tab-nav-btn ${activeTab === 'study' ? 'active' : ''}`} onClick={() => setActiveTab('study')}>Study Hub</button>
        </div>

        {activeTab === 'people' && (
          <div className="users-list">
            <div className="online-users-title">CHANNELS</div>
            <div 
              className={`user-item ${activeChat === 'global' ? 'active-chat-item' : ''}`} 
              onClick={openGlobalLobby}
              style={{ cursor: 'pointer' }}
            >
              <div className="user-item-avatar channel-avatar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>
              </div>
              <div className="user-item-info">
                <span className="user-item-name">Global Lobby Chat</span>
                <span className="user-item-status">Open to everyone</span>
              </div>
            </div>

            <div className="online-users-title" style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>DIRECT MESSAGES <span className="dm-count">({onlineUsers.filter(u => u.username !== username).length})</span></span>
              <button className="add-dm-btn">+</button>
            </div>
            
            {onlineUsers.filter(u => u.username !== username).length === 0 && (
              <div style={{ padding: '0 20px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem', marginTop: '10px' }}>
                No direct messages yet.
              </div>
            )}
            {onlineUsers.filter(u => u.username !== username).map((user, idx) => {
              const isActive = activeChat !== 'global' && activeChat.username === user.username;
              return (
                <div 
                  key={idx} 
                  className={`user-item ${isActive ? 'active-chat-item' : ''}`} 
                  onClick={() => openDirectChat(user)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="user-item-avatar" style={{ backgroundColor: user.avatarColor || '#009688' }}>
                    {user.username.charAt(0).toUpperCase()}
                    <div className="user-online-dot"></div>
                  </div>
                  <div className="user-item-info">
                    <span className="user-item-name">{user.username}</span>
                    <span className="user-item-status">Secure E2EE Chat</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'games' && (
          <div className="games-tab-content">
            {gameStatus === 'idle' && (
              <div className="matchmaking-container">
                <h3>Invite a peer to play</h3>
                <div className="peer-matchmaking-list">
                  {onlineUsers.filter(u => u.username !== username).length === 0 ? (
                    <p className="no-peers-msg">Waiting for other students to join...</p>
                  ) : (
                    onlineUsers.filter(u => u.username !== username).map((user, idx) => (
                      <div key={idx} className="peer-invite-item">
                        <span>{user.username}</span>
                        <button className="invite-btn" onClick={() => inviteToGame(user)}>Invite 🎮</button>
                      </div>
                    ))
                  )}
                </div>
                {gameInvite && (
                  <div className="received-invite-card">
                    <p>🎮 <strong>{gameInvite.from}</strong> invited you to Tic-Tac-Toe!</p>
                    <div className="invite-card-actions">
                      <button className="accept-btn" onClick={acceptGameInvite}>Accept</button>
                      <button className="decline-btn" onClick={declineGameInvite}>Decline</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {gameStatus === 'invited' && (
              <div className="game-loading-state">
                <p>Waiting for {opponentName} to accept invitation...</p>
                <button className="cancel-invite-btn" onClick={resetGameStates}>Cancel</button>
              </div>
            )}

            {gameStatus === 'playing' && (
              <div className="tictactoe-container">
                <div className="game-header">
                  <span>Match: <strong>{opponentName}</strong> ({mySymbol === 'X' ? 'O' : 'X'})</span>
                  <button className="quit-btn" onClick={quitGame}>Quit</button>
                </div>
                <div className="turn-indicator">
                  {gameResult ? (
                    <span className="result-indicator-text">
                      {gameResult === 'wins' && '🎉 You Won!'}
                      {gameResult === 'loss' && '💔 You Lost.'}
                      {gameResult === 'draw' && '⚖️ Match Draw.'}
                    </span>
                  ) : (
                    <span>{isMyTurn ? '🟢 Your Turn' : '🔴 Opponent\'s Turn'}</span>
                  )}
                </div>
                <div className="tictactoe-board">
                  {board.map((cell, idx) => (
                    <button
                      key={idx}
                      className={`board-cell ${cell ? 'filled' : ''} ${cell === mySymbol ? 'mine' : 'theirs'}`}
                      onClick={() => handleCellClick(idx)}
                      disabled={!isMyTurn || cell !== null || gameResult !== ''}
                    >{cell}</button>
                  ))}
                </div>
                {gameResult && <button className="game-reset-btn" onClick={requestGameReset}>Play Again</button>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'study' && (
          <div className="study-tab-content">
            <div className="study-section-card">
              <h3>🧠 Academic Trivia Quiz</h3>
              {!triviaQuizFinished ? (
                <div className="trivia-quiz-body">
                  <span className="trivia-progress">Question {currentTriviaIdx + 1}/{TRIVIA_QUESTIONS.length}</span>
                  <p className="trivia-question">{TRIVIA_QUESTIONS[currentTriviaIdx].question}</p>
                  <div className="trivia-options-grid">
                    {TRIVIA_QUESTIONS[currentTriviaIdx].options.map((opt, idx) => {
                      let btnClass = '';
                      if (isTriviaAnswered) {
                        if (opt === TRIVIA_QUESTIONS[currentTriviaIdx].answer) btnClass = 'correct';
                        else if (opt === selectedTriviaOption) btnClass = 'incorrect';
                        else btnClass = 'disabled';
                      }
                      return (
                        <button key={idx} className={`trivia-option-btn ${btnClass}`} onClick={() => handleTriviaAnswer(opt)} disabled={isTriviaAnswered}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {isTriviaAnswered && (
                    <button className="trivia-next-btn" onClick={handleNextTrivia}>
                      {currentTriviaIdx === TRIVIA_QUESTIONS.length - 1 ? 'Finish Quiz' : 'Next Question ➜'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="trivia-finished-card">
                  <h4>Quiz Complete!</h4>
                  <p className="trivia-final-score">Your Score: <strong>{triviaScore} / {TRIVIA_QUESTIONS.length * 10}</strong> pts</p>
                  <button className="trivia-reset-btn" onClick={resetTrivia}>Restart Quiz</button>
                </div>
              )}
            </div>

            <div className="study-section-card">
              <h3>📚 Concept Flashcards</h3>
              <div className="flashcard-wrapper">
                <div className={`flashcard ${isCardFlipped ? 'flipped' : ''}`} onClick={() => setIsCardFlipped(!isCardFlipped)}>
                  <div className="card-face front">
                    <span className="card-topic">{FLASHCARDS[flashcardIdx].topic}</span>
                    <h4 className="card-term">{FLASHCARDS[flashcardIdx].term}</h4>
                    <span className="click-instructions">Click to reveal definition</span>
                  </div>
                  <div className="card-face back">
                    <p className="card-def">{FLASHCARDS[flashcardIdx].definition}</p>
                    <span className="click-instructions">Click to see term</span>
                  </div>
                </div>
                <div className="flashcard-controls">
                  <button className="fc-nav-btn" onClick={() => { setFlashcardIdx(p => Math.max(0, p - 1)); setIsCardFlipped(false); }} disabled={flashcardIdx === 0}>◀ Prev</button>
                  <span>{flashcardIdx + 1} / {FLASHCARDS.length}</span>
                  <button className="fc-nav-btn" onClick={() => { setFlashcardIdx(p => Math.min(FLASHCARDS.length - 1, p + 1)); setIsCardFlipped(false); }} disabled={flashcardIdx === FLASHCARDS.length - 1}>Next ▶</button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="sidebar-footer-encryption">
          <p>AES-256 Bit Encryption Active.</p>
          <p className="footer-link">Learn about our <a href="#security">Security Protocol</a>.</p>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-area">
        <div className="chat-header">
          <div className="chat-header-info">
            <button className="sidebar-toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>
            <div className="chat-header-icon-container">
              <div className="chat-header-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>
              </div>
            </div>
            <div className="chat-header-text">
              <span className="chat-room-name">{activeChat === 'global' ? 'Global Lobby Chat' : `Chat with ${activeChat.username}`}</span>
              <span className="chat-room-status">
                <span className="status-dot-green"></span>
                Secure Encrypted Connection
              </span>
            </div>
          </div>
          <div className="e2ee-badge-minimal">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <span>Shared E2EE</span>
          </div>
        </div>

        <div className="chat-messages-container">
          {activeChatHistory.map((msg) => {
            if (msg.user === '__system__') {
              return (
                <div key={msg.id} className="system-msg-wrapper">
                  <div className="system-msg-pill">{msg.text}</div>
                </div>
              );
            }
            const isOwnMessage = msg.user === username;
            return (
              <div key={msg.id} className={`msg-wrapper ${isOwnMessage ? 'sent' : 'received'}`}>
                {!isOwnMessage && (
                  <div className="msg-avatar" style={{ backgroundColor: msg.avatarColor || '#34B7F1' }} title={msg.user}>
                    {msg.user.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="msg-bubble">
                  {!isOwnMessage && (
                    <span className="msg-bubble-user" style={{ color: msg.avatarColor || '#34B7F1' }}>{msg.user}</span>
                  )}
                  {msg.isFile ? (
                    <div className="chat-file-attachment">
                      {msg.fileType?.startsWith('image/') ? (
                        <img className="chat-media-image" src={msg.text} alt={msg.fileName} />
                      ) : msg.fileType?.startsWith('video/') ? (
                        <video className="chat-media-video" src={msg.text} controls />
                      ) : (
                        <div className="generic-file-card">
                          <span className="file-icon">📄</span>
                          <div className="file-details">
                            <span className="file-name">{msg.fileName}</span>
                            <a className="file-download-link" href={msg.text} download={msg.fileName}>Download File</a>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : msg.isCode ? (
                    <div className="chat-code-card">
                      <div className="code-card-header">
                        <span className="code-lang-tag">{msg.codeLanguage}</span>
                        <button className="code-copy-btn" onClick={() => copyToClipboard(msg.text, msg)}>Copy Code</button>
                      </div>
                      <pre className="code-snippet-pre"><code>{msg.text}</code></pre>
                      {msg.copiedBy && msg.copiedBy.length > 0 && (
                        <div className="code-copied-tag">📋 Copied by: {msg.copiedBy.join(', ')}</div>
                      )}
                    </div>
                  ) : (
                    <p className="msg-bubble-text">{msg.text}</p>
                  )}
                  <div className="msg-bubble-meta">
                    <span className="msg-bubble-time">{msg.time}</span>
                    {isOwnMessage && (
                      <>
                        <span className="e2ee-check" title="E2E Encrypted Payload Delivered">🔒</span>
                        {activeChat === 'global' ? (
                          msg.readBy && msg.readBy.filter(u => u !== username).length > 0 && (
                            <span className="read-receipt-tag" title={`Read by: ${msg.readBy.filter(u => u !== username).join(', ')}`}>
                              ✓✓ Read ({msg.readBy.filter(u => u !== username).length})
                            </span>
                          )
                        ) : (
                          msg.readBy && msg.readBy.includes(activeChat.username) ? (
                            <span className="read-receipt-tag read" title="Read by recipient">✓✓ Read</span>
                          ) : (
                            <span className="read-receipt-tag" title="Sent, unread">✓ Sent</span>
                          )
                        )}
                      </>
                    )}
                  </div>
                </div>
                {isOwnMessage && (
                  <div className="msg-avatar mine" style={{ backgroundColor: userColor || '#8B5CF6' }} title="You">
                    {username.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            );
          })}

          {activeTyping.map((typingUser) => (
            <div key={typingUser} className="typing-indicator-container">
              <span className="typing-text">{typingUser} is typing</span>
              <div className="typing-dots">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="input-bar-wrapper">
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} accept="image/*,video/*,application/pdf,.doc,.docx,.zip,.rar,.txt" />
          <form onSubmit={handleSendMessage} className="input-bar">
            <div className="input-left-actions">
              <button type="button" className="input-icon-btn-minimal" onClick={() => fileInputRef.current?.click()} title="Upload file" disabled={isUploading || connectionStatus !== 'connected'}>@</button>
              <button type="button" className="input-icon-btn-minimal" onClick={() => setIsCodeModalOpen(true)} title="Share code" disabled={connectionStatus !== 'connected'}>&lt;/&gt;</button>
            </div>
            <div className="input-center-form">
              <input type="text" className="chat-input-minimal" placeholder={isUploading ? "Encrypting..." : "Type an encrypted message..."} value={message} onChange={handleInputChange} disabled={isUploading || connectionStatus !== 'connected'} />
            </div>
            <button type="submit" className={`send-btn-circular ${message.trim() ? 'active' : ''}`} disabled={!message.trim() || connectionStatus !== 'connected' || isUploading}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </form>
        </div>
      </div>

      {isCodeModalOpen && (
        <div className="code-modal-overlay">
          <div className="code-modal-card">
            <h3>Share Code Snippet</h3>
            <div className="code-modal-controls">
              <label>Programming Language:</label>
              <select value={codeLanguage} onChange={(e) => setCodeLanguage(e.target.value)}>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="sql">SQL</option>
                <option value="rust">Rust</option>
                <option value="golang">Go</option>
              </select>
            </div>
            <textarea className="code-modal-textarea" placeholder="Paste or write your source code here..." value={codeContent} onChange={(e) => setCodeContent(e.target.value)} />
            <div className="code-modal-actions">
              <button className="code-modal-btn cancel" onClick={() => setIsCodeModalOpen(false)}>Cancel</button>
              <button className="code-modal-btn send" onClick={sendCodeSnippet} disabled={!codeContent.trim()}>Encrypt & Share</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
