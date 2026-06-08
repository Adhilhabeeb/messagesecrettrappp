import React, { useState, useEffect, useMemo, useRef } from "react";
import { ref, set, onValue } from "firebase/database";
import { db } from "../firebase";
import { UserProfile } from "../types";
import { Award, Flag, Users, Coins, CheckCircle2, BadgeAlert, PlusCircle, TrendingUp, Sparkles, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface TicTacToeGameProps {
  roomId: string;
  currentUser: UserProfile;
}

interface TicTacToeSync {
  board: string[]; // 9 cells. Entries: "" | "x" | "o" (x=whitePlayer, o=blackPlayer)
  turn: "x" | "o";
  xPlayer: UserProfile | null;
  oPlayer: UserProfile | null;
  status: "waiting" | "active" | "won" | "draw" | "resigned";
  winner?: string | null;  // userId or "draw"
  wager: number;
  wagerPool: number;
  xWagerAgreed: boolean;
  oWagerAgreed: boolean;
  lastMove?: number | null; // index 0-8
  createdAt: number;
}

// Procedural audio engine using Web Audio API
const playSound = (type: "coin" | "win" | "lose" | "click" | "button" | "draw") => {
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
    } else if (type === "click") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "win") {
      const notes = [329.63, 440.00, 554.37, 659.25, 880.00]; // Rich A major scale upward arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);
        gain.gain.setValueAtTime(0.07, ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.07 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.07);
        osc.stop(ctx.currentTime + idx * 0.07 + 0.35);
      });
    } else if (type === "lose") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(75, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === "button") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(450, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } else if (type === "draw") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(320, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.warn("Audio Context blocked or unsupported", e);
  }
};

