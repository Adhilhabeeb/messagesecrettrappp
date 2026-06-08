// Utility for End-to-End Encryption (E2EE) using Web Crypto API (AES-GCM 256)

// Cache derived keys in memory to avoid redundant PBKDF2 derivations (which are performance-intensive)
const derivedKeyCache: { [passphrase: string]: CryptoKey } = {};

// Convert string to Uint8Array
function strToBuf(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Convert Uint8Array to string
function bufToStr(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

// Convert Uint8Array/ArrayBuffer to Base64 String
function bufToBase64(buf: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buf));
  return window.btoa(binary);
}

// Convert Base64 String to Uint8Array
function base64ToBuf(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a given passphrase.
 */
async function getEncryptionKey(passphrase: string): Promise<CryptoKey> {
  if (derivedKeyCache[passphrase]) {
    return derivedKeyCache[passphrase];
  }

  // Use a fixed salt for the PBKDF2 derivation
  const salt = strToBuf("secure_chat_and_chess_salt_permanent_2026");
  
  const rawKeyMaterial = await window.crypto.subtle.importKey(
    "raw",
    strToBuf(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    rawKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  derivedKeyCache[passphrase] = derivedKey;
  return derivedKey;
}

/**
 * Encrypts a plaintext string using a derived key from the given passphrase.
 * Returns both the base64-encoded ciphertext and the hex/base64-encoded initialization vector (IV).
 */
export async function encryptMessage(
  plaintext: string,
  passphrase: string
): Promise<{ ciphertext: string; iv: string }> {
  try {
    if (!plaintext || !passphrase) {
      throw new Error("Missing plaintext or encryption passphrase");
    }

    const key = await getEncryptionKey(passphrase);
    
    // Generate a secure, unique 12-byte IV for AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      key,
      strToBuf(plaintext)
    );

    return {
      ciphertext: bufToBase64(ciphertextBuffer),
      iv: bufToBase64(iv)
    };
  } catch (error) {
    console.error("Encryption failed:", error);
    throw error;
  }
}

/**
 * Decrypts a base64 ciphertext using the corresponding base64 IV and room passphrase.
 */
export async function decryptMessage(
  ciphertext: string,
  iv: string,
  passphrase: string
): Promise<string> {
  try {
    if (!ciphertext || !iv || !passphrase) {
      return "[Undecryptable: Missing credentials]";
    }

    const key = await getEncryptionKey(passphrase);
    const ivBuffer = base64ToBuf(iv);
    const ciphertextBuffer = base64ToBuf(ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer
      },
      key,
      ciphertextBuffer
    );

    return bufToStr(decryptedBuffer);
  } catch (error) {
    console.warn("Decryption failed. Room key might be incorrect or modified.");
    return `[Encrypted cipher: ${ciphertext.substring(0, 16)}...]`;
  }
}

/**
 * Generates a strong, random room code (12 characters).
 */
export function generateRoomCode(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomBytes = new Uint8Array(12);
  window.crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 12; i++) {
    result += characters[randomBytes[i] % characters.length];
  }
  return result;
}

/**
 * Generates a random, elegant room passphrase (human readable: 3 words + number).
 */
export function generatePassphrase(): string {
  const adjectives = ["silent", "secure", "cosmic", "hidden", "velvet", "frost", "shadow", "copper", "crypto", "ancient"];
  const nouns = ["key", "matrix", "vault", "castle", "quantum", "whisper", "knight", "pawn", "nebula", "cipher"];
  const verbs = ["play", "chat", "seek", "lurk", "dash", "glow", "soar", "vortex", "pulse", "echo"];
  
  const rand = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const num = Math.floor(100 + Math.random() * 900); // 3-digit number
  
  return `${rand(adjectives)}-${rand(nouns)}-${rand(verbs)}-${num}`;
}
