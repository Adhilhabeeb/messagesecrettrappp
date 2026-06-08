export interface UserProfile {
  id: string;
  username: string;
  avatar: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  ciphertext: string; // AES-GCM encrypted content (either text or base64 audio)
  iv: string;         // AES-GCM Initialization Vector for this message
  timestamp: number;
  type: 'text' | 'voice';
  duration?: number;  // For voice notes
}

export interface VoiceSignaling {
  id: string;
  from: string;
  to: string;
  type: 'offer' | 'answer' | 'candidate';
  payload: string; // JSON string of RTCSessionDescription or RTCIceCandidate
  timestamp: number;
}

export interface ChessGameSync {
  fen: string;
  turn: 'w' | 'b';
  whitePlayer: UserProfile | null;
  blackPlayer: UserProfile | null;
  status: 'waiting' | 'active' | 'checkmate' | 'draw' | 'resigned';
  winner?: string | null;  // userId or 'draw'
  lastMove?: {
    from: string;
    to: string;
    piece: string;
    san: string;
  } | null;
  drawOfferFrom?: string | null;
  wager?: number;          // Proposed or negotiated match wager
  wagerPool?: number;      // Locked/deducted escrow pool for the current active match
  whiteWagerAgreed?: boolean; // If White agreed to the selected wager
  blackWagerAgreed?: boolean; // If Black agreed to the selected wager
  createdAt: number;
}

export interface ChatRoomInfo {
  roomId: string;
  name: string;
  passphrase: string; // The E2EE group security key
  createdAt: number;
}

export interface RoomParticipant {
  userId: string;
  username: string;
  avatar: string;
  color: string;
  lastActive: number;
  isOnline: boolean;
  voiceActive?: boolean;
  muted?: boolean;
}