export default function TicTacToeGame({ roomId, currentUser }: TicTacToeGameProps) {
  const [gameState, setGameState] = useState<TicTacToeSync | null>(null);
  const [balances, setBalances] = useState<{ [userId: string]: number }>({});
  const [wagerError, setWagerError] = useState<string | null>(null);
  const [coinAnimations, setCoinAnimations] = useState<{ id: number; amount: number; x: number; y: number }[]>([]);

  const previousBalanceRef = useRef<number | null>(null);

  // Sync state
  useEffect(() => {
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.val());
      } else {
        const initialGame: TicTacToeSync = {
          board: Array(9).fill(""),
          turn: "x",
          xPlayer: null,
          oPlayer: null,
          status: "waiting",
          wager: 50,
          wagerPool: 0,
          xWagerAgreed: false,
          oWagerAgreed: false,
          createdAt: Date.now(),
        };
        set(gameRef, initialGame);
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  // Read common balance
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

  // Coin gains
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
        playSound("click");
      }
      previousBalanceRef.current = myBalance;
    }
  }, [balances, currentUser.id]);

  const myColor = useMemo(() => {
    if (gameState?.xPlayer?.id === currentUser.id) return "x";
    if (gameState?.oPlayer?.id === currentUser.id) return "o";
    return null;
  }, [gameState, currentUser.id]);

  const statusMessage = useMemo(() => {
    if (!gameState) return "Connecting table...";
    if (gameState.status === "waiting") {
      if (gameState.xPlayer && gameState.oPlayer) {
        return "Negotiating match bets...";
      }
      return "Waiting for players to take seats...";
    }
    if (gameState.status === "won") {
      const winnerName = gameState.winner === "x" ? "X Player" : "O Player";
      return `Winner! ${winnerName} collects the Escrow Pool!`;
    }
    if (gameState.status === "draw") {
      return "Draw match! Escrow balance refunded.";
    }
    if (gameState.status === "resigned") {
      const winnerName = gameState.winner === "x" ? "X Player" : "O Player";
      return `Forfeit/Resignation! ${winnerName} takes the wager pool.`;
    }
    return gameState.turn === "x" ? "X's Turn" : "O's Turn";
  }, [gameState]);

  const joinSeat = async (color: "x" | "o") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    const isOccupiedByMe =
      gameState.xPlayer?.id === currentUser.id ||
      gameState.oPlayer?.id === currentUser.id;

    if (isOccupiedByMe) return;

    const updated = { ...gameState };
    if (color === "x") {
      updated.xPlayer = currentUser;
      updated.xWagerAgreed = false;
    } else {
      updated.oPlayer = currentUser;
      updated.oWagerAgreed = false;
    }

    updated.status = "waiting";
    updated.xWagerAgreed = false;
    updated.oWagerAgreed = false;

    await set(gameRef, updated);
    playSound("button");
  };

  const leaveSeat = async (color: "x" | "o") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    const updated = { ...gameState };

    if (gameState.status === "active" && gameState.wagerPool) {
      playSound("lose");
      const winnerColor = color === "x" ? "o" : "x";
      const winnerId = winnerColor === "x" ? gameState.xPlayer?.id : gameState.oPlayer?.id;
      if (winnerId) {
        const winnerBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
        await set(winnerBalanceRef, (balances[winnerId] ?? 1000) + gameState.wagerPool);
      }
      updated.wagerPool = 0;
      updated.status = "resigned";
      updated.winner = winnerColor;
    }

    if (color === "x") {
      updated.xPlayer = null;
      updated.xWagerAgreed = false;
    } else {
      updated.oPlayer = null;
      updated.oWagerAgreed = false;
    }

    if (updated.status === "active") {
      updated.status = "waiting";
    }
    updated.xWagerAgreed = false;
    updated.oWagerAgreed = false;

    await set(gameRef, updated);
    playSound("button");
  };

  const handleSetWager = async (amount: number) => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    await set(gameRef, {
      ...gameState,
      wager: amount,
      xWagerAgreed: false,
      oWagerAgreed: false,
    });
    playSound("button");
  };

  const handleToggleWagerAgreed = async () => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    const updated = { ...gameState };

    if (myColor === "x") {
      updated.xWagerAgreed = !gameState.xWagerAgreed;
    } else {
      updated.oWagerAgreed = !gameState.oWagerAgreed;
    }

    const isXAgreed = myColor === "x" ? updated.xWagerAgreed : !!gameState.xWagerAgreed;
    const isOAgreed = myColor === "o" ? updated.oWagerAgreed : !!gameState.oWagerAgreed;

    if (isXAgreed && isOAgreed) {
      const activeWager = gameState.wager || 50;
      const xId = gameState.xPlayer?.id;
      const oId = gameState.oPlayer?.id;

      if (xId && oId) {
        const xBal = balances[xId] ?? 1000;
        const oBal = balances[oId] ?? 1000;

        if (xBal < activeWager || oBal < activeWager) {
          updated.xWagerAgreed = false;
          updated.oWagerAgreed = false;
          setWagerError("Insufficient coins! lower the stakes or request faucet coins first.");
          playSound("lose");
          await set(gameRef, updated);
          return;
        }

        // Deduct
        const xBalRef = ref(db, `rooms/${roomId}/chess/balances/${xId}`);
        const oBalRef = ref(db, `rooms/${roomId}/chess/balances/${oId}`);
        await set(xBalRef, xBal - activeWager);
        await set(oBalRef, oBal - activeWager);

        updated.wagerPool = activeWager * 2;
        updated.status = "active";
        updated.board = Array(9).fill("");
        updated.turn = "x";
        updated.lastMove = null;
        playSound("win");
      }
    }

    await set(gameRef, updated);
  };

  const checkTicTacToeVictory = (board: string[]): string | null => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
      [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const [a, b, c] of lines) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }

    if (board.every((cell) => cell !== "")) {
      return "draw";
    }

    return null;
  };

  const handleCellClick = async (index: number) => {
    if (!gameState || gameState.status !== "active") return;
    if (gameState.turn !== myColor) return;
    if (gameState.board[index] !== "") return; // Occupied

    const nextBoard = [...gameState.board];
    nextBoard[index] = myColor;

    playSound("click");

    const winType = checkTicTacToeVictory(nextBoard);
    let nextStatus = gameState.status;
    let winner: string | null = null;
    let currentWagerPool = gameState.wagerPool;

    if (winType === "x" || winType === "o") {
      nextStatus = "won";
      winner = winType;
      playSound("win");

      const winnerId = winType === "x" ? gameState.xPlayer?.id : gameState.oPlayer?.id;
      if (winnerId && currentWagerPool > 0) {
        const winnerBalRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
        await set(winnerBalRef, (balances[winnerId] ?? 1000) + currentWagerPool);
        currentWagerPool = 0;
      }
    } else if (winType === "draw") {
      nextStatus = "draw";
      winner = "draw";
      playSound("draw");

      // Refund half
      const xId = gameState.xPlayer?.id;
      const oId = gameState.oPlayer?.id;
      const refund = Math.floor(currentWagerPool / 2);
      if (refund > 0) {
        if (xId) {
          await set(ref(db, `rooms/${roomId}/chess/balances/${xId}`), (balances[xId] ?? 1000) + refund);
        }
        if (oId) {
          await set(ref(db, `rooms/${roomId}/chess/balances/${oId}`), (balances[oId] ?? 1000) + refund);
        }
        currentWagerPool = 0;
      }
    }

    const nextTurn = gameState.turn === "x" ? "o" : "x";
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    await set(gameRef, {
      ...gameState,
      board: nextBoard,
      turn: nextTurn,
      status: nextStatus,
      winner,
      wagerPool: currentWagerPool,
      lastMove: index,
    });
  };

  const resignGame = async () => {
    if (!gameState || !myColor || gameState.status !== "active") return;
    playSound("lose");
    const opponentColor = myColor === "x" ? "o" : "x";
    const opponentId = opponentColor === "x" ? gameState.xPlayer?.id : gameState.oPlayer?.id;
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);

    if (gameState.wagerPool && opponentId) {
      await set(ref(db, `rooms/${roomId}/chess/balances/${opponentId}`), (balances[opponentId] ?? 1000) + gameState.wagerPool);
    }

    await set(gameRef, {
      ...gameState,
      status: "resigned",
      winner: opponentColor,
      wagerPool: 0,
    });
  };

  const resetGame = async () => {
    const gameRef = ref(db, `rooms/${roomId}/tictactoe`);
    setWagerError(null);
    await set(gameRef, {
      board: Array(9).fill(""),
      turn: "x",
      xPlayer: gameState?.xPlayer || null,
      oPlayer: gameState?.oPlayer || null,
      status: "waiting",
      wager: gameState?.wager || 50,
      wagerPool: 0,
      xWagerAgreed: false,
      oWagerAgreed: false,
      createdAt: Date.now(),
    });
    playSound("button");
  };

  const handleClaimFreeCoins = async () => {
    if (!currentUser || !roomId) return;
    const currentVal = balances[currentUser.id] ?? 1000;
    await set(ref(db, `rooms/${roomId}/chess/balances/${currentUser.id}`), currentVal + 500);
  };

  // Autoseat aligns
  useEffect(() => {
    if (!gameState) return;
    const isOccupiedByMe =
      gameState.xPlayer?.id === currentUser.id ||
      gameState.oPlayer?.id === currentUser.id;

    if (!isOccupiedByMe) {
      if (!gameState.xPlayer) {
        joinSeat("x");
      } else if (!gameState.oPlayer) {
        joinSeat("o");
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
              Tic-Tac-Toe Stakes <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">Fast action wager board</span>
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
        {/* O PLAYER (BLACK/TOP) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80 font-sans">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-md bg-zinc-900 border border-amber-500 text-amber-500 font-bold font-sans flex items-center justify-center text-xs shadow-md">O</span>
            <div className="flex flex-col animate-fadeIn">
              <span className="font-sans font-medium text-xs text-zinc-205 text-zinc-200">
                {gameState?.oPlayer ? gameState.oPlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-505 text-amber-500/90 font-mono font-semibold">
                {gameState?.oPlayer ? `${balances[gameState.oPlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal"> | O Player</span>
              </span>
            </div>
            {gameState?.oPlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-805 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 font-bold uppercase">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.oPlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveSeat("o")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-900 border border-red-950 text-red-400 text-[10px] font-semibold"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "o" && gameState.status === "active" && (
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
                <Coins className="w-4 h-4 text-amber-500" />
                <span className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400">Negotiate Tic-Tac-Toe Bet</span>
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
                  {[25, 50, 100, 250, 500].map((amount) => {
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
                    gameState.xWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">X Side (White)</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.xWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 animate-pulse"></span>
                      )}
                      {gameState.xWagerAgreed ? "Agreed" : "Unlocks"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.xPlayer ? `${balances[gameState.xPlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>

                  <div className={`p-2 rounded border flex flex-col items-center justify-center gap-1 font-sans text-[11px] ${
                    gameState.oWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">O Side (Black)</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.oWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 animate-pulse"></span>
                      )}
                      {gameState.oWagerAgreed ? "Agreed" : "Unlocks"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.oPlayer ? `${balances[gameState.oPlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleWagerAgreed}
                  disabled={!gameState.xPlayer || !gameState.oPlayer}
                  className={`p-2 rounded-lg font-bold text-xs uppercase tracking-wide transition-all border shadow-md flex items-center justify-center gap-1.5 mt-1 ${
                    !gameState.xPlayer || !gameState.oPlayer
                      ? "bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed opacity-50"
                      : (myColor === "x" && gameState.xWagerAgreed) || (myColor === "o" && gameState.oWagerAgreed)
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-350 text-emerald-300 hover:bg-emerald-500/30"
                      : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 border-amber-400"
                  }`}
                >
                  <Coins className="w-4 h-4 text-zinc-950 animate-pulse" />
                  <span>
                    {(myColor === "x" && gameState.xWagerAgreed) || (myColor === "o" && gameState.oWagerAgreed)
                      ? "Unlock Decision"
                      : `Approve wager: ${gameState.wager} Coins`}
                  </span>
                </button>
              </div>
            ) : (
              <div className="p-3 bg-zinc-950/50 border border-zinc-850 rounded text-center text-xs text-zinc-400 font-sans">
                <Users className="w-5 h-5 mx-auto text-zinc-500 mb-1 animate-pulse" />
                <span>You are spectating this match. The players are setting a <b className="text-amber-400">{gameState.wager} Coins</b> game.</span>
              </div>
            )}
          </motion.div>
        )}

        {/* ACTIVE ESCROW */}
        {gameState && gameState.status === "active" && gameState.wagerPool && (
          <div className="bg-gradient-to-r from-emerald-950/20 via-zinc-900 to-emerald-950/20 border border-emerald-900/30 p-2 text-center text-xs text-emerald-400 rounded-lg font-bold flex items-center justify-center gap-1.5 animate-pulse uppercase tracking-wider select-none leading-none">
            <Coins className="w-4 h-4 text-amber-500" />
            <span>Active match pool: <b className="text-amber-400 font-mono font-bold text-sm">{(gameState.wagerPool).toLocaleString()} Coins</b> winner takes all!</span>
          </div>
        )}

        {/* 3x3 GRID FRAME */}
        <div className="flex justify-center items-center flex-1 p-2 md:p-6 w-full">
          <div className="w-full max-w-[min(300px,55vh)] aspect-square grid grid-cols-3 grid-rows-3 gap-2 bg-zinc-950 p-2 rounded-xl border border-zinc-805 border-zinc-800 shadow-2xl relative select-none">
            {gameState?.board.map((cell, idx) => {
              const isLastMove = gameState.lastMove === idx;
              return (
                <div
                  key={idx}
                  onClick={() => handleCellClick(idx)}
                  className={`relative bg-zinc-900 hover:bg-zinc-850 rounded-lg flex items-center justify-center cursor-pointer transition-all border border-zinc-800/85
                    ${isLastMove ? "ring-2 ring-amber-500/20 font-bold bg-amber-500/5" : ""}
                  `}
                >
                  <AnimatePresence>
                    {cell !== "" && (
                      <motion.span
                        initial={{ scale: 0.1, opacity: 0, rotate: -45 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        className={`text-4xl sm:text-5xl font-sans font-extrabold flex items-center justify-center select-none ${
                          cell === "x" 
                            ? "text-rose-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.3)] font-sans" 
                            : "text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.3)] font-sans"
                        }`}
                      >
                        {cell.toUpperCase()}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* End State Overlay */}
            <AnimatePresence>
              {gameState && gameState.status !== "active" && gameState.status !== "waiting" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/92 flex flex-col items-center justify-center p-4 text-center z-50 rounded-xl select-all"
                >
                  <div className="p-2 bg-amber-500/10 border border-amber-500/25 rounded-full mb-2 animate-bounce">
                    <Award className="w-8 h-8 text-amber-500" />
                  </div>
                  <h3 className="text-xs font-sans font-bold text-zinc-100 uppercase tracking-widest leading-none">
                    Stakes Tic-Tac-Toe Verdict
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1 mb-4 select-none">{statusMessage}</p>
                  
                  <button
                    onClick={resetGame}
                    className="p-1 px-4 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-zinc-950 text-xs font-bold leading-none cursor-pointer"
                  >
                    Setup Next Wager
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* X PLAYER (CARD BOTTOM) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80 mt-auto font-sans">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-md bg-zinc-900 border border-rose-500 text-rose-505 text-rose-500 font-bold font-sans flex items-center justify-center text-xs shadow-md">X</span>
            <div className="flex flex-col">
              <span className="font-sans font-medium text-xs text-zinc-200">
                {gameState?.xPlayer ? gameState.xPlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-505 text-amber-500/90 font-mono font-semibold">
                {gameState?.xPlayer ? `${balances[gameState.xPlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal"> | X Player</span>
              </span>
            </div>
            {gameState?.xPlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-805 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 font-bold uppercase">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.xPlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveSeat("x")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-900 border border-red-950 text-red-400 text-[10px] font-semibold"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "x" && gameState.status === "active" && (
              <span className="animate-pulse text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-bold uppercase">
                Thinking Turn
              </span>
            )}
          </div>
        </div>

        {/* FREE COINS */}
        <div className="p-3 bg-zinc-950/40 border border-zinc-850 rounded-lg flex items-center justify-between gap-3 text-xs text-zinc-400 select-none">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500" />
            <div className="flex flex-col">
              <span className="font-sans font-semibold text-[11px] text-zinc-300">Wager Power Refill</span>
              <span className="text-[10px] text-zinc-500">Add 500 test coins to negotiate a high stakes match</span>
            </div>
          </div>
          <button
            onClick={handleClaimFreeCoins}
            type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-855 border border-zinc-800 hover:bg-zinc-800 text-amber-400 font-bold text-[11px] font-sans"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Refill Faucet</span>
          </button>
        </div>
      </div>

      <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400 select-none">
        <span className="text-zinc-400 flex items-center gap-1.5 font-sans font-medium select-none">
          <TrendingUp className="w-3.5 h-3.5 text-zinc-500" />
          {statusMessage}
        </span>

        {myColor && gameState?.status === "active" && (
          <button
            onClick={resignGame}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-red-400 hover:bg-red-950/50 hover:text-red-300 transition-colors border border-transparent hover:border-red-900 text-xs font-sans select-none animate-fadeIn cursor-pointer"
          >
            <Flag className="w-3.5 h-3.5" /> Forfeit Table
          </button>
        )}
      </div>
    </div>
  );
}
