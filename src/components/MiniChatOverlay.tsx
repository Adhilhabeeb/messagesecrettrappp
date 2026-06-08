import React, { useState, useEffect, useRef } from "react";
import { ref, push, set, onValue, limitToLast, query } from "firebase/database";
import { db } from "../firebase";
import { ChatMessage, ChatRoomInfo, UserProfile } from "../types";
import { decryptMessage, encryptMessage } from "../utils/crypto";
import { MessageSquare, X, Send, ShieldAlert, BadgeInfo } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface MiniChatOverlayProps {
  roomInfo: ChatRoomInfo;
  currentUser: UserProfile;
}

export default function MiniChatOverlay({ roomInfo, currentUser }: MiniChatOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [decryptedMap, setDecryptedMap] = useState<{ [msgId: string]: string }>({});
  const [replyText, setReplyText] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState<number>(Date.now());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Monitor total messages trail
  useEffect(() => {
    const msgsRef = query(ref(db, `rooms/${roomInfo.roomId}/messages`), limitToLast(8));
    const unsubscribe = onValue(msgsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const loaded: ChatMessage[] = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));

        const sorted = loaded.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(sorted);

        // Calculate unread badge count
        if (!isOpen) {
          const unreads = sorted.filter((m) => m.timestamp > lastSeenTimestamp && m.senderId !== currentUser.id);
          setUnreadCount(unreads.length);
        }
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, [roomInfo.roomId, lastSeenTimestamp, isOpen, currentUser.id]);

  // Decode E2EE messages on-the-fly inside the overlay
  useEffect(() => {
    messages.forEach(async (msg) => {
      if (decryptedMap[msg.id] !== undefined) return;
      try {
        const plain = await decryptMessage(msg.ciphertext, msg.iv, roomInfo.passphrase);
        setDecryptedMap((prev) => ({
          ...prev,
          [msg.id]: plain,
        }));
      } catch {
        setDecryptedMap((prev) => ({
          ...prev,
          [msg.id]: "[Encrypted message]",
        }));
      }
    });
  }, [messages, roomInfo.passphrase]);

  // Reset counters when expanded to view
  const handleOpenToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setUnreadCount(0);
      setLastSeenTimestamp(Date.now());
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  // Submit quick-reply message instantly
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;

    try {
      const { ciphertext, iv } = await encryptMessage(replyText.trim(), roomInfo.passphrase);
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
      setReplyText("");
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      console.error("Failed to send quick reply", err);
    }
  };

  return (
    <div className="absolute bottom-4 right-4 z-40 flex flex-col items-end pointer-events-none select-none">
      
      {/* Expanded Quick-reply Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 15 }}
            className="w-72 sm:w-80 h-96 bg-zinc-950/95 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col mb-3 pointer-events-auto overflow-hidden relative backdrop-blur-md"
          >
            {/* Header section */}
            <div className="p-3 bg-zinc-950 border-b border-zinc-900 flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-amber-500" />
                <span className="font-sans font-semibold text-xs text-zinc-100 uppercase tracking-wider">
                  Quick Reply Node
                </span>
                <span className="px-1.5 py-0.2 rounded text-[8px] bg-emerald-950/50 border border-emerald-900 text-emerald-400 font-mono">
                  E2EE Secure
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Messages body list */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-zinc-950 scrollbar-none">
              {messages.map((m) => {
                const isMe = m.senderId === currentUser.id;
                const plain = decryptedMap[m.id];
                
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col max-w-[90%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"}`}
                  >
                    <span className="text-[9px] text-zinc-500 mb-0.5 font-sans">
                      <span className={`${m.senderColor || "text-zinc-400"} font-medium`}>{m.senderName}</span>
                    </span>
                    <div
                      className={`p-2.5 px-3.5 rounded-xl text-xs font-sans leading-normal ${
                        isMe
                          ? "bg-amber-500 text-zinc-900 rounded-tr-none"
                          : "bg-zinc-900 text-zinc-200 border border-zinc-900 rounded-tl-none"
                      }`}
                    >
                      <p className="break-all whitespace-pre-wrap">{plain || "..."}</p>
                    </div>
                  </div>
                );
              })}
              
              {messages.length === 0 && (
                <div className="text-center py-10 opacity-30 font-sans flex flex-col items-center">
                  <BadgeInfo className="w-8 h-8 mb-1.5" />
                  <span className="text-[10px]">No recent encrypted feed</span>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Submit form */}
            <form onSubmit={handleSendReply} className="p-2 border-t border-zinc-900 bg-zinc-950 flex gap-1.5">
              <input
                type="text"
                placeholder="Type reply..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-1.5 px-3 text-base text-zinc-200 focus:outline-none focus:border-amber-500 font-sans"
              />
              <button
                type="submit"
                disabled={!replyText.trim()}
                className="p-1.5 px-3 rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover Message trigger bubble icon */}
      <button
        onClick={handleOpenToggle}
        className="pointer-events-auto p-3.5 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer relative z-50 animate-bounce animate-duration-1000"
      >
        <MessageSquare className="w-5.5 h-5.5" />
        {unreadCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white font-mono text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-bold animate-pulse ring-2 ring-zinc-950">
            {unreadCount}
          </span>
        )}
      </button>

    </div>
  );
}
