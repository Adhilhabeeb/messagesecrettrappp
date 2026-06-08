import React, { useState, useEffect, useRef, useMemo } from "react";
import { ref, set, onValue, remove, onChildAdded, push, get } from "firebase/database";
import { db } from "../firebase";
import { UserProfile, RoomParticipant } from "../types";
import { Mic, MicOff, PhoneCall, PhoneOff, Radio, Volume2, Shield, Play, Square, Headphones } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface VoiceChatProps {
  roomId: string;
  currentUser: UserProfile;
  autoJoin?: boolean;
  forceMute?: boolean;
}

interface PeerConnectionState {
  peerId: string;
  username: string;
  avatar: string;
  isConnected: boolean;
  isMuted: boolean;
  isSpeakerActive: boolean;
}

export default function VoiceChat({ roomId, currentUser, autoJoin = false, forceMute = false }: VoiceChatProps) {
  const [isJoined, setIsJoined] = useState(false);
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [activePeers, setActivePeers] = useState<PeerConnectionState[]>([]);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const peerConnectionsRef = useRef<{ [userId: string]: RTCPeerConnection }>({});
  const fallbackIntervalRef = useRef<any>(null);
  const iceCandidatesQueueRef = useRef<{ [userId: string]: RTCIceCandidateInit[] }>({});
  const signalingUnsubscribesRef = useRef<(() => void)[]>([]);
  const lastTalkingRef = useRef<boolean>(false);

  // Clean presence reference inside RTDB
  const myPresenceRef = useMemo(() => {
    return ref(db, `rooms/${roomId}/voice/peers/${currentUser.id}`);
  }, [roomId, currentUser.id]);

  // Read voice chat room active members and clean up left connections
  useEffect(() => {
    const peersRef = ref(db, `rooms/${roomId}/voice/peers`);
    const unsubscribe = onValue(peersRef, (snapshot) => {
      let activePeerIds: string[] = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        const peerList: PeerConnectionState[] = Object.keys(data)
          .filter((key) => key !== currentUser.id)
          .map((key) => {
            activePeerIds.push(key);
            return {
              peerId: key,
              username: data[key].username,
              avatar: data[key].avatar,
              isConnected: data[key].status === "connected",
              isMuted: data[key].muted || false,
              isSpeakerActive: data[key].isTalking || false,
            };
          });
        setActivePeers(peerList);
      } else {
        setActivePeers([]);
      }

      // Cleanup any peer connection for a peer that is no longer in the room!
      Object.keys(peerConnectionsRef.current).forEach((peerId) => {
        if (!activePeerIds.includes(peerId)) {
          console.log(`Peer ${peerId} left the voice call. Active cleanup...`);
          try {
            peerConnectionsRef.current[peerId].close();
          } catch (e) {}
          delete peerConnectionsRef.current[peerId];
          
          if (iceCandidatesQueueRef.current[peerId]) {
            delete iceCandidatesQueueRef.current[peerId];
          }

          const remoteAudio = document.getElementById(`audio-${peerId}`);
          if (remoteAudio) {
            remoteAudio.remove();
          }
        }
      });
    });

    return () => {
      unsubscribe();
    };
  }, [roomId, currentUser.id]);

  // Helper to dynamically attach or push the latest local audio track to all peer connections 
  const syncLocalStreamToPeers = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    for (const targetUserId of Object.keys(peerConnectionsRef.current)) {
      const pc = peerConnectionsRef.current[targetUserId];
      try {
        const senders = pc.getSenders();
        const audioSender = senders.find((s) => s.track?.kind === "audio" || s.track === null);
        if (audioSender) {
          await audioSender.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, stream);
        }
      } catch (err) {
        console.warn(`Could not sync track to peer ${targetUserId}:`, err);
      }
    }
  };

  // Capture local stream for mic level and WebRTC
  const startLocalAudio = async () => {
    try {
      setPermissionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // Ensure current muted state is reflected on newly acquired tracks
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isLocalMuted;
      });

      // Sync tracks to any pre-existing connection
      await syncLocalStreamToPeers();

      // Setup audio analyzer for beautiful live amplitude waveform
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkAmplitude = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          // Scale to 0-100 base
          setMicLevel(isLocalMuted ? 0 : Math.min(100, Math.floor(avg * 1.5)));
          animationFrameRef.current = requestAnimationFrame(checkAmplitude);
        };
        checkAmplitude();
      }
    } catch (err: any) {
      console.warn("Audio mic permission blocked or unavailable in frame:", err);
      setPermissionError("Mic access restricted inside iframe. Activating ambient secure room fallback.");
      
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
      // Fallback ambient microphone levels animation
      fallbackIntervalRef.current = setInterval(() => {
        if (isJoined && !isLocalMuted) {
          setMicLevel(Math.floor(10 + Math.random() * 40));
        } else {
          setMicLevel(0);
        }
      }, 300);
    }
  };

  const stopLocalAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicLevel(0);
    analyserRef.current = null;
  };

  // Helper to process any early arriving ICE candidates that queued up before remote SDP was set
  const processQueuedIceCandidates = async (userId: string, pc: RTCPeerConnection) => {
    const queue = iceCandidatesQueueRef.current[userId];
    if (queue && queue.length > 0) {
      for (const cand of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("Retrying queued ICE candidate failed:", e);
        }
      }
      iceCandidatesQueueRef.current[userId] = [];
    }
  };

  // Setup Peer WebRTC connection
  const getOrCreatePeerConnection = (targetUserId: string, isInitiator: boolean): RTCPeerConnection => {
    if (peerConnectionsRef.current[targetUserId]) {
      return peerConnectionsRef.current[targetUserId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
    });

    // Add local tracks if they exist; otherwise, build transceiver so SDP is generated correctly
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    } else {
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      } catch (e) {
        console.warn("addTransceiver failed on initialization:", e);
      }
    }

    // ICE Candidate generator
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Send ICE candidate to target user
        const candRef = push(ref(db, `rooms/${roomId}/voice/signal/${targetUserId}/ice/${currentUser.id}`));
        set(candRef, {
          candidate: JSON.stringify(event.candidate),
          senderId: currentUser.id,
        });
      }
    };

    // Receive Remote Track
    pc.ontrack = (event) => {
      // Find or create audio element
      let remoteAudio = document.getElementById(`audio-${targetUserId}`) as HTMLAudioElement;
      if (!remoteAudio) {
        remoteAudio = document.createElement("audio");
        remoteAudio.id = `audio-${targetUserId}`;
        document.body.appendChild(remoteAudio);
      }
      
      // Fallback stream association to support mobile/safari platforms where track belongs to a new stream
      remoteAudio.srcObject = event.streams[0] || (event.track ? new MediaStream([event.track]) : null);
      remoteAudio.autoplay = true;
      remoteAudio.muted = false;
      remoteAudio.setAttribute("playsinline", "true");
      remoteAudio.volume = 1.0;
      
      // Force reload audio on iOS/Safari so the new track plays successfully
      try {
        remoteAudio.load();
      } catch (loadErr) {}

      // Attempt play immediately (handle browser auto-play policy block)
      remoteAudio.play().catch((playErr) => {
        console.warn("Autoplay block for WebRTC voice:", playErr);
        // Play on general window click click to bypass autoplay restrictions safely
        const playOnUnlock = () => {
          remoteAudio.play().catch(() => {});
          window.removeEventListener("click", playOnUnlock);
        };
        window.addEventListener("click", playOnUnlock);
      });
    };

    peerConnectionsRef.current[targetUserId] = pc;
    return pc;
  };

  // Helper to start Offer Handshake to all existing users in the room
  const initiateOfferToAllExisting = async (existingPeers: string[]) => {
    for (const peerId of existingPeers) {
      if (peerId === currentUser.id) continue;
      
      const pc = getOrCreatePeerConnection(peerId, true);
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);
        
        // Write offer to the existing peer's incoming signaling offers
        const signalRef = ref(db, `rooms/${roomId}/voice/signal/${peerId}/offers/${currentUser.id}`);
        await set(signalRef, {
          type: "offer",
          senderId: currentUser.id,
          sdp: JSON.stringify(offer),
        });
      } catch (err) {
        console.error("Failed to generate WebRTC offer to:", peerId, err);
      }
    }
  };

  // WebRTC Signaling over Database setup helper
  const setupSignalingEndpoints = () => {
    // Clean up any previously stored signaling listeners
    signalingUnsubscribesRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {}
    });
    signalingUnsubscribesRef.current = [];

    // 1. Listen to incoming offers from newly joining peers
    const offersRef = ref(db, `rooms/${roomId}/voice/signal/${currentUser.id}/offers`);
    const unsubOffers = onValue(offersRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();
      
      for (const senderId of Object.keys(data)) {
        if (senderId === currentUser.id) continue;
        const offerData = data[senderId];
        const pc = getOrCreatePeerConnection(senderId, false);
        
        // Only set remote description if signaling state allows (prevent override)
        if (pc.signalingState === "stable" || pc.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerData.sdp)));
            await processQueuedIceCandidates(senderId, pc);
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            // Send answer back to Alice's answer bucket
            const ansRef = ref(db, `rooms/${roomId}/voice/signal/${senderId}/answers/${currentUser.id}`);
            await set(ansRef, {
              type: "answer",
              senderId: currentUser.id,
              sdp: JSON.stringify(answer),
            });
          } catch (err) {
            console.error("Failed during WebRTC offer incoming handler:", err);
          }
        }
      }
    });
    signalingUnsubscribesRef.current.push(unsubOffers);

    // 2. Listen to incoming answers
    const answersRef = ref(db, `rooms/${roomId}/voice/signal/${currentUser.id}/answers`);
    const unsubAnswers = onValue(answersRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();
      
      for (const senderId of Object.keys(data)) {
        if (senderId === currentUser.id) continue;
        const answerData = data[senderId];
        const pc = getOrCreatePeerConnection(senderId, true);
        
        if (pc.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(answerData.sdp)));
            await processQueuedIceCandidates(senderId, pc);
          } catch (err) {
            console.error("Failed during setting remote answer:", err);
          }
        }
      }
    });
    signalingUnsubscribesRef.current.push(unsubAnswers);

    // 3. Listen to incoming ICE Candidates
    const iceRef = ref(db, `rooms/${roomId}/voice/signal/${currentUser.id}/ice`);
    const unsubIce = onValue(iceRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();
      
      for (const senderId of Object.keys(data)) {
        if (senderId === currentUser.id) continue;
        const peerIceList = data[senderId];
        const pc = getOrCreatePeerConnection(senderId, false);
        
        for (const key of Object.keys(peerIceList)) {
          const item = peerIceList[key];
          try {
            const rawCand = JSON.parse(item.candidate);
            if (rawCand) {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(rawCand));
              } else {
                if (!iceCandidatesQueueRef.current[senderId]) {
                  iceCandidatesQueueRef.current[senderId] = [];
                }
                iceCandidatesQueueRef.current[senderId].push(rawCand);
              }
            }
          } catch (err) {
            // Benign error if candidate isn't applicable
          }
        }
      }
    });
    signalingUnsubscribesRef.current.push(unsubIce);
  };

  // Join Voice Channel
  const handleJoinVoice = async () => {
    setIsJoined(true);
    await startLocalAudio();

    // Query active voice peer list to find existing peers
    const peersRef = ref(db, `rooms/${roomId}/voice/peers`);
    let existingUsers: string[] = [];
    try {
      const snap = await get(peersRef);
      if (snap.exists()) {
        existingUsers = Object.keys(snap.val());
      }
    } catch (e) {
      console.warn("Failed to get initial peer list:", e);
    }

    // Register inside RTDB Presence
    await set(myPresenceRef, {
      userId: currentUser.id,
      username: currentUser.username,
      avatar: currentUser.avatar,
      color: currentUser.color,
      muted: isLocalMuted,
      isTalking: false,
      status: "connected",
      joinedAt: Date.now(),
    });

    // Simple auto signaling setup
    setupSignalingEndpoints();

    // Initiate Offers to all existing users
    if (existingUsers.length > 0) {
      setTimeout(() => {
        initiateOfferToAllExisting(existingUsers);
      }, 800);
    }
  };

  useEffect(() => {
    if (autoJoin && !isJoined) {
      handleJoinVoice();
    }
  }, [autoJoin]);

  // Leave Voice Channel
  const handleLeaveVoice = async () => {
    setIsJoined(false);
    stopLocalAudio();
    
    // Unsubscribe from RTDB signaling events
    signalingUnsubscribesRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {}
    });
    signalingUnsubscribesRef.current = [];

    await remove(myPresenceRef);

    // Clear my incoming signaling mailbox so next session is clean
    const mySignalsRef = ref(db, `rooms/${roomId}/voice/signal/${currentUser.id}`);
    await remove(mySignalsRef);
    
    // Clear WebRTC connections
    Object.keys(peerConnectionsRef.current).forEach((key) => {
      try {
        peerConnectionsRef.current[key].close();
      } catch (e) {}
      const remoteAudio = document.getElementById(`audio-${key}`);
      if (remoteAudio) {
        remoteAudio.remove();
      }
    });
    peerConnectionsRef.current = {};
    iceCandidatesQueueRef.current = {};
  };

  // Track talk state change on RTDB to notify other peers (with transition throttling)
  useEffect(() => {
    if (!isJoined) return;
    const isTalkingDB = micLevel > 15;
    
    if (lastTalkingRef.current !== isTalkingDB) {
      lastTalkingRef.current = isTalkingDB;
      set(ref(db, `rooms/${roomId}/voice/peers/${currentUser.id}/isTalking`), isTalkingDB);
    }
  }, [micLevel, isJoined, roomId, currentUser.id]);

  // Automatically force mute and sync when forceMute is activated in parent
  useEffect(() => {
    if (forceMute && !isLocalMuted) {
      setIsLocalMuted(true);
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      if (isJoined) {
        set(ref(db, `rooms/${roomId}/voice/peers/${currentUser.id}/muted`), true);
      }
    }
  }, [forceMute, isJoined, roomId, currentUser.id]);

  // Track Mute state change
  const toggleMute = async () => {
    if (forceMute) return; // Guard mute state change when stealth/forceMute is engaged
    const nextMute = !isLocalMuted;
    setIsLocalMuted(nextMute);
    if (!nextMute && isJoined && !localStreamRef.current) {
      await startLocalAudio();
    }
    
    // Enforce physical track state for the WebRTC stream so other peers don't receive audio
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMute;
      });
    }

    if (isJoined) {
      await set(ref(db, `rooms/${roomId}/voice/peers/${currentUser.id}/muted`), nextMute);
    }
  };

  // Periodic cleanup
  useEffect(() => {
    return () => {
      if (isJoined) {
        remove(myPresenceRef);
      }
      stopLocalAudio();
      
      // Cleanup all connections and active DOM nodes
      signalingUnsubscribesRef.current.forEach((unsub) => {
        try {
          unsub();
        } catch (e) {}
      });
      Object.keys(peerConnectionsRef.current).forEach((key) => {
        try {
          peerConnectionsRef.current[key].close();
        } catch (e) {}
        const remoteAudio = document.getElementById(`audio-${key}`);
        if (remoteAudio) {
          remoteAudio.remove();
        }
      });
    };
  }, [isJoined, myPresenceRef]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col shadow-lg">
      <div className="flex items-center justify-between mb-3 border-b border-zinc-900 pb-2.5">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
          <h3 className="font-sans font-medium text-sm text-zinc-100">Live Voice Stream</h3>
        </div>
        {isJoined && (
          <span className="flex items-center gap-1.5 text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full font-mono">
            ● ONLINE ROOM
          </span>
        )}
      </div>

      {!isJoined ? (
        <div className="py-4 text-center">
          <p className="text-xs text-zinc-500 max-w-xs mx-auto mb-4 font-sans">
            Connect your microphone to initiate encrypted, latency-free real-time conversation.
          </p>
          <button
            onClick={handleJoinVoice}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 py-2.5 px-4 rounded-lg font-sans font-medium text-xs transition-colors shadow-lg cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" />
            Connect Live Voice Call
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Waveform Micro Meter block */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="text-[10px] font-mono text-zinc-400">Microphone Input Wave</span>
              <span className="text-[10px] font-mono text-emerald-400">{micLevel}%</span>
            </div>

            {/* Simulated/Real-amplitude visual bars */}
            <div className="h-8 flex items-end justify-center gap-1">
              {Array.from({ length: 15 }).map((_, i) => {
                // Generate a bar height responsive to real amplitude
                const factor = Math.sin(i / 2) * 0.4 + 0.6;
                const finalHeight = micLevel > 0 ? Math.max(4, Math.floor(micLevel * factor * 0.32)) : 4;
                return (
                  <motion.div
                    key={i}
                    animate={{ height: finalHeight }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    style={{ height: `${finalHeight}px` }}
                    className={`w-1 rounded-full transition-colors ${
                      micLevel > 20
                        ? "bg-emerald-400"
                        : micLevel > 0
                        ? "bg-teal-500"
                        : "bg-zinc-800"
                    }`}
                  />
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-1 z-10">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isLocalMuted ? "bg-red-400" : "bg-emerald-400"}`}></span>
                <span className="text-[10px] text-zinc-500 font-sans">
                  {isLocalMuted ? "Muted" : "Broadcasting Live"}
                </span>
              </div>
              <span className="flex items-center gap-0.5 text-[9px] text-zinc-600 font-mono">
                <Shield className="w-3 h-3 text-emerald-600" /> SECURE
              </span>
            </div>
          </div>

          {/* Active Speakers Row */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Room participants
            </span>
            <div className="grid grid-cols-1 gap-2">
              {/* Me First */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/40 border border-zinc-900">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-semibold select-none">
                    {currentUser.avatar}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-200 font-sans font-medium">{currentUser.username}</span>
                    <span className="text-[9px] text-zinc-500 font-mono">You</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {micLevel > 15 && <span className="text-[9px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-900 px-1 py-0.2 rounded">Speaking</span>}
                  <button
                    onClick={toggleMute}
                    disabled={forceMute}
                    title={forceMute ? "Secure Mute Forced" : "Toggle Microphone"}
                    className={`p-1.5 rounded-md border transition-colors ${
                      forceMute
                        ? "bg-red-950/40 border-red-900/40 text-red-550 cursor-not-allowed opacity-60"
                        : isLocalMuted
                        ? "bg-red-950/80 border-red-900 text-red-400"
                        : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {isLocalMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Other Peers */}
              {activePeers.map((peer) => (
                <div
                  key={peer.peerId}
                  className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                    peer.isSpeakerActive
                      ? "bg-emerald-950/20 border-emerald-800/60"
                      : "bg-zinc-900/30 border-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-semibold select-none">
                      {peer.avatar}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-xs text-zinc-200 font-sans font-medium">{peer.username}</span>
                      <span className="text-[9px] text-zinc-500 font-mono">Connected</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {peer.isSpeakerActive && <span className="text-[9px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-900/50 px-1 py-0.2 rounded">Speaking</span>}
                    {peer.isMuted ? (
                      <span className="p-1 px-1.5 rounded bg-zinc-800 border border-zinc-700 text-red-400">
                        <MicOff className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="p-1 px-[5px] rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-400">
                        <Mic className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {activePeers.length === 0 && (
                <div className="text-center py-2.5 bg-zinc-900/20 rounded Border border-dashed border-zinc-800/80">
                  <span className="text-[10px] text-zinc-600 font-sans">
                    Waiting for opponent to connect audio...
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action trigger console */}
          <div className="flex gap-2">
            <button
              onClick={toggleMute}
              disabled={forceMute}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-sans font-medium transition-colors border shadow-sm ${
                forceMute
                  ? "bg-red-950/30 border-red-900/30 text-red-400 cursor-not-allowed opacity-60"
                  : isLocalMuted
                  ? "bg-red-950/70 border-red-900 text-red-300 hover:bg-red-900"
                  : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {forceMute ? (
                <>
                  <MicOff className="w-4 h-4 text-red-400 animate-pulse" /> Mic Locked Muted
                </>
              ) : isLocalMuted ? (
                <>
                  <MicOff className="w-4 h-4" /> Unmute Mic
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" /> Mute Mic
                </>
              )}
            </button>
            <button
              onClick={handleLeaveVoice}
              className="flex-shrink-0 flex items-center justify-center gap-1.5 p-2 px-3.5 rounded-lg bg-red-950/40 border border-red-900 text-red-400 hover:bg-red-900/80 hover:text-white transition-colors text-xs font-sans"
            >
              <PhoneOff className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Mic restrictions or warnings */}
      {permissionError && isJoined && (
        <span className="mt-2 text-[10px] font-sans text-amber-500/90 leading-tight bg-amber-505/5 border border-amber-500/20 p-2 rounded">
          {permissionError}
        </span>
      )}
    </div>
  );
}
