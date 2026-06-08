import React, { useState, useEffect, useMemo, useRef } from "react";
import { ref, set, onValue } from "firebase/database";
import { db } from "../firebase";
import { UserProfile } from "../types";
import { Award, Flag, Users, Coins, CheckCircle2, BadgeAlert, PlusCircle, TrendingUp, Sparkles, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ConnectFourGameProps {
  roomId: string;
  currentUser: UserProfile;
}

interface ConnectFourSync {
  board: string[][]; // 6 rows x 7 cols. Entries: "" | "r" | "y" (red=whitePlayer, yellow=blackPlayer)
  turn: "r" | "y";
  redPlayer: UserProfile | null;
  yellowPlayer: UserProfile | null;
  status: "waiting" | "active" | "won" | "draw" | "resigned";
  winner?: string | null;  // userId or "draw"
  wager: number;
  wagerPool: number;
  redWagerAgreed: boolean;
  yellowWagerAgreed: boolean;
  lastMove?: { row: number; col: number } | null;
  createdAt: number;
}

// Procedural audio engine using Web Audio API for immersive mechanical sounds
const playSound = (type: "coin" | "win" | "lose" | "drop" | "button" | "draw") => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (type === "coin") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } else if (type === "drop") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === "win") {
      const notes = [293.66, 349.23, 440.00, 587.33, 698.46, 880.00]; // Rich D minor arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.4);
      });
    } else if (type === "lose") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(90, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else if (type === "button") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "draw") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (e) {
    console.warn("Audio Context is blocked or unsupported", e);
  }
};

