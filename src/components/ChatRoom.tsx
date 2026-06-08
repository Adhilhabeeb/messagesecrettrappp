import React, { useState, useEffect, useRef } from "react";
import { ref, push, set, onValue, limitToLast, query } from "firebase/database";
import { db } from "../firebase";
import { ChatMessage, ChatRoomInfo, UserProfile, RoomParticipant } from "../types";
import { encryptMessage, decryptMessage, generatePassphrase } from "../utils/crypto";
import { Mic, Send, Lock, Unlock, ShieldCheck, Database, Key, HelpCircle, AudioLines, Play, Pause, ChevronRight, Minimize, Milestone, Gamepad2, PhoneCall, VolumeX, Eye, Square, Copy, Check, Share2, MessageSquare, X, Power, ArrowLeft, LogOut } from "lucide-react";
import ChessGame from "./ChessGame";
import ConnectFourGame from "./ConnectFourGame";
import TicTacToeGame from "./TicTacToeGame";
import VoiceChat from "./VoiceChat";
import { motion, AnimatePresence } from "motion/react";

interface ChatRoomProps {
  roomInfo: ChatRoomInfo;
  currentUser: UserProfile;
  onLeave: () => void;
  isStealthActive: boolean;
  setIsStealthActive: (val: boolean) => void;
}

// Inline Dynamic Decrypted Audio Note Player for perfect encapsulation
function EncryptedVoicePlayer({ base64Audio, senderName }: { base64Audio: string; senderName: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!base64Audio) return;
    try {
      // Decode base64 back to raw binary data
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes.buffer], { type: "audio/webm" });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      audio.onloadedmetadata = () => setDuration(audio.duration || 0);
      audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
      audio.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };
      
      audioRef.current = audio;
      
      return () => {
        audio.pause();
        URL.revokeObjectURL(audioUrl);
      };
    } catch (e) {
      console.error("Failed to construct audio URL", e);
    }
  }, [base64Audio]);

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 bg-zinc-950/80 border border-zinc-800 p-2 px-3 rounded-lg w-full max-w-[240px] shadow-inner select-none">
      <button
        onClick={togglePlayback}
        className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center transition-all cursor-pointer shadow-md"
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="h-5 flex items-center gap-0.5 mt-0.5">
          {Array.from({ length: 18 }).map((_, i) => {
            const h = isPlaying ? Math.floor(4 + Math.random() * 16) : 6;
            return (
              <div
                key={i}
                style={{ height: `${h}px` }}
                className={`w-0.5 rounded-full transition-all duration-200 ${
                  isPlaying ? "bg-emerald-400" : "bg-zinc-700"
                }`}
              />
            );
          })}
        </div>
        <div className="flex justify-between items-center text-[8px] text-zinc-500 font-mono">
          <span>{currentTime.toFixed(1)}s</span>
          <span>E2EE Voice Note</span>
        </div>
      </div>
    </div>
  );
}

