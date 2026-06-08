import React, { useState, useEffect } from "react";
import { ref, set, get } from "firebase/database";
import { db } from "./firebase";
import { UserProfile, ChatRoomInfo } from "./types";
import { generateRoomCode, generatePassphrase } from "./utils/crypto";
import UserProfileSettings from "./components/UserProfile";
import ChatRoom from "./components/ChatRoom";
import MiniChatOverlay from "./components/MiniChatOverlay";
import { Terminal, Lock, Key, Plus, LogIn, Edit2, ShieldAlert, Cpu, Heart, Check, Users, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [activeRoom, setActiveRoom] = useState<ChatRoomInfo | null>(null);
  const [isStealthActive, setIsStealthActive] = useState(false);

  // States for room creation
  const [newRoomName, setNewRoomName] = useState("");
  
  // States for room joining
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassphrase, setJoinPassphrase] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load existing user profile from localStorage during mount and auto-load shared URL params
  useEffect(() => {
    const saved = localStorage.getItem("secure_chat_user_profile");
    if (saved) {
      try {
        setCurrentUser(JSON.parse(saved));
      } catch (err) {
        console.error("Failed to parse saved user profile status", err);
      }
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const urlRoomId = params.get("roomId");
      const urlKey = params.get("key");
      if (urlRoomId) {
        setJoinRoomId(urlRoomId.trim());
      }
      if (urlKey) {
        setJoinPassphrase(urlKey.trim());
      }
    } catch (e) {
      console.warn("Could not parse shared room params from URL search:", e);
    }
  }, []);

  const handleProfileSaved = (profile: UserProfile) => {
    localStorage.setItem("secure_chat_user_profile", JSON.stringify(profile));
    setCurrentUser(profile);
    setIsEditingProfile(false);
  };

  // Create robust new Chat Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim() || !currentUser) return;

    try {
      const generatedCode = generateRoomCode();
      const generatedPass = generatePassphrase();
      
      const roomPayload: ChatRoomInfo = {
        roomId: generatedCode,
        name: newRoomName.trim(),
        passphrase: generatedPass,
        createdAt: Date.now(),
      };

      // Set inside RTDB
      const roomRef = ref(db, `rooms/${generatedCode}/info`);
      await set(roomRef, roomPayload);

      setActiveRoom(roomPayload);
      setNewRoomName("");
      setErrorMessage(null);
    } catch (err: any) {
      console.error("Room creation error", err);
      setErrorMessage("Database write restriction. Verify Firebase structure.");
    }
  };

  // Join existing E2EE Chat Room
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinRoomId.trim() || !joinPassphrase.trim() || !currentUser) return;

    setIsJoining(true);
    setErrorMessage(null);

    try {
      const dbRoomRef = ref(db, `rooms/${joinRoomId.trim()}/info`);
      const snapshot = await get(dbRoomRef);

      if (snapshot.exists()) {
        const data = snapshot.val() as ChatRoomInfo;
        
        // Active room exists, override passphrase with the user provided one which we will use to decrypt local storage
        const activeRoomPayload: ChatRoomInfo = {
          roomId: data.roomId,
          name: data.name,
          passphrase: joinPassphrase.trim(), // The custom key provided by the user is used to decypher and decrypt messages
          createdAt: data.createdAt,
        };

        setActiveRoom(activeRoomPayload);
        setJoinRoomId("");
        setJoinPassphrase("");
      } else {
        setErrorMessage("Room ID not found. Verify the code and try again.");
      }
    } catch (err: any) {
      console.error("Firebase query failed", err);
      setErrorMessage("Connection issue. Ensure database rules allow queries.");
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeaveRoom = () => {
    setActiveRoom(null);
    setIsStealthActive(false);
  };

  // 1. Un-configured User Profile state (Initial view)
  if (!currentUser || isEditingProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <UserProfileSettings
          onSaved={handleProfileSaved}
          initialProfile={currentUser}
        />
      </div>
    );
  }

  // 2. Active Encrypted Chat Room state
  if (activeRoom) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex flex-col overflow-hidden">
        <ChatRoom
          roomInfo={activeRoom}
          currentUser={currentUser}
          onLeave={handleLeaveRoom}
          isStealthActive={isStealthActive}
          setIsStealthActive={setIsStealthActive}
        />

        {/* Float Over message button */}
        {!isStealthActive && (
          <MiniChatOverlay roomInfo={activeRoom} currentUser={currentUser} />
        )}
      </div>
    );
  }

  // 3. User Dashboard panel
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none">
      {/* Visual Navigation Header */}
      <header className="px-6 py-4 bg-zinc-950/80 border-b border-zinc-900/60 flex justify-between items-center backdrop-blur-md select-none">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 animate-pulse">
            <Lock className="w-4 h-4" />
          </div>
          <h1 className="font-sans font-bold text-base tracking-tight text-zinc-100 uppercase">
            Secure Chat & Chess
          </h1>
        </div>

        {/* Mini user profile deck */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900/40 border border-zinc-900 p-1.5 rounded-xl px-3.5 select-none font-sans">
            <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold">
              {currentUser.avatar}
            </span>
            <span className={`text-xs font-sans font-semibold ${currentUser.color}`}>
              {currentUser.username}
            </span>
            <button
              onClick={() => setIsEditingProfile(true)}
              title="Edit Profile"
              className="ml-1.5 p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Panel Content grids */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-8 md:py-16 flex flex-col justify-center">
        
        {/* Core Description Title block */}
        <div className="text-center mb-8 max-w-lg mx-auto">
          <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-500/90 px-3 py-1 rounded-full font-mono uppercase tracking-widest">
            Cryptographic Sync Node
          </span>
          <h2 className="text-2xl font-sans font-bold tracking-tight text-zinc-100 mt-3 md:text-3xl leading-tight">
            Peer-to-Peer Encrypted Communication Loop
          </h2>
          <p className="text-xs text-zinc-500 mt-2 font-sans leading-relaxed">
            Create an isolated, client-side encrypted workspace. Instantly exchange keys, communicate with voice notes, initiate real-time audio rooms, and challenge peers in multiplayer Chess.
          </p>
        </div>

        {/* Setup Error state */}
        {errorMessage && (
          <div className="mb-6 p-3 bg-red-950/30 border border-red-900 text-red-300 rounded-lg text-xs font-mono flex items-center gap-2 max-w-sm mx-auto">
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Create Room widget */}
          <motion.div
            whileHover={{ y: -3 }}
            className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/[0.02] rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center gap-2.5 mb-4 select-none">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500">
                <Plus className="w-4.5 h-4.5" />
              </div>
              <h3 className="font-sans font-semibold text-sm text-zinc-100 uppercase tracking-wider">
                Create Secure Room
              </h3>
            </div>

            <p className="text-xs text-zinc-500 mb-6 font-sans leading-relaxed">
              Generates a new, isolated chatroom, a 12-character joining ID, and an auto-derived E2EE cryptographic unlock key.
            </p>

            <form onSubmit={handleCreateRoom} className="space-y-4 mt-auto">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Room Name
                </label>
                <input
                  type="text"
                  placeholder="Ex. Secret Strategy..."
                  maxLength={25}
                  required
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-3 text-base text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 py-2.5 px-4 rounded-lg font-sans font-medium text-xs transition-colors shadow-lg cursor-pointer transform hover:scale-[1.01]"
              >
                Assemble E2EE Node
              </button>
            </form>
          </motion.div>

          {/* Join Room widget */}
          <motion.div
            whileHover={{ y: -3 }}
            className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden"
          >
            <div className="absolute bottom-0 left-0 w-16 h-16 bg-indigo-500/[0.02] rounded-full blur-xl pointer-events-none"></div>

            <div className="flex items-center gap-2.5 mb-4 select-none">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <LogIn className="w-4.5 h-4.5" />
              </div>
              <h3 className="font-sans font-semibold text-sm text-zinc-100 uppercase tracking-wider">
                Enter Existing Room
              </h3>
            </div>

            <p className="text-xs text-zinc-500 mb-6 font-sans leading-relaxed">
              Sync into an established connection. You MUST input the specific Room ID and matching E2EE Secret Key to decypher payloads.
            </p>

            <form onSubmit={handleJoinRoom} className="space-y-4 mt-auto">
              <div className="grid grid-cols-2 gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    Room 12-ID
                  </label>
                  <input
                    type="text"
                    placeholder="Ex. Gf82h8d..."
                    required
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-3 text-base text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    Secret Key
                  </label>
                  <input
                    type="text"
                    placeholder="Ex. silent-key-..."
                    required
                    value={joinPassphrase}
                    onChange={(e) => setJoinPassphrase(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-3 text-base text-amber-500 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isJoining}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 py-2.5 px-4 rounded-lg font-sans font-medium text-xs transition-colors shadow-lg cursor-pointer disabled:opacity-50 transform hover:scale-[1.01]"
              >
                {isJoining ? "Negotiating handshakes..." : "Connect Workspace"}
              </button>
            </form>
          </motion.div>
        </div>
      </main>

      {/* Decorative clean footer */}
      <footer className="mt-auto px-6 py-4 border-t border-zinc-900/60 bg-zinc-950 flex flex-col md:flex-row justify-between items-center text-[10px] text-zinc-600 font-mono select-none gap-2">
        <div className="flex items-center gap-1">
          <Cpu className="w-3.5 h-3.5 text-zinc-700" />
          <span>CYPHER NODE VER: 2026.1 // LOCAL CRYPTO SANDBOX</span>
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 px-3 py-1 rounded border border-zinc-850">
          <span>REALTIME BACKEND</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
      </footer>
    </div>
  );
}
