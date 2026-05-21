/**
 * EduSphere Cryptography Engine
 * Uses the Web Crypto API for hardware-accelerated, zero-dependency, secure E2EE.
 * Supports ECDH (Elliptic Curve Diffie-Hellman) for zero-shared-password direct messaging keys.
 * Supports password-derived key escrow for session persistence.
 */

// Generate an ECDH Key Pair (P-256 Curve) — extractable so we can backup the private key
export async function generateECDHKeyPair() {
  try {
    return await window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable so we can JWK-export the private key for encrypted backup
      ['deriveKey']
    );
  } catch (error) {
    console.error('ECDH key generation failed:', error);
    throw error;
  }
}

// Exports an ECDH Public Key to a Base64 SPKI format for socket transport
export async function exportPublicKey(publicKey) {
  try {
    const exported = await window.crypto.subtle.exportKey('spki', publicKey);
    const binaryArray = new Uint8Array(exported);
    let binary = '';
    const len = binaryArray.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(binaryArray[i]);
    }
    return btoa(binary);
  } catch (error) {
    console.error('Public key export failed:', error);
    throw error;
  }
}

// Imports an ECDH Public Key from a Base64 SPKI string
export async function importPublicKey(spkiBase64) {
  try {
    const binaryString = atob(spkiBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return await window.crypto.subtle.importKey(
      'spki',
      bytes,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      []
    );
  } catch (error) {
    console.error('Public key import failed:', error);
    throw error;
  }
}

// Derives a shared AES-GCM 256-bit symmetric key from our private key and the peer's public key
export async function deriveSharedKey(privateKey, peerPublicKey) {
  try {
    return await window.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: peerPublicKey
      },
      privateKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    console.error('Shared key derivation failed:', error);
    throw error;
  }
}

// Derives a cryptographic AES-GCM 256-bit key from the room passcode and salt (Room ID)
export async function deriveKey(passcode, roomId) {
  const enc = new TextEncoder();
  const rawKeyMaterial = enc.encode(passcode);
  
  // Use Room ID padded/sliced to 16 bytes as the salt
  const saltStr = roomId.padEnd(16, 'edusphere-salt').substring(0, 16);
  const salt = enc.encode(saltStr);

  try {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      rawKeyMaterial,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 50000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    console.error('Key derivation failed:', error);
    throw error;
  }
}

// Encrypts a plaintext string using AES-GCM
export async function encryptData(plaintext, cryptoKey) {
  if (!cryptoKey) return plaintext;
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  
  try {
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      enc.encode(plaintext)
    );

    // Convert IV and ciphertext to hex/base64 strings for socket conveyance
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherArray = new Uint8Array(ciphertext);
    
    // Efficient base64 conversion
    let binary = '';
    const len = cipherArray.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(cipherArray[i]);
    }
    const cipherBase64 = btoa(binary);

    return JSON.stringify({ iv: ivHex, data: cipherBase64 });
  } catch (error) {
    console.error('Encryption failed:', error);
    return plaintext;
  }
}

// Decrypts a ciphertext JSON string using AES-GCM
export async function decryptData(encryptedJson, cryptoKey) {
  if (!cryptoKey) return encryptedJson;
  
  try {
    const { iv: ivHex, data: cipherBase64 } = JSON.parse(encryptedJson);
    
    // Parse hex IV back to Uint8Array
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    // Convert base64 ciphertext back to Uint8Array
    const binaryString = atob(cipherBase64);
    const len = binaryString.length;
    const ciphertextBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      ciphertextBytes[i] = binaryString.charCodeAt(i);
    }

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertextBytes
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (error) {
    console.warn('Decryption failed (potentially due to incorrect passcode):', error);
    return '🔒 [Decryption Failed: Content encrypted with different passcode]';
  }
}

// Hashes a password securely for server-side authentication (never sends the raw password)
export async function hashPasswordForServer(password, username) {
  const enc = new TextEncoder();
  const inputStr = `edusphere:${username.toLowerCase()}:${password}`;
  const data = enc.encode(inputStr);
  
  try {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    console.error('Password hashing failed:', error);
    throw error;
  }
}

// Encrypts the ECDH private key (JWK) using a key derived from the user's password
// This allows us to store an encrypted backup on the server for session recovery
export async function encryptPrivateKey(privateKey, password, username) {
  try {
    // Export private key as JWK
    const jwk = await window.crypto.subtle.exportKey('jwk', privateKey);
    const jwkString = JSON.stringify(jwk);

    // Derive an AES key from the password
    const enc = new TextEncoder();
    const salt = enc.encode(`edusphere-escrow:${username.toLowerCase()}`.padEnd(16, '0').substring(0, 16));
    
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const wrappingKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Encrypt the JWK string
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrappingKey,
      enc.encode(jwkString)
    );

    // Encode for transport
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherArray = new Uint8Array(ciphertext);
    let binary = '';
    for (let i = 0; i < cipherArray.byteLength; i++) {
      binary += String.fromCharCode(cipherArray[i]);
    }
    const cipherBase64 = btoa(binary);

    return JSON.stringify({ iv: ivHex, data: cipherBase64 });
  } catch (error) {
    console.error('Private key encryption failed:', error);
    throw error;
  }
}

// Decrypts the ECDH private key (JWK) from an encrypted backup using the user's password
export async function decryptPrivateKey(encryptedData, password, username) {
  try {
    const { iv: ivHex, data: cipherBase64 } = JSON.parse(encryptedData);

    // Derive the same wrapping key from the password
    const enc = new TextEncoder();
    const salt = enc.encode(`edusphere-escrow:${username.toLowerCase()}`.padEnd(16, '0').substring(0, 16));
    
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const wrappingKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Decrypt
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const binaryString = atob(cipherBase64);
    const ciphertextBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      ciphertextBytes[i] = binaryString.charCodeAt(i);
    }

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      wrappingKey,
      ciphertextBytes
    );

    const dec = new TextDecoder();
    const jwk = JSON.parse(dec.decode(decrypted));

    // Import the private key back
    return await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      ['deriveKey']
    );
  } catch (error) {
    console.error('Private key decryption failed:', error);
    throw error;
  }
}