export default function ChatRoom({ roomInfo, currentUser, onLeave, isStealthActive, setIsStealthActive }: ChatRoomProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [decryptedTextMap, setDecryptedTextMap] = useState<{ [msgId: string]: string }>({});
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeVoicePeers, setActiveVoicePeers] = useState<any[]>([]);
  
  // Tab layout toggle (Main panels)
  const [showChat, setShowChat] = useState(true);
  const [showVoiceInline, setShowVoiceInline] = useState(true);
  const [autoJoinVoice, setAutoJoinVoice] = useState(false);
  const [isLargeScreen, setIsLargeScreen] = useState(true);

  // Active Game Synchronization state
  const [activeGame, setActiveGame] = useState<string>("chess");

  useEffect(() => {
    const activeGameRef = ref(db, `rooms/${roomInfo.roomId}/activeGame`);
    const unsubscribe = onValue(activeGameRef, (snapshot) => {
      if (snapshot.exists()) {
        setActiveGame(snapshot.val());
      } else {
        setActiveGame("chess");
      }
    });

    return () => unsubscribe();
  }, [roomInfo.roomId]);

  const handleSwitchGame = (gameId: string) => {
    const activeGameRef = ref(db, `rooms/${roomInfo.roomId}/activeGame`);
    set(activeGameRef, gameId);
  };

  // Responsive screen size listener (threshold 1024px)
  useEffect(() => {
    const checkSize = () => {
      setIsLargeScreen(window.innerWidth >= 1024);
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);

  // Monitor physical suspension, lid close, OS lock triggers (only on visibility change e.g. when app is backgrounded or screen sleeps)
  useEffect(() => {
    const triggerStealthActions = () => {
      setIsStealthActive(true);
      setShowChat(false);
    };

    const handleVisibility = () => {
      if (document.hidden || document.visibilityState === "hidden") {
        triggerStealthActions();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Sync state transitions securely so mobile screens don't get cluttered, and keep closed in stealth
  useEffect(() => {
    if (!isLargeScreen) {
      setShowChat(false);
    } else {
      setShowChat(isStealthActive ? false : true);
    }
  }, [isLargeScreen, isStealthActive]);

  // Handle simultaneous volume increase and decrease keys/buttons (e.g. VolumeUp & VolumeDown, ArrowUp & ArrowDown, or + & -)
  useEffect(() => {
    const keysPressed = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.add(e.key);

      const hasVolUp = keysPressed.has("AudioVolumeUp") || 
                       keysPressed.has("+") || 
                       keysPressed.has("=") || 
                       keysPressed.has("ArrowUp");
                       
      const hasVolDown = keysPressed.has("AudioVolumeDown") || 
                         keysPressed.has("-") || 
                         keysPressed.has("ArrowDown");

      if (hasVolUp && hasVolDown) {
        // Prevent default screen scrolling or browser volume actions for discrete activation
        e.preventDefault();

        // Toggle stealth panic mode!
        setIsStealthActive(!isStealthActive);
        if (!isStealthActive) {
          // Entering stealth: hide chat
          setShowChat(false);
        } else {
          // Leaving stealth: restore chat window for larger monitors
          if (isLargeScreen) {
            setShowChat(true);
          }
        }

        // Wipe pressed keys to prevent multi-trigger debounce glitches
        keysPressed.clear();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.delete(e.key);
    };

    const handleBlur = () => {
      keysPressed.clear();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [isStealthActive, isLargeScreen, setIsStealthActive]);

  const toggleChat = () => {
    if (isStealthActive) return; // Disallow opening chat during stealth hide state
    setShowChat((prev) => !prev);
  };

  const handleResumeStealth = () => {
    setIsStealthActive(false);
    if (isLargeScreen) {
      setShowChat(true);
    }
  };

  const toggleVoiceInline = () => {
    setShowVoiceInline((prev) => !prev);
  };
  
  // Crypt Inspect modal state
  const [inspectedMessage, setInspectedMessage] = useState<ChatMessage | null>(null);
  const [inspectedPlaintext, setInspectedPlaintext] = useState("");

  const [copiedId, setCopiedId] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(roomInfo.roomId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2050);
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(roomInfo.passphrase);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2050);
  };

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?roomId=${roomInfo.roomId}&key=${roomInfo.passphrase}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2050);
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  // Monitor voice peers in room for visual active stream alerts
  useEffect(() => {
    const peersRef = ref(db, `rooms/${roomInfo.roomId}/voice/peers`);
    const unsubscribe = onValue(peersRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const list = Object.keys(data).map((key) => ({
          userId: key,
          ...data[key],
        }));
        setActiveVoicePeers(list);
      } else {
        setActiveVoicePeers([]);
      }
    });

    return () => unsubscribe();
  }, [roomInfo.roomId]);

  // Read raw messages from database
  useEffect(() => {
    const msgsRef = query(ref(db, `rooms/${roomInfo.roomId}/messages`), limitToLast(50));
    const unsubscribe = onValue(msgsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const loaded: ChatMessage[] = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
        setMessages(loaded.sort((a, b) => a.timestamp - b.timestamp));
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, [roomInfo.roomId]);

  // Decrypt incoming encrypted ciphers as they arrive
  useEffect(() => {
    messages.forEach(async (msg) => {
      if (decryptedTextMap[msg.id] !== undefined) return;

      try {
        const plain = await decryptMessage(msg.ciphertext, msg.iv, roomInfo.passphrase);
        setDecryptedTextMap((prev) => ({
          ...prev,
          [msg.id]: plain,
        }));
      } catch {
        setDecryptedTextMap((prev) => ({
          ...prev,
          [msg.id]: "[Decryption Error]",
        }));
      }
    });
  }, [messages, roomInfo.passphrase]);

  // Scroll to bottom of chat transcript on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, decryptedTextMap]);

  // Send textual E2EE message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    try {
      const { ciphertext, iv } = await encryptMessage(inputText.trim(), roomInfo.passphrase);
      
      const newMsgRef = push(ref(db, `rooms/${roomInfo.roomId}/messages`));
      const payload: Omit<ChatMessage, "id"> = {
        senderId: currentUser.id,
        senderName: currentUser.username,
        senderColor: currentUser.color,
        ciphertext,
        iv,
        timestamp: Date.now(),
        type: "text",
      };

      await set(newMsgRef, payload);
      setInputText("");
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  // Start E2EE Audio recorder fallback
  const startRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        
        // Convert to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(",")[1];
          
          if (base64data) {
            // Encrypt the voice note using the ROOM encryption passphrase
            const { ciphertext, iv } = await encryptMessage(base64data, roomInfo.passphrase);
            
            const newMsgRef = push(ref(db, `rooms/${roomInfo.roomId}/messages`));
            const payload: Omit<ChatMessage, "id"> = {
              senderId: currentUser.id,
              senderName: currentUser.username,
              senderColor: currentUser.color,
              ciphertext,
              iv,
              timestamp: Date.now(),
              type: "voice",
            };
            await set(newMsgRef, payload);
          }
        };

        // Stop all tracks inside active stream
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("Mic permission blocked or not supported. Check browser setup.");
    }
  };

  // Finish audio recording note
  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Open crypt-analysis inspector block
  const handleInspectCrypt = async (msg: ChatMessage) => {
    setInspectedMessage(msg);
    const plain = decryptedTextMap[msg.id] || "...";
    setInspectedPlaintext(plain);
  };

  return (
    <div className="w-full h-screen flex flex-col bg-zinc-950 overflow-hidden font-sans text-zinc-100">
      
      {/* 1. Global Unified Premium Header - Reclaims space, highly responsive, has beautiful Exit action */}
      <header className="w-full border-b border-zinc-900 bg-zinc-950/90 backdrop-blur-md px-4 py-3 shrink-0 select-none z-30">
        <div className="max-w-[1920px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
          
          {/* Header Left: Exit button & Room Info & E2EE Credentials */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onLeave}
              className="group flex items-center gap-1.5 p-2 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-zinc-100 hover:bg-red-950/40 hover:border-red-900/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.07)] transition-all cursor-pointer shrink-0"
              title="Exit Chatroom to Dashboard"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:-translate-x-0.5 group-hover:text-red-400 transition-all" />
              <span className="hidden xs:inline">Exit Room</span>
            </button>

            <div className="h-6 w-px bg-zinc-850"></div>

            <div className="flex flex-col min-w-0 gap-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" title="E2EE active connection" />
                <span className="font-sans font-bold text-xs xs:text-sm text-zinc-100 tracking-wide uppercase truncate">
                  {roomInfo.name}
                </span>
              </div>
              
              {/* E2EE credentials row - extremely compact & interactive */}
              {!isStealthActive ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* ID element */}
                  <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-[2px] font-mono text-[9px] text-zinc-400">
                    <span className="text-zinc-500 font-bold font-mono">Code:</span>
                    <span className="text-zinc-300 select-all font-semibold font-mono">{roomInfo.roomId}</span>
                    <button
                      onClick={handleCopyId}
                      title="Copy Room ID"
                      type="button"
                      className="p-0.5 text-zinc-650 hover:text-white transition-all cursor-pointer"
                    >
                      {copiedId ? (
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                    </button>
                  </div>

                  {/* Secret Crypt Key element */}
                  <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-[2px] font-mono text-[9px] text-zinc-400">
                    <Lock className="w-2.5 h-2.5 text-amber-500/80 animate-pulse" />
                    <span className="text-zinc-500 font-bold font-mono">Key:</span>
                    <span className="text-amber-500/90 font-semibold select-all font-mono truncate max-w-[70px] xs:max-w-none">{roomInfo.passphrase}</span>
                    <button
                      onClick={handleCopyKey}
                      title="Copy Secret Key"
                      type="button"
                      className="p-0.5 text-zinc-650 hover:text-white transition-all cursor-pointer"
                    >
                      {copiedKey ? (
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-red-950/20 border border-red-900/30 rounded px-1.5 py-[2px] text-[9px] text-red-400 font-mono select-none">
                  <ShieldCheck className="w-3 h-3 text-red-400 animate-pulse" /> Secure Feed Hushed
                </div>
              )}
            </div>
          </div>

          {/* Header Right: Share Controls & Drawers toggling & user Profile */}
          <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
            {isStealthActive ? (
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleResumeStealth}
                  initial={{ scale: 0.95 }}
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                  title="Resume Cryptographic Session"
                  type="button"
                  className="flex items-center gap-1.5 p-2 px-3 sm:px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-zinc-950 text-xs font-bold tracking-tight shadow-[0_0_15px_rgba(245,158,11,0.25)] hover:shadow-[0_0_25px_rgba(245,158,11,0.45)] transition-all cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5 fill-zinc-950 shrink-0" />
                  <span>Resume Secure Feed</span>
                </motion.button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <button
                  onClick={handleCopyLink}
                  title="Copy Shareable E2EE Room Link"
                  type="button"
                  className={`flex items-center gap-1.5 p-2 px-2.5 sm:px-3 rounded-xl border text-xs font-semibold tracking-tight transition-all cursor-pointer ${
                    copiedLink
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                      : "bg-indigo-500/5 border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/15 hover:text-indigo-305 hover:text-indigo-300"
                  }`}
                >
                  {copiedLink ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Share2 className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                  )}
                  <span>Share Link</span>
                </button>

                <button
                  onClick={toggleChat}
                  type="button"
                  className={`flex items-center gap-1.5 p-2 px-2.5 sm:px-3.5 rounded-xl border text-xs font-semibold tracking-tight transition-all cursor-pointer relative ${
                    showChat
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-350 hover:bg-zinc-800 hover:text-white"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                  <span>Secret Chat</span>
                  {messages.length > 0 && !showChat && (
                    <span className="absolute -top-1 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setIsStealthActive(true)}
                  title="Immediate Panic Lock (Stealth Mode) — Hotkey: Volume Up + Down, ArrowUp + ArrowDown, or + & - together"
                  type="button"
                  className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-red-950/20 hover:border-red-900/50 text-zinc-400 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center shrink-0 w-8.5 h-8.5"
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="h-6 w-px bg-zinc-850 hidden sm:block"></div>

            <div className="flex items-center gap-1.5 bg-zinc-900/30 border border-zinc-850 p-1 px-2 rounded-xl text-xs font-semibold font-sans">
              <span className="w-5.5 h-5.5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs select-none">
                {currentUser.avatar}
              </span>
              <span className={`hidden md:inline font-semibold ${currentUser.color}`}>{currentUser.username}</span>
            </div>
          </div>

        </div>
      </header>

      {/* Main split viewport layout */}
      <div className="flex-1 w-full flex relative overflow-hidden">
        
        {/* Central Main Chess Area */}
        <div className="flex-1 flex flex-col h-full bg-zinc-950 font-sans relative overflow-hidden">

          {/* Dynamic Glowing Live Call Started Notification */}
          {!isStealthActive && activeVoicePeers.filter((p) => p.userId !== currentUser.id).length > 0 && (
            <div className="bg-emerald-950/20 border-b border-emerald-900/40 px-4 py-2 flex items-center justify-between select-none animate-pulse shrink-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-xs text-zinc-200 font-sans">
                  <span className="font-semibold text-emerald-400">Live Call Active!</span>{" "}
                  {activeVoicePeers
                    .filter((p) => p.userId !== currentUser.id)
                    .map((p) => p.username)
                    .join(", ")}{" "}
                  invited you to talk.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowChat(true);
                  setShowVoiceInline(true);
                  setAutoJoinVoice(true);
                }}
                className="p-1 px-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-sans font-semibold rounded-lg shadow-md transition-all duration-200 cursor-pointer transform active:scale-95 animate-pulse"
              >
                Join
              </button>
            </div>
          )}

          {/* Real-time Game View Area (takes maximum space) */}
          <div className="flex-1 w-full h-full relative overflow-hidden flex flex-col">
            {/* Elegant Game Choice Selector Bar */}
            <div className="bg-zinc-950 px-4 py-2.5 flex items-center justify-between border-b border-zinc-900 select-none gap-2 shrink-0">
              <span className="text-[10px] font-sans font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 shrink-0 select-none">
                <Gamepad2 className="w-3.5 h-3.5 text-zinc-500 animate-pulse" /> Active Table View:
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
                {[
                  { id: "chess", label: "Chess Stakes", icon: "♟️" },
                  { id: "connect4", label: "Connect Four", icon: "🔴" },
                  { id: "tictactoe", label: "Tic-Tac-Toe", icon: "❌" }
                ].map((game) => {
                  const isActive = activeGame === game.id;
                  return (
                    <button
                      key={game.id}
                      onClick={() => handleSwitchGame(game.id)}
                      className={`px-3 py-1 text-[11px] rounded-lg font-bold font-sans transition-all duration-250 flex items-center gap-1 cursor-pointer select-none border whitespace-nowrap active:scale-95 ${
                        isActive
                          ? "bg-amber-500/10 border-amber-500/35 text-amber-400 font-bold shadow-[0_0_15px_rgba(245,158,11,0.06)]"
                          : "bg-zinc-900/40 border-zinc-850 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/60"
                      }`}
                    >
                      <span className="text-xs shrink-0">{game.icon}</span>
                      <span>{game.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 w-full h-full relative overflow-hidden">
              {activeGame === "chess" && (
                <ChessGame roomId={roomInfo.roomId} currentUser={currentUser} />
              )}
              {activeGame === "connect4" && (
                <ConnectFourGame roomId={roomInfo.roomId} currentUser={currentUser} />
              )}
              {activeGame === "tictactoe" && (
                <TicTacToeGame roomId={roomInfo.roomId} currentUser={currentUser} />
              )}
            </div>
          </div>
        </div>

      {/* Slide-out Secret Messages and Voice Drawer */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={isLargeScreen ? { width: 0, opacity: 0 } : { x: "100%", opacity: 0 }}
            animate={isLargeScreen ? { width: "380px", opacity: 1 } : { x: 0, opacity: 1 }}
            exit={isLargeScreen ? { width: 0, opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className={
              isLargeScreen
                ? "h-full border-l border-zinc-900 overflow-hidden flex flex-col shrink-0 bg-zinc-950 relative"
                : "absolute top-0 right-0 h-full w-full sm:w-[380px] border-l border-zinc-900 overflow-hidden flex flex-col shrink-0 bg-zinc-950 z-50 shadow-2xl"
            }
          >
            {/* Drawer Header with Title and Control Buttons */}
            <div className="flex items-center justify-between px-3.5 py-3 bg-zinc-950 border-b border-zinc-900 gap-2 select-none shrink-0">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                <span className="font-sans font-semibold text-xs text-zinc-300 uppercase tracking-widest">Secret Chat</span>
              </div>
              
              <div className="flex items-center gap-1.5">
                {/* Caller control button prominently on top of messages list */}
                <button
                  onClick={toggleVoiceInline}
                  title={showVoiceInline ? "Minimize Voice Console" : "Expand Voice Console"}
                  className={`flex items-center p-1.5 rounded-lg border text-xs font-sans font-medium transition-all cursor-pointer ${
                    showVoiceInline
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <PhoneCall className="w-3.5 h-3.5 shrink-0" />
                </button>
                
                <button
                  onClick={() => setShowChat(false)}
                  title="Close Secret Chat"
                  className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Calling Node Container on top of messages */}
            <AnimatePresence>
              {showVoiceInline && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-zinc-900/40 border-b border-zinc-900 overflow-hidden shrink-0"
                >
                  <div className="p-3.5 space-y-3.5">
                    <div className="flex items-center justify-between text-[9px] font-mono uppercase text-zinc-500 select-none">
                      <span>Secure Audio Node Console</span>
                      <span className="flex h-1.5 w-1.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                    </div>
                    <VoiceChat roomId={roomInfo.roomId} currentUser={currentUser} autoJoin={autoJoinVoice} forceMute={isStealthActive} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Message Transcript panel */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 font-sans bg-zinc-950 scrollbar-thin">
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                const decryptedVal = decryptedTextMap[msg.id];
                
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[85%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"}`}
                  >
                    {/* Sender badge */}
                    <span className="text-[10px] text-zinc-500 mb-1 flex items-center gap-1.5 font-sans">
                      <span className={`${msg.senderColor || "text-zinc-400"} font-medium`}>
                        {msg.senderName}
                      </span>
                      <span className="text-[9px] text-zinc-650 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>

                    {/* Bubble Block */}
                    <div className={`flex items-start gap-2 group ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`p-3 rounded-2xl relative shadow-md ${
                          isMe
                            ? "bg-amber-500 text-zinc-950 font-sans border-t border-r border-amber-300 rounded-tr-none"
                            : "bg-zinc-900 text-zinc-100 font-sans border border-zinc-800 rounded-tl-none"
                        }`}
                      >
                        {/* Plaintext / Voice player */}
                        {msg.type === "voice" ? (
                          decryptedVal && !decryptedVal.startsWith("[Encrypted") ? (
                            <EncryptedVoicePlayer base64Audio={decryptedVal} senderName={msg.senderName} />
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-mono italic">
                              <Lock className="w-3.5 h-3.5" /> Decrypting Voice Note...
                            </div>
                          )
                        ) : (
                          <p className="text-xs leading-relaxed break-all font-sans whitespace-pre-wrap">{decryptedVal || "..."}</p>
                        )}
                      </div>

                      {/* Cryptographic Inspect Trigger Key */}
                      <button
                        onClick={() => handleInspectCrypt(msg)}
                        title="Audit Encrypted Storage Payload"
                        className="p-1.5 rounded-full bg-zinc-900/30 hover:bg-zinc-800 border border-zinc-900 hover:border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-all opacity-40 group-hover:opacity-100 cursor-pointer self-center"
                      >
                        <Database className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center text-zinc-600 select-none">
                  <Milestone className="w-10 h-10 text-zinc-800 mb-2 pointer-events-none" />
                  <p className="text-xs font-sans">No messages recorded in this secure node</p>
                  <p className="text-[10px] font-mono text-zinc-700 mt-1 max-w-xs leading-relaxed">
                    Type a secure message below or hold the microphone to transmit and encrypt while playing.
                  </p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input Bottom Form */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-zinc-950 border-t border-zinc-900 flex items-center gap-2 select-none shrink-0"
            >
              {/* Audio Note Recorder Key */}
              {isRecording ? (
                <motion.button
                  type="button"
                  onClick={stopRecording}
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="p-2.5 rounded-lg bg-red-600 text-white flex items-center justify-center transition-all cursor-pointer border border-red-500 shadow shadow-red-500/20"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span className="ml-2 font-mono text-xs">{recordingSeconds}s · Transmitting</span>
                </motion.button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  title="Record Encrypted Voice Note"
                  className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer hover:bg-zinc-800"
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}

              <input
                type="text"
                placeholder={isRecording ? "Transmitting active stream..." : "Type E2EE message..."}
                disabled={isRecording}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-3 text-base text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 font-sans"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-2.5 rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500 transition-colors flex items-center justify-center cursor-pointer shadow-md shadow-amber-500/5"
              >
                <Send className="w-4 h-4 text-zinc-950" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dark Backdrop helper trigger for mobile/tablet */}
      <AnimatePresence>
        {!isLargeScreen && showChat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setShowChat(false);
            }}
            className="absolute inset-0 bg-black/80 z-40 cursor-pointer"
          />
        )}
      </AnimatePresence>
    </div>

      {/* Crypt Inspector Drawer Drawer */}
      <AnimatePresence>
        {inspectedMessage && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            className="absolute bottom-0 inset-x-0 bg-zinc-950 border-t border-zinc-800 rounded-t-2xl shadow-2xl p-6 z-50 max-h-[70%] overflow-y-auto select-none"
          >
            <div className="flex justify-between items-center pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-500" />
                <h3 className="font-sans font-semibold text-sm text-zinc-100">
                  Database Payload Integrity Audit
                </h3>
              </div>
              <button
                onClick={() => setInspectedMessage(null)}
                className="p-1 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-sans cursor-pointer"
              >
                Close Audit
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 text-xs font-mono">
              {/* Left Side: Server View */}
              <div className="flex flex-col gap-2 bg-black/40 border border-zinc-900 p-3.5 rounded-xl">
                <span className="text-red-400 font-bold tracking-wider uppercase text-[10px] flex items-center gap-1">
                  <Database className="w-3.5 h-3.5" /> Firebase RTDB (As written in the Cloud)
                </span>
                <div className="bg-black/80 rounded p-2.5 text-[11px] leading-relaxed text-zinc-300 break-all overflow-x-auto select-all max-h-48 scrollbar-thin">
                  {`{
  "senderId": "${inspectedMessage.senderId}",
  "senderName": "${inspectedMessage.senderName}",
  "type": "${inspectedMessage.type}",
  "uuid": "${inspectedMessage.id}",
  "timestamp": ${inspectedMessage.timestamp},
  "iv": "${inspectedMessage.iv}",
  "ciphertext": "${inspectedMessage.ciphertext.substring(0, 160)}..."
}`}
                </div>
                <p className="text-[10px] text-zinc-500 font-sans mt-1">
                  * Note that the actual message is entirely indecipherable by Google/Firebase or any network packet inspector. Only the client has the unique mathematical key derived from the passphrase to reverse this.
                </p>
              </div>

              {/* Right Side: Client decryption View */}
              <div className="flex flex-col gap-2 bg-emerald-950/5 border border-emerald-900/10 p-3.5 rounded-xl">
                <span className="text-emerald-400 font-bold tracking-wider uppercase text-[10px] flex items-center gap-1.5">
                  <Unlock className="w-3.5 h-3.5" /> Client Sandbox Decoded (PlainText)
                </span>
                <div className="bg-black/40 rounded p-3 select-all max-h-48 overflow-y-auto font-sans text-emerald-300 text-xs">
                  {inspectedMessage.type === "voice" ? (
                    <div className="flex flex-col gap-2 font-sans select-none">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px]">
                        <Key className="w-3.5 h-3.5" /> Decrypted WebM base-64 bits
                      </div>
                      <span className="font-mono text-[9px] break-all text-zinc-400 line-clamp-4">
                        {inspectedPlaintext.substring(0, 300)}...
                      </span>
                    </div>
                  ) : (
                    inspectedPlaintext
                  )}
                </div>
                
                <div className="flex flex-col gap-1 text-[10px] text-zinc-400 mt-2 font-mono">
                  <div className="flex justify-between border-b border-zinc-900/60 pb-1">
                    <span>Active Algorithm:</span>
                    <span className="text-emerald-400">AES-GCM (256-bit)</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-900/60 pb-1">
                    <span>Key Source:</span>
                    <span className="text-amber-500">PBKDF2 (100k Iterations)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IV Vector Base64:</span>
                    <span className="text-zinc-500 truncate max-w-[120px]">{inspectedMessage.iv}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