export default function ConnectFourGame({ roomId, currentUser }: ConnectFourGameProps) {
  const [gameState, setGameState] = useState<ConnectFourSync | null>(null);
  const [balances, setBalances] = useState<{ [userId: string]: number }>({});
  const [wagerError, setWagerError] = useState<string | null>(null);
  const [coinAnimations, setCoinAnimations] = useState<{ id: number; amount: number; x: number; y: number }[]>([]);

  const previousBalanceRef = useRef<number | null>(null);

  // Read Connect Four state from Realtime Database
  useEffect(() => {
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.val());
      } else {
        const initialGame: ConnectFourSync = {
          board: Array(6).fill(null).map(() => Array(7).fill("")),
          turn: "r",
          redPlayer: null,
          yellowPlayer: null,
          status: "waiting",
          wager: 100,
          wagerPool: 0,
          redWagerAgreed: false,
          yellowWagerAgreed: false,
          createdAt: Date.now(),
        };
        set(gameRef, initialGame);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Read and subscribe to shared Chess profiles balances path so they share the same economy
  useEffect(() => {
    const balancesRef = ref(db, `rooms/${roomId}/chess/balances`);
    const unsubscribe = onValue(balancesRef, (snapshot) => {
      if (snapshot.exists()) {
        setBalances(snapshot.val());
      } else {
        setBalances({});
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  // Auto-initialize balance to 1000 if none exists
  useEffect(() => {
    if (!currentUser || !roomId) return;
    if (balances[currentUser.id] === undefined) {
      const myBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${currentUser.id}`);
      set(myBalanceRef, 1000);
    }
  }, [balances, currentUser?.id, roomId]);

  // Animate coin gains
  useEffect(() => {
    const myBalance = balances[currentUser.id];
    if (myBalance !== undefined) {
      if (previousBalanceRef.current !== null && myBalance > previousBalanceRef.current) {
        const diff = myBalance - previousBalanceRef.current;
        playSound("coin");
        const newAnim = {
          id: Date.now(),
          amount: diff,
          x: Math.random() * 80 - 40,
          y: Math.random() * 60 - 45,
        };
        setCoinAnimations((prev) => [...prev, newAnim]);
        setTimeout(() => {
          setCoinAnimations((prev) => prev.filter((a) => a.id !== newAnim.id));
        }, 1500);
      } else if (previousBalanceRef.current !== null && myBalance < previousBalanceRef.current) {
        playSound("drop");
      }
      previousBalanceRef.current = myBalance;
    }
  }, [balances, currentUser.id]);

  // Determine current player's color assignment in Connect Four
  const myColor = useMemo(() => {
    if (gameState?.redPlayer?.id === currentUser.id) return "r";
    if (gameState?.yellowPlayer?.id === currentUser.id) return "y";
    return null; // Spectator
  }, [gameState, currentUser.id]);

  const statusMessage = useMemo(() => {
    if (!gameState) return "Connecting table...";
    if (gameState.status === "waiting") {
      if (gameState.redPlayer && gameState.yellowPlayer) {
        return "Negotiating match coin bets...";
      }
      return "Waiting for players to sit down...";
    }
    if (gameState.status === "won") {
      const winnerName = gameState.winner === "r" ? "Red Team" : "Yellow Team";
      return `Connect Four! ${winnerName} takes the Wager Pool!`;
    }
    if (gameState.status === "draw") {
      return "Draw match! Refunded escrow coins.";
    }
    if (gameState.status === "resigned") {
      const winnerName = gameState.winner === "r" ? "Red Team" : "Yellow Team";
      return `Resigned! ${winnerName} collects the active escrow pool.`;
    }
    return gameState.turn === "r" ? "Red's Turn" : "Yellow's Turn";
  }, [gameState]);

  // Joint Seat Commands
  const joinSeat = async (color: "r" | "y") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    const isOccupiedByMe =
      gameState.redPlayer?.id === currentUser.id ||
      gameState.yellowPlayer?.id === currentUser.id;

    if (isOccupiedByMe) return;

    const updated = { ...gameState };
    if (color === "r") {
      updated.redPlayer = currentUser;
      updated.redWagerAgreed = false;
    } else {
      updated.yellowPlayer = currentUser;
      updated.yellowWagerAgreed = false;
    }

    updated.status = "waiting";
    updated.redWagerAgreed = false;
    updated.yellowWagerAgreed = false;

    await set(gameRef, updated);
    playSound("button");
  };

  const leaveSeat = async (color: "r" | "y") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    const updated = { ...gameState };

    // Forfeit match wager if active
    if (gameState.status === "active" && gameState.wagerPool) {
      playSound("lose");
      const winnerColor = color === "r" ? "y" : "r";
      const winnerId = winnerColor === "r" ? gameState.redPlayer?.id : gameState.yellowPlayer?.id;
      if (winnerId) {
        const winnerBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
        const currentBalVal = balances[winnerId] ?? 1000;
        await set(winnerBalanceRef, currentBalVal + gameState.wagerPool);
      }
      updated.wagerPool = 0;
      updated.status = "resigned";
      updated.winner = winnerColor;
    }

    if (color === "r") {
      updated.redPlayer = null;
      updated.redWagerAgreed = false;
    } else {
      updated.yellowPlayer = null;
      updated.yellowWagerAgreed = false;
    }

    if (updated.status === "active") {
      updated.status = "waiting";
    }
    updated.redWagerAgreed = false;
    updated.yellowWagerAgreed = false;

    await set(gameRef, updated);
    playSound("button");
  };

  const handleSetWager = async (amount: number) => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    await set(gameRef, {
      ...gameState,
      wager: amount,
      redWagerAgreed: false,
      yellowWagerAgreed: false,
    });
    playSound("button");
  };

  const handleToggleWagerAgreed = async () => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    const updated = { ...gameState };

    if (myColor === "r") {
      updated.redWagerAgreed = !gameState.redWagerAgreed;
    } else {
      updated.yellowWagerAgreed = !gameState.yellowWagerAgreed;
    }

    const isRedAgreed = myColor === "r" ? updated.redWagerAgreed : !!gameState.redWagerAgreed;
    const isYellowAgreed = myColor === "y" ? updated.yellowWagerAgreed : !!gameState.yellowWagerAgreed;

    if (isRedAgreed && isYellowAgreed) {
      const activeWager = gameState.wager || 100;
      const redId = gameState.redPlayer?.id;
      const yellowId = gameState.yellowPlayer?.id;

      if (redId && yellowId) {
        const redBal = balances[redId] ?? 1000;
        const yellowBal = balances[yellowId] ?? 1000;

        if (redBal < activeWager || yellowBal < activeWager) {
          updated.redWagerAgreed = false;
          updated.yellowWagerAgreed = false;
          setWagerError("Insufficient coins! Request coins or lower match wager amount.");
          playSound("lose");
          await set(gameRef, updated);
          return;
        }

        // Deduct
        const redBalRef = ref(db, `rooms/${roomId}/chess/balances/${redId}`);
        const yellowBalRef = ref(db, `rooms/${roomId}/chess/balances/${yellowId}`);
        await set(redBalRef, redBal - activeWager);
        await set(yellowBalRef, yellowBal - activeWager);

        updated.wagerPool = activeWager * 2;
        updated.status = "active";
        // Reset Board
        updated.board = Array(6).fill(null).map(() => Array(7).fill(""));
        updated.turn = "r";
        updated.lastMove = null;
        playSound("win");
      }
    }

    await set(gameRef, updated);
  };

  // Helper function to check victory line in Connect 4
  const checkConnectFourVictory = (board: string[][]): string | null => {
    const rows = 6;
    const cols = 7;

    // Horizontal check
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 3; c++) {
        const val = board[r][c];
        if (val && val === board[r][c+1] && val === board[r][c+2] && val === board[r][c+3]) {
          return val;
        }
      }
    }

    // Vertical check
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows - 3; r++) {
        const val = board[r][c];
        if (val && val === board[r+1][c] && val === board[r+2][c] && val === board[r+3][c]) {
          return val;
        }
      }
    }

    // Diagonal Ascending (bottom-left to top-right)
    for (let r = 3; r < rows; r++) {
      for (let c = 0; c < cols - 3; c++) {
        const val = board[r][c];
        if (val && val === board[r-1][c+1] && val === board[r-2][c+2] && val === board[r-3][c+3]) {
          return val;
        }
      }
    }

    // Diagonal Descending (top-left to bottom-right)
    for (let r = 0; r < rows - 3; r++) {
      for (let c = 0; c < cols - 3; c++) {
        const val = board[r][c];
        if (val && val === board[r+1][c+1] && val === board[r+2][c+2] && val === board[r+3][c+3]) {
          return val;
        }
      }
    }

    // Check Draw condition (is full)
    let isFull = true;
    for (let c = 0; c < cols; c++) {
      if (board[0][c] === "") {
        isFull = false;
        break;
      }
    }

    if (isFull) return "draw";

    return null;
  };

  // Play a piece in a column
  const handleColumnClick = async (colIndex: number) => {
    if (!gameState || gameState.status !== "active") return;
    if (gameState.turn !== myColor) return; // Not current player's turn

    // Find lowest empty slot in columns (starting from row 5 down to 0)
    let targetRow = -1;
    for (let r = 5; r >= 0; r--) {
      if (gameState.board[r][colIndex] === "") {
        targetRow = r;
        break;
      }
    }

    if (targetRow === -1) {
      // Column complete/blocked
      return;
    }

    const nextBoard = gameState.board.map((row) => [...row]);
    nextBoard[targetRow][colIndex] = myColor;

    playSound("drop");

    const victoryType = checkConnectFourVictory(nextBoard);
    let nextStatus = gameState.status;
    let winner: string | null = null;
    let currentWagerPool = gameState.wagerPool;

    if (victoryType === "r" || victoryType === "y") {
      nextStatus = "won";
      winner = victoryType;
      playSound("win");

      const winnerId = victoryType === "r" ? gameState.redPlayer?.id : gameState.yellowPlayer?.id;
      if (winnerId && currentWagerPool > 0) {
        const winnerBalRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
        const currentBalVal = balances[winnerId] ?? 1000;
        await set(winnerBalRef, currentBalVal + currentWagerPool);
        currentWagerPool = 0;
      }
    } else if (victoryType === "draw") {
      nextStatus = "draw";
      winner = "draw";
      playSound("draw");

      // Refund half match wagers
      const redId = gameState.redPlayer?.id;
      const yellowId = gameState.yellowPlayer?.id;
      const refundVal = Math.floor(currentWagerPool / 2);
      if (refundVal > 0) {
        if (redId) {
          const balRef = ref(db, `rooms/${roomId}/chess/balances/${redId}`);
          await set(balRef, (balances[redId] ?? 1000) + refundVal);
        }
        if (yellowId) {
          const balRef = ref(db, `rooms/${roomId}/chess/balances/${yellowId}`);
          await set(balRef, (balances[yellowId] ?? 1000) + refundVal);
        }
        currentWagerPool = 0;
      }
    }

    const nextTurn = gameState.turn === "r" ? "y" : "r";
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    await set(gameRef, {
      ...gameState,
      board: nextBoard,
      turn: nextTurn,
      status: nextStatus,
      winner,
      wagerPool: currentWagerPool,
      lastMove: { row: targetRow, col: colIndex },
    });
  };

  const resignGame = async () => {
    if (!gameState || !myColor || gameState.status !== "active") return;
    playSound("lose");
    const opponentColor = myColor === "r" ? "y" : "r";
    const opponentId = opponentColor === "r" ? gameState.redPlayer?.id : gameState.yellowPlayer?.id;
    const gameRef = ref(db, `rooms/${roomId}/connect4`);

    if (gameState.wagerPool && opponentId) {
      const oppBalRef = ref(db, `rooms/${roomId}/chess/balances/${opponentId}`);
      await set(oppBalRef, (balances[opponentId] ?? 1000) + gameState.wagerPool);
    }

    await set(gameRef, {
      ...gameState,
      status: "resigned",
      winner: opponentColor,
      wagerPool: 0,
    });
  };

  const resetGame = async () => {
    const gameRef = ref(db, `rooms/${roomId}/connect4`);
    setWagerError(null);
    await set(gameRef, {
      board: Array(6).fill(null).map(() => Array(7).fill("")),
      turn: "r",
      redPlayer: gameState?.redPlayer || null,
      yellowPlayer: gameState?.yellowPlayer || null,
      status: "waiting",
      wager: gameState?.wager || 100,
      wagerPool: 0,
      redWagerAgreed: false,
      yellowWagerAgreed: false,
      createdAt: Date.now(),
    });
    playSound("button");
  };

  const handleClaimFreeCoins = async () => {
    if (!currentUser || !roomId) return;
    const currentVal = balances[currentUser.id] ?? 1000;
    const myBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${currentUser.id}`);
    await set(myBalanceRef, currentVal + 500);
  };

  // Autoseat assigns
  useEffect(() => {
    if (!gameState) return;
    const isOccupiedByMe =
      gameState.redPlayer?.id === currentUser.id ||
      gameState.yellowPlayer?.id === currentUser.id;

    if (!isOccupiedByMe) {
      if (!gameState.redPlayer) {
        joinSeat("r");
      } else if (!gameState.yellowPlayer) {
        joinSeat("y");
      }
    }
  }, [gameState, currentUser.id]);

  return (
    <div className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl h-full relative">
      <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 pointer-events-none z-[100]">
        <AnimatePresence>
          {coinAnimations.map((anim) => (
            <motion.div
              key={anim.id}
              initial={{ opacity: 0, y: 10, scale: 0.6 }}
              animate={{ opacity: 1, y: -80, scale: 1.5, x: anim.x }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="flex items-center gap-1.5 bg-zinc-950/90 border border-amber-500 text-amber-400 px-3 py-1.5 rounded-full font-bold shadow-[0_4px_25px_rgba(245,158,11,0.3)] font-mono text-sm uppercase tracking-wide"
            >
              <Coins className="w-5 h-5 text-amber-500 animate-spin" />
              <span>+{anim.amount} Coins!</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header Panel */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-950 border-b border-zinc-800 gap-2">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-amber-500 animate-pulse" />
          <div className="flex flex-col">
            <span className="font-sans font-bold text-xs text-zinc-100 uppercase tracking-widest flex items-center gap-1">
              Connect Four Stakes <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">Real-time coin betting grid</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1 text-xs font-semibold text-amber-400 font-mono">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>{(balances[currentUser.id] ?? 1000).toLocaleString()} Coins</span>
          </div>

          <button
            onClick={resetGame}
            className="p-1 px-2 text-red-400 hover:text-red-305 hover:bg-red-950/20 border border-zinc-800 rounded text-[10px] transition-all font-sans"
          >
            Reset Table
          </button>
        </div>
      </div>

      <div className="flex flex-col flex-1 p-3 gap-3 overflow-y-auto">
        {/* YELLOW PLAYER (BLACK/TOP) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <span className="w-4 h-4 rounded-full bg-yellow-400 ring-2 ring-yellow-500 shadow-md"></span>
            <div className="flex flex-col">
              <span className="font-sans font-medium text-xs text-zinc-200">
                {gameState?.yellowPlayer ? gameState.yellowPlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-500/90 font-mono font-semibold">
                {gameState?.yellowPlayer ? `${balances[gameState.yellowPlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal"> | Yellow disc</span>
              </span>
            </div>
            {gameState?.yellowPlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-305 rounded px-1.5 font-bold uppercase">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.yellowPlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveSeat("y")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-900 border border-red-950 text-red-400 text-[10px] font-semibold"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "y" && gameState.status === "active" && (
              <span className="animate-pulse text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-bold uppercase">
                Thinking Turn
              </span>
            )}
          </div>
        </div>

        {/* WAGER CONSOLE */}
        {gameState && gameState.status === "waiting" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-amber-950/30 via-zinc-900 to-amber-950/30 p-3.5 rounded-xl border border-amber-900/30 flex flex-col gap-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)] my-1 shrink-0"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500 animate-bounce" />
                <span className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400">Negotiate Connect Four Bet</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-850 px-2 py-0.5 rounded">Coins Escrow</span>
            </div>

            {wagerError && (
              <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/40 px-3 py-2 rounded text-red-400 text-xs font-mono">
                <AlertCircle className="w-4 h-4" />
                <span>{wagerError}</span>
              </div>
            )}

            {myColor ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1 flex-wrap">
                  {[50, 100, 250, 500, 1000].map((amount) => {
                    const isSelected = gameState.wager === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => handleSetWager(amount)}
                        className={`flex-1 p-1.5 rounded text-xs font-mono font-bold transition-all border ${
                          isSelected
                            ? "bg-amber-500 text-zinc-950 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)] scale-[1.03]"
                            : "bg-zinc-850 text-zinc-300 border-zinc-850 hover:bg-zinc-800"
                        }`}
                      >
                        {amount}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2.5 mt-1.5 grid grid-cols-2">
                  <div className={`p-2 rounded border flex flex-col items-center justify-center gap-1 font-sans text-[11px] ${
                    gameState.redWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">Red Side (White)</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.redWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 animate-pulse"></span>
                      )}
                      {gameState.redWagerAgreed ? "Agreed" : "Unlocks"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.redPlayer ? `${balances[gameState.redPlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>

                  <div className={`p-2 rounded border flex flex-col items-center justify-center gap-1 font-sans text-[11px] ${
                    gameState.yellowWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">Yellow Side (Black)</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.yellowWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 animate-pulse"></span>
                      )}
                      {gameState.yellowWagerAgreed ? "Agreed" : "Unlocks"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.yellowPlayer ? `${balances[gameState.yellowPlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleWagerAgreed}
                  disabled={!gameState.redPlayer || !gameState.yellowPlayer}
                  className={`p-2 rounded-lg font-bold text-xs uppercase tracking-wide transition-all border shadow-md flex items-center justify-center gap-1.5 mt-1 ${
                    !gameState.redPlayer || !gameState.yellowPlayer
                      ? "bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed opacity-50"
                      : (myColor === "r" && gameState.redWagerAgreed) || (myColor === "y" && gameState.yellowWagerAgreed)
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30"
                      : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 border-amber-400"
                  }`}
                >
                  <Coins className="w-4 h-4 text-zinc-950" />
                  <span>
                    {(myColor === "r" && gameState.redWagerAgreed) || (myColor === "y" && gameState.yellowWagerAgreed)
                      ? "Unlock Decision"
                      : `Agree wager: ${gameState.wager} Coins`}
                  </span>
                </button>
              </div>
            ) : (
              <div className="p-3 bg-zinc-950/50 border border-zinc-850 rounded text-center text-xs text-zinc-400 font-sans">
                <Users className="w-5 h-5 mx-auto text-zinc-500 mb-1 animate-pulse" />
                <span>You are spectating this match. Red and Yellow are matching a <b className="text-amber-400">{gameState.wager} Coins</b> game.</span>
              </div>
            )}
          </motion.div>
        )}

        {/* ACTIVE ESCROW */}
        {gameState && gameState.status === "active" && gameState.wagerPool && (
          <div className="bg-gradient-to-r from-emerald-950/20 via-zinc-900 to-emerald-950/20 border border-emerald-900/30 p-2 text-center text-xs text-emerald-400 rounded-lg font-bold flex items-center justify-center gap-1.5 animate-pulse uppercase tracking-wider">
            <Coins className="w-4 h-4 text-amber-500" />
            <span>Active Escrow pool: <b className="text-amber-400 font-mono font-bold text-sm">{(gameState.wagerPool).toLocaleString()} Coins</b> winner takes all!</span>
          </div>
        )}

        {/* BOARD VIEWGRID */}
        <div className="flex justify-center items-center flex-1 p-1 md:p-3 w-full">
          {/* Yellow outer frame resembling structural game stand */}
          <div className="w-full max-w-[min(385px,60vh)] bg-blue-900 p-2.5 sm:p-4 rounded-xl border-t-2 border-b-8 border-blue-950 shadow-2xl relative select-none">
            
            {/* Column dropper interaction indicators */}
            {gameState && gameState.status === "active" && gameState.turn === myColor && (
              <div className="grid grid-cols-7 gap-1.5 mb-2.5 px-1 text-center justify-center">
                {Array(7).fill(null).map((_, colIdx) => (
                  <button
                    key={colIdx}
                    onClick={() => handleColumnClick(colIdx)}
                    title={`Drop column ${colIdx + 1}`}
                    disabled={gameState.board[0][colIdx] !== ""}
                    className={`h-7 rounded-md transition-all flex items-center justify-center border text-[11px] font-bold cursor-pointer ${
                      gameState.board[0][colIdx] !== "" 
                        ? "bg-zinc-950 border-transparent text-zinc-700 cursor-not-allowed opacity-30" 
                        : "bg-emerald-500 hover:bg-emerald-400 border-emerald-400 text-zinc-950 animate-bounce"
                    }`}
                  >
                    ↓
                  </button>
                ))}
              </div>
            )}

            {/* Solid Grid backing holes */}
            <div className="grid grid-cols-7 grid-rows-6 gap-1.5 bg-blue-950/90 p-2.5 rounded-lg border-2 border-blue-950 h-full relative overflow-hidden">
              {gameState?.board.map((row, rIdx) => 
                row.map((cell, cIdx) => {
                  const isLastMove = gameState.lastMove?.row === rIdx && gameState.lastMove?.col === cIdx;
                  return (
                    <div
                      key={`${rIdx}-${cIdx}`}
                      onClick={() => handleColumnClick(cIdx)}
                      className="aspect-square bg-zinc-950/80 rounded-full flex items-center justify-center relative shadow-inner cursor-pointer hover:bg-zinc-900 transition-all overflow-hidden"
                    >
                      {/* Dynamic drop animation disc inside matching team */}
                      <AnimatePresence>
                        {cell && (
                          <motion.div
                            initial={{ y: -180, scale: 0.1, opacity: 0 }}
                            animate={{ y: 0, scale: 1, opacity: 1 }}
                            transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
                            className={`w-[84%] h-[84%] rounded-full shadow-[inset_-2px_-4px_8px_rgba(0,0,0,0.4),0_2px_5px_rgba(0,0,0,0.6)] ${
                              cell === "r"
                                ? "bg-gradient-to-tr from-rose-700 to-rose-400 border-2 border-rose-900"
                                : "bg-gradient-to-tr from-yellow-500 to-yellow-300 border-2 border-yellow-800"
                            } ${isLastMove ? "ring-2 ring-white scale-95" : ""}`}
                          >
                            {/* Inner concentric highlight rings */}
                            <div className="absolute inset-1.5 rounded-full border border-white/20"></div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}

              {/* End State Overlay modal in blue slot context */}
              <AnimatePresence>
                {gameState && gameState.status !== "active" && gameState.status !== "waiting" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4 text-center z-50 rounded-lg select-all"
                  >
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-full mb-3 animate-pulse">
                      <Award className="w-10 h-10 text-amber-400" />
                    </div>
                    <h3 className="text-sm font-sans font-bold text-zinc-100 uppercase tracking-widest leading-none">
                      Connect Four Verdict
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 mb-5 max-w-xs leading-relaxed">{statusMessage}</p>
                    
                    <button
                      onClick={resetGame}
                      className="p-2 px-5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-zinc-950 text-xs font-bold shadow-lg cursor-pointer"
                    >
                      Restart Match
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* RED PLAYER (CARD BOTTOM) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80 mt-auto">
          <div className="flex items-center gap-2.5">
            <span className="w-4 h-4 rounded-full bg-rose-505 bg-rose-600 ring-2 ring-rose-500 shadow-md"></span>
            <div className="flex flex-col">
              <span className="font-sans font-medium text-xs text-zinc-200">
                {gameState?.redPlayer ? gameState.redPlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-505 font-mono text-amber-500/95 font-semibold">
                {gameState?.redPlayer ? `${balances[gameState.redPlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal"> | Red disc</span>
              </span>
            </div>
            {gameState?.redPlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 font-bold uppercase">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.redPlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveSeat("r")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-900 border border-red-950 text-red-400 text-[10px] font-semibold"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "r" && gameState.status === "active" && (
              <span className="animate-pulse text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-bold uppercase">
                Thinking Turn
              </span>
            )}
          </div>
        </div>

        {/* COIN FAUCET */}
        <div className="p-3 bg-zinc-950/40 border border-zinc-850 rounded-lg flex items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500 animate-pulse" />
            <div className="flex flex-col">
              <span className="font-sans font-semibold text-[11px] text-zinc-350">Wager Coins Faucet</span>
              <span className="text-[10px] text-zinc-500">Need coins to negotiate a high stakes match?</span>
            </div>
          </div>
          <button
            onClick={handleClaimFreeCoins}
            type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-855 border border-zinc-800 hover:bg-zinc-800 text-amber-400 font-bold text-[11px]"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Claim 500 CP</span>
          </button>
        </div>
      </div>

      <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400">
        <span className="text-zinc-400 flex items-center gap-1.5 font-medium leading-none">
          <TrendingUp className="w-3.5 h-3.5 text-zinc-500" />
          {statusMessage}
        </span>

        {myColor && gameState?.status === "active" && (
          <button
            onClick={resignGame}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-red-400 hover:bg-red-950/50 hover:text-red-300 transition-colors border border-transparent hover:border-red-900 text-xs"
          >
            <Flag className="w-3.5 h-3.5" /> Resign Match
          </button>
        )}
      </div>
    </div>
  );
}
