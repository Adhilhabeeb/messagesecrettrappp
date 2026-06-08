import React, { useState, useEffect, useMemo, useRef } from "react";
import { Chess, Square } from "chess.js";
import { ref, set, onValue } from "firebase/database";
import { db } from "../firebase";
import { ChessGameSync, UserProfile } from "../types";
import { ShieldAlert, RotateCcw, Award, Flag, Users, HelpCircle, Eye, Coins, CheckCircle2, BadgeAlert, PlusCircle, TrendingUp, Sparkles, HelpCircle as HelpIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ChessGameProps {
  roomId: string;
  currentUser: UserProfile;
}

// Map chess pieces to elegant SVG/Unicode representations for high resolution and clean sizing
const PIECE_SYMBOLS: { [key: string]: string } = {
  kp: "♙", kn: "♘", kb: "♗", kr: "♖", kq: "♕", kk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

const PIECE_COLORS: { [key: string]: string } = {
  k: "text-amber-50 shadow-md", // white pieces (amber-50 looks rich)
  b: "text-zinc-950 stroke-white drop-shadow-[0_2px_2px_rgba(255,255,255,0.7)]", // black pieces
};

// Procedural audio engine using Web Audio API for rewarding chimes
const playSound = (type: "coin" | "win" | "lose" | "place" | "draw") => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (type === "coin") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.2); // D6
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } else if (type === "place") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "win") {
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // Beautiful C major arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.3);
      });
    } else if (type === "lose") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === "draw") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    console.warn("Audio feedback blocked or unsupported", e);
  }
};

export default function ChessGame({ roomId, currentUser }: ChessGameProps) {
  const [gameState, setGameState] = useState<ChessGameSync | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [flipBoard, setFlipBoard] = useState(false);
  const [balances, setBalances] = useState<{ [userId: string]: number }>({});
  const [wagerError, setWagerError] = useState<string | null>(null);
  const [coinAnimations, setCoinAnimations] = useState<{ id: number; amount: number; x: number; y: number }[]>([]);

  // Ref to track balance changes for animation trigger
  const previousBalanceRef = useRef<number | null>(null);

  // Initialize chess instance with current state or empty FEN
  const chess = useMemo(() => {
    return new Chess(gameState?.fen || undefined);
  }, [gameState?.fen]);

  // Read game state from Firebase Realtime Database
  useEffect(() => {
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.val());
      } else {
        const initialGame: ChessGameSync = {
          fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          turn: "w",
          whitePlayer: null,
          blackPlayer: null,
          status: "waiting",
          wager: 100,
          wagerPool: 0,
          whiteWagerAgreed: false,
          blackWagerAgreed: false,
          createdAt: Date.now(),
        };
        set(gameRef, initialGame);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Read and subscribe to coin balances state
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

  // Auto-initialize balance to 1000 if user doesn't have one
  useEffect(() => {
    if (!currentUser || !roomId) return;
    if (balances[currentUser.id] === undefined) {
      const myBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${currentUser.id}`);
      set(myBalanceRef, 1000);
    }
  }, [balances, currentUser?.id, roomId]);

  // Reward animation handler when balance increments
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
        // Just play a place/deduction chime
        playSound("place");
      }
      previousBalanceRef.current = myBalance;
    }
  }, [balances, currentUser.id]);

  // Determine current player's color assignment
  const myColor = useMemo(() => {
    if (gameState?.whitePlayer?.id === currentUser.id) return "w";
    if (gameState?.blackPlayer?.id === currentUser.id) return "b";
    return null; // Spectator
  }, [gameState, currentUser.id]);

  // Sync board flipping automatically with player color choice
  useEffect(() => {
    if (myColor === "b") {
      setFlipBoard(true);
    } else if (myColor === "w") {
      setFlipBoard(false);
    }
  }, [myColor]);

  // Auto-seat assignment for current user if there is an empty slot
  useEffect(() => {
    if (!gameState) return;
    const isOccupiedByMe =
      gameState.whitePlayer?.id === currentUser.id ||
      gameState.blackPlayer?.id === currentUser.id;

    if (!isOccupiedByMe) {
      if (!gameState.whitePlayer) {
        joinGame("w");
      } else if (!gameState.blackPlayer) {
        joinGame("b");
      }
    }
  }, [gameState, currentUser.id]);

  // Get available logical legal moves for the selected piece
  const possibleMoves = useMemo(() => {
    if (!selectedSquare) return [];
    try {
      return chess.moves({ square: selectedSquare as Square, verbose: true });
    } catch {
      return [];
    }
  }, [selectedSquare, chess]);

  // Get status text of the game
  const statusMessage = useMemo(() => {
    if (!gameState) return "Initializing game...";
    if (gameState.status === "waiting") {
      if (gameState.whitePlayer && gameState.blackPlayer) {
        return "Negotiating coin wagers...";
      }
      return "Waiting for opponents to take seats...";
    }
    if (gameState.status === "checkmate") {
      const winnerName = gameState.winner === "w" ? "White" : "Black";
      return `Checkmate! ${winnerName} Wins and extracts the Wager Pool!`;
    }
    if (gameState.status === "draw") {
      return "Game ended in a Draw! Escrow refunds returned.";
    }
    if (gameState.status === "resigned") {
      const winnerName = gameState.winner === "w" ? "White" : "Black";
      return `Forfeit/Resignation. ${winnerName} Wins the Wager Pool!`;
    }
    return chess.inCheck() ? "In Check - Make a move!" : "High Stakes Match Active";
  }, [gameState, chess]);

  // Claim a color seat if empty
  const joinGame = async (color: "w" | "b") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    const isOccupiedByMe =
      gameState.whitePlayer?.id === currentUser.id ||
      gameState.blackPlayer?.id === currentUser.id;

    if (isOccupiedByMe) return;

    const updated = { ...gameState };
    if (color === "w") {
      updated.whitePlayer = currentUser;
      updated.whiteWagerAgreed = false;
    } else {
      updated.blackPlayer = currentUser;
      updated.blackWagerAgreed = false;
    }

    // Changing players resets agreement states
    updated.status = "waiting";
    updated.whiteWagerAgreed = false;
    updated.blackWagerAgreed = false;

    await set(gameRef, updated);
    playSound("place");
  };

  // Safe forfeit/leave seat handler
  const leaveGameSeat = async (color: "w" | "b") => {
    if (!gameState) return;
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    const updated = { ...gameState };
    
    // If active game, forfeit loses wager to opponent
    if (gameState.status === "active" && gameState.wagerPool) {
      playSound("lose");
      const winnerColor = color === "w" ? "b" : "w";
      const winnerId = winnerColor === "w" ? gameState.whitePlayer?.id : gameState.blackPlayer?.id;
      if (winnerId) {
        const winnerBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
        const currentBalVal = balances[winnerId] ?? 1000;
        await set(winnerBalanceRef, currentBalVal + gameState.wagerPool);
      }
      updated.wagerPool = 0;
      updated.status = "resigned";
      updated.winner = winnerColor;
    }

    if (color === "w") {
      updated.whitePlayer = null;
      updated.whiteWagerAgreed = false;
    } else {
      updated.blackPlayer = null;
      updated.blackWagerAgreed = false;
    }
    
    // Fall back to waiting
    if (updated.status === "active") {
      updated.status = "waiting";
    }
    updated.whiteWagerAgreed = false;
    updated.blackWagerAgreed = false;

    await set(gameRef, updated);
  };

  // Adjust proposed wager
  const handleSetWager = async (amount: number) => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    await set(gameRef, {
      ...gameState,
      wager: amount,
      whiteWagerAgreed: false,
      blackWagerAgreed: false,
    });
    playSound("place");
  };

  // Toggle agreement to current wager proposed
  const handleToggleWagerAgreed = async () => {
    if (!gameState || !myColor || gameState.status !== "waiting") return;
    setWagerError(null);
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    const updated = { ...gameState };

    if (myColor === "w") {
      updated.whiteWagerAgreed = !gameState.whiteWagerAgreed;
    } else {
      updated.blackWagerAgreed = !gameState.blackWagerAgreed;
    }

    const isWhiteAgreed = myColor === "w" ? updated.whiteWagerAgreed : !!gameState.whiteWagerAgreed;
    const isBlackAgreed = myColor === "b" ? updated.blackWagerAgreed : !!gameState.blackWagerAgreed;

    // Trigger start if both agree
    if (isWhiteAgreed && isBlackAgreed) {
      const activeWager = gameState.wager || 100;
      const whiteId = gameState.whitePlayer?.id;
      const blackId = gameState.blackPlayer?.id;

      if (whiteId && blackId) {
        const whiteBal = balances[whiteId] ?? 1000;
        const blackBal = balances[blackId] ?? 1000;

        if (whiteBal < activeWager || blackBal < activeWager) {
          updated.whiteWagerAgreed = false;
          updated.blackWagerAgreed = false;
          setWagerError("Insufficient coins! Propose a lower wager or claim free coins below.");
          playSound("lose");
          await set(gameRef, updated);
          return;
        }

        // Deduct from both balances
        const whiteBalRef = ref(db, `rooms/${roomId}/chess/balances/${whiteId}`);
        const blackBalRef = ref(db, `rooms/${roomId}/chess/balances/${blackId}`);
        await set(whiteBalRef, whiteBal - activeWager);
        await set(blackBalRef, blackBal - activeWager);

        // Put into escrow
        updated.wagerPool = activeWager * 2;
        updated.status = "active";
        updated.fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        updated.turn = "w";
        updated.lastMove = null;
        playSound("win");
      }
    }

    await set(gameRef, updated);
  };

  // Perform custom move handling
  const handleSquareClick = async (squareName: string) => {
    if (!gameState || gameState.status !== "active") return;
    if (myColor !== gameState.turn) return; // Not player's turn

    const piece = chess.get(squareName as Square);

    // Click own piece to view targets
    if (piece && piece.color === myColor) {
      setSelectedSquare(squareName);
      return;
    }

    // Target clicked
    if (selectedSquare) {
      const isLegal = possibleMoves.some((m) => m.to === squareName);
      if (isLegal) {
        try {
          const moveResult = chess.move({
            from: selectedSquare,
            to: squareName,
            promotion: "q",
          });

          if (moveResult) {
            let nextStatus: ChessGameSync["status"] = "active";
            let winner: string | null = null;
            let currentWagerPool = gameState.wagerPool || 0;

            if (chess.isGameOver()) {
              if (chess.isCheckmate()) {
                nextStatus = "checkmate";
                winner = myColor;
                playSound("win");

                // Distribute escrow wagerPool to winner
                const winnerId = myColor === "w" ? gameState.whitePlayer?.id : gameState.blackPlayer?.id;
                if (winnerId && currentWagerPool > 0) {
                  const winnerBalRef = ref(db, `rooms/${roomId}/chess/balances/${winnerId}`);
                  const currentBalVal = balances[winnerId] ?? 1000;
                  await set(winnerBalRef, currentBalVal + currentWagerPool);
                  currentWagerPool = 0; // Empty escrow
                }
              } else if (chess.isDraw()) {
                nextStatus = "draw";
                winner = "draw";
                playSound("draw");

                // Refund half-half to players
                const whiteId = gameState.whitePlayer?.id;
                const blackId = gameState.blackPlayer?.id;
                const refund = Math.floor(currentWagerPool / 2);
                if (refund > 0) {
                  if (whiteId) {
                    const whiteBalRef = ref(db, `rooms/${roomId}/chess/balances/${whiteId}`);
                    const val = balances[whiteId] ?? 1000;
                    await set(whiteBalRef, val + refund);
                  }
                  if (blackId) {
                    const blackBalRef = ref(db, `rooms/${roomId}/chess/balances/${blackId}`);
                    const val = balances[blackId] ?? 1000;
                    await set(blackBalRef, val + refund);
                  }
                  currentWagerPool = 0; // Empty escrow
                }
              }
            } else {
              playSound("place");
            }

            const gameRef = ref(db, `rooms/${roomId}/chess`);
            await set(gameRef, {
              fen: chess.fen(),
              turn: chess.turn(),
              whitePlayer: gameState.whitePlayer,
              blackPlayer: gameState.blackPlayer,
              status: nextStatus,
              winner,
              wager: gameState.wager,
              wagerPool: currentWagerPool,
              whiteWagerAgreed: nextStatus === "active" ? gameState.whiteWagerAgreed : false,
              blackWagerAgreed: nextStatus === "active" ? gameState.blackWagerAgreed : false,
              lastMove: {
                from: selectedSquare,
                to: squareName,
                piece: moveResult.piece,
                san: moveResult.san,
              },
              createdAt: gameState.createdAt,
            });
          }
        } catch (e) {
          console.error("Error committing move", e);
        }
      }
      setSelectedSquare(null);
    }
  };

  // Resign command
  const resignGame = async () => {
    if (!gameState || !myColor || gameState.status !== "active") return;
    playSound("lose");
    const opponentColor = myColor === "w" ? "b" : "w";
    const opponentId = opponentColor === "w" ? gameState.whitePlayer?.id : gameState.blackPlayer?.id;
    const gameRef = ref(db, `rooms/${roomId}/chess`);

    if (gameState.wagerPool && opponentId) {
      const oppBalRef = ref(db, `rooms/${roomId}/chess/balances/${opponentId}`);
      const currentOppVal = balances[opponentId] ?? 1000;
      await set(oppBalRef, currentOppVal + gameState.wagerPool);
    }

    await set(gameRef, {
      ...gameState,
      status: "resigned",
      winner: opponentColor,
      wagerPool: 0,
    });
  };

  // Fast reset handler
  const resetGame = async () => {
    const gameRef = ref(db, `rooms/${roomId}/chess`);
    setWagerError(null);
    await set(gameRef, {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      turn: "w",
      whitePlayer: gameState?.whitePlayer || null,
      blackPlayer: gameState?.blackPlayer || null,
      status: "waiting",
      wager: gameState?.wager || 100,
      wagerPool: 0,
      whiteWagerAgreed: false,
      blackWagerAgreed: false,
      createdAt: Date.now(),
    });
    setSelectedSquare(null);
    playSound("place");
  };

  // Claim 500 coin reward
  const handleClaimFreeCoins = async () => {
    if (!currentUser || !roomId) return;
    const currentVal = balances[currentUser.id] ?? 1000;
    const myBalanceRef = ref(db, `rooms/${roomId}/chess/balances/${currentUser.id}`);
    await set(myBalanceRef, currentVal + 500);
  };

  // Render chess board grid cells dynamically
  const boardCells = useMemo(() => {
    const rows = ["8", "7", "6", "5", "4", "3", "2", "1"];
    const cols = ["a", "b", "c", "d", "e", "f", "g", "h"];
    
    const orderedRows = flipBoard ? [...rows].reverse() : rows;
    const orderedCols = flipBoard ? [...cols].reverse() : cols;

    const cells = [];
    for (const r of orderedRows) {
      for (const c of orderedCols) {
        const sq = `${c}${r}`;
        const isWhiteSquare = (c.charCodeAt(0) - 97 + parseInt(r)) % 2 !== 0;
        const piece = chess.get(sq as Square);
        
        const isSelected = selectedSquare === sq;
        const isHighlight = possibleMoves.some((m) => m.to === sq);
        const isLastMoveSrc = gameState?.lastMove?.from === sq;
        const isLastMoveDst = gameState?.lastMove?.to === sq;

        cells.push({
          square: sq,
          isWhiteSquare,
          piece,
          isSelected,
          isHighlight,
          isLastMoveSrc,
          isLastMoveDst,
        });
      }
    }
    return cells;
  }, [chess, selectedSquare, possibleMoves, flipBoard, gameState?.lastMove]);

  return (
    <div className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl h-full relative">
      
      {/* Coin Gain Celebrator Overlay */}
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

      {/* Chess Header Widget */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-950 border-b border-zinc-800 gap-2">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-amber-500 animate-pulse" />
          <div className="flex flex-col">
            <span className="font-sans font-bold text-xs text-zinc-100 uppercase tracking-widest flex items-center gap-1">
              High Stakes Chess <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">Real-time virtual payments table</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5">
          {/* Current balance display with coins */}
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1 text-xs font-semibold text-amber-400 font-mono shadow-[0_0_15px_rgba(245,158,11,0.05)]">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>{(balances[currentUser.id] ?? 1000).toLocaleString()} Coins</span>
          </div>

          <button
            onClick={() => setFlipBoard(!flipBoard)}
            title="Flip Board View"
            className="p-1 px-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded text-[10px] border border-zinc-800 transition-all font-sans"
          >
            Flip View
          </button>
          
          <button
            onClick={resetGame}
            title="Force Reset Board"
            className="p-1 px-2 text-red-400 hover:text-red-300 hover:bg-red-950/20 border border-zinc-800 hover:border-red-900 bg-red-950/10 rounded text-[10px] transition-all font-sans"
          >
            Reset Table
          </button>
        </div>
      </div>

      {/* Main Chess Arena Deck */}
      <div className="flex flex-col flex-1 p-3 gap-3 overflow-y-auto">
        
        {/* OPPONENT CARD (TOP) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 border border-white"></span>
            <div className="flex flex-col">
              <span className="font-sans font-medium text-xs text-zinc-200">
                {gameState?.blackPlayer ? gameState.blackPlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-500/90 font-mono flex items-center gap-1 font-semibold">
                <Coins className="w-3 h-3 text-amber-500" />
                {gameState?.blackPlayer ? `${balances[gameState.blackPlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal">| Black side</span>
              </span>
            </div>
            {gameState?.blackPlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 font-bold uppercase tracking-wider scale-90">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.blackPlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveGameSeat("b")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-905 hover:bg-red-900 border border-red-950 hover:border-red-800 text-red-400 text-[10px] font-semibold transition-colors"
                title="Leave table seat. If active game, wager pool is forfeited!"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "b" && gameState.status === "active" && (
              <span className="animate-pulse flex items-center gap-1.5 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                Thinking Turn
              </span>
            )}
          </div>
        </div>

        {/* WAGER NEGOTIATION / RECONCILIATION PANEL */}
        {gameState && gameState.status === "waiting" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-amber-950/30 via-zinc-900 to-amber-950/30 p-3.5 rounded-xl border border-amber-900/30 flex flex-col gap-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)] my-1 shrink-0"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500 animate-bounce" />
                <span className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400">Negotiate Match Wager</span>
              </div>
              {gameState.wagerPool ? (
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-850 px-2 py-0.5 rounded">Active Pool: {gameState.wagerPool}</span>
              ) : (
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-850 px-2 py-0.5 rounded">Coins Escrow</span>
              )}
            </div>

            {wagerError && (
              <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/40 px-3 py-2 rounded text-red-400 text-xs font-mono select-all">
                <BadgeAlert className="w-4 h-4" />
                <span>{wagerError}</span>
              </div>
            )}

            {/* Set Wager buttons (Interactive only if sitting on seat) */}
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
                            : "bg-zinc-850 text-zinc-300 border-zinc-800 hover:bg-zinc-800"
                        }`}
                      >
                        {amount}
                      </button>
                    );
                  })}
                </div>

                {/* Confirm agreement checkboxes/actions */}
                <div className="flex gap-2.5 mt-1.5 grid grid-cols-2">
                  <div className={`p-2 rounded border flex flex-col items-center justify-center gap-1 font-sans text-[11px] ${
                    gameState.whiteWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">White Player</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.whiteWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 inline" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 inline-block animate-pulse"></span>
                      )}
                      {gameState.whiteWagerAgreed ? "Locked In" : "Unconfirmed"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.whitePlayer ? `${balances[gameState.whitePlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>

                  <div className={`p-2 rounded border flex flex-col items-center justify-center gap-1 font-sans text-[11px] ${
                    gameState.blackWagerAgreed ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400" : "bg-zinc-950/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <span className="font-bold">Black Player</span>
                    <span className="text-[9px] font-mono flex items-center gap-1">
                      {gameState.blackWagerAgreed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 inline" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-650 inline-block animate-pulse"></span>
                      )}
                      {gameState.blackWagerAgreed ? "Locked In" : "Unconfirmed"}
                    </span>
                    <span className="font-mono text-[9px] opacity-75">{gameState.blackPlayer ? `${balances[gameState.blackPlayer.id] ?? 1000} Bal` : "Empty Seat"}</span>
                  </div>
                </div>

                {/* Agree Button */}
                <button
                  type="button"
                  onClick={handleToggleWagerAgreed}
                  disabled={!gameState.whitePlayer || !gameState.blackPlayer}
                  className={`p-2 rounded-lg font-bold text-xs uppercase tracking-wide transition-all border shadow-md flex items-center justify-center gap-1.5 cursor-pointer mt-1 ${
                    !gameState.whitePlayer || !gameState.blackPlayer
                      ? "bg-zinc-950 text-zinc-600 border-zinc-900 cursor-not-allowed opacity-50"
                      : (myColor === "w" && gameState.whiteWagerAgreed) || (myColor === "b" && gameState.blackWagerAgreed)
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-405 text-emerald-300 hover:bg-emerald-500/30"
                      : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 border-amber-400"
                  }`}
                >
                  <Coins className="w-4 h-4 animate-pulse text-zinc-950" />
                  <span>
                    {(myColor === "w" && gameState.whiteWagerAgreed) || (myColor === "b" && gameState.blackWagerAgreed)
                      ? "Unlock Decision"
                      : `Approve Wager match: ${gameState.wager} Coins`}
                  </span>
                </button>
              </div>
            ) : (
              <div className="p-3 bg-zinc-950/50 border border-zinc-850 rounded text-center text-xs text-zinc-400 font-sans select-none">
                <Users className="w-5 h-5 mx-auto text-zinc-500 mb-1 animate-pulse" />
                <span>You are spectating this match. The players are currently setting a match wager of <b className="text-amber-400">{gameState.wager} Coins</b>.</span>
              </div>
            )}
          </motion.div>
        )}

        {/* ACTIVE MATCH ESCROW ESCUTCHEON */}
        {gameState && gameState.status === "active" && gameState.wagerPool && (
          <div className="bg-gradient-to-r from-emerald-950/20 via-zinc-900 to-emerald-950/20 border border-emerald-900/30 p-2 text-center text-xs text-emerald-400 rounded-lg select-none font-sans font-bold shadow-[0_4px_15px_rgba(16,185,129,0.04)] ring-1 ring-emerald-500/10 shrink-0 flex items-center justify-center gap-1.5 animate-pulse uppercase tracking-widest leading-none">
            <Coins className="w-4 h-4 text-amber-500" />
            <span>Escrow Wager Match Pool: <b className="text-amber-400 font-mono text-sm tracking-tight">{(gameState.wagerPool).toLocaleString()} Coins</b> winner takes all!</span>
          </div>
        )}

        {/* Essential Chess Board Frame */}
        <div className="flex justify-center items-center flex-1 p-1.5 sm:p-4 w-full">
          <div className="w-full max-w-[min(380px,65vh)] sm:max-w-[min(480px,70vh)] md:max-w-[min(520px,74vh)] lg:max-w-[min(580px,78vh)] xl:max-w-[min(640px,82vh)] aspect-square grid grid-cols-8 grid-rows-8 bg-zinc-950 rounded-xl overflow-hidden ring-4 ring-zinc-950/80 border border-zinc-800 relative select-none shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            {boardCells.map((cell) => {
              const bgClass = cell.isWhiteSquare
                ? "bg-zinc-800/80 hover:bg-zinc-700/80"
                : "bg-zinc-900 hover:bg-zinc-800/90";

              return (
                <div
                  key={cell.square}
                  id={`square-${cell.square}`}
                  onClick={() => handleSquareClick(cell.square)}
                  className={`relative flex items-center justify-center cursor-pointer transition-all ${bgClass}
                    ${cell.isLastMoveSrc || cell.isLastMoveDst ? "ring-2 ring-amber-500/30 bg-amber-500/5" : ""}
                    ${cell.isSelected ? "ring-2 ring-emerald-500/60 bg-emerald-500/10 z-10 scale-[0.98]" : ""}
                  `}
                >
                  {/* Square Identifier Tag */}
                  <span className="absolute bottom-0 right-0.5 text-[8px] text-zinc-650 font-mono opacity-40 select-none">
                    {cell.square}
                  </span>

                  {/* Render Visual Piece Symbol */}
                  {cell.piece && (
                    <span
                      className={`text-2xl xs:text-3xl sm:text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-sans leading-none z-10 transition-transform hover:scale-110 active:scale-95 flex items-center justify-center select-none
                        ${PIECE_COLORS[cell.piece.color]}
                      `}
                    >
                      {PIECE_SYMBOLS[`${cell.piece.color}${cell.piece.type}`]}
                    </span>
                  )}

                  {/* Highlighting Available Legal Moves */}
                  {cell.isHighlight && (
                    <span className="absolute w-3.5 h-3.5 rounded-full bg-emerald-400/50 ring-2 ring-emerald-500/40 z-20 backdrop-blur-[1px]"></span>
                  )}
                </div>
              );
            })}

            {/* Check overlay / End state Screen */}
            <AnimatePresence>
              {gameState && gameState.status !== "active" && gameState.status !== "waiting" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4 text-center z-50 fallback-blur-md"
                >
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-full mb-3 animate-bounce">
                    <Award className="w-10 h-10 text-amber-500" />
                  </div>
                  <h3 className="text-sm font-sans font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-1">
                    {gameState.status === "checkmate" ? "Match Conclusion (Checkmate)" : "Match Concluded"}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1 mb-5 max-w-xs">{statusMessage}</p>
                  
                  <button
                    onClick={resetGame}
                    className="p-2 px-5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 text-xs font-bold transition-all cursor-pointer shadow-lg hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                  >
                    Setup Next Wager Match
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ACTIVE PLAYER CARD (BOTTOM) */}
        <div className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-800/80 mt-auto">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-50 border border-zinc-900"></span>
            <div className="flex flex-col">
              <span className="font-sans font-medium text-xs text-zinc-200">
                {gameState?.whitePlayer ? gameState.whitePlayer.username : "Empty Seat"}
              </span>
              <span className="text-[10px] text-amber-500/90 font-mono flex items-center gap-1 font-semibold">
                <Coins className="w-3 h-3 text-amber-500" />
                {gameState?.whitePlayer ? `${balances[gameState.whitePlayer.id] ?? 1000} Coins` : "Join below"}
                <span className="text-zinc-500 font-normal">| White side</span>
              </span>
            </div>
            {gameState?.whitePlayer?.id === currentUser.id && (
              <span className="text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 font-bold uppercase tracking-wider scale-90">You</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {gameState?.whitePlayer?.id === currentUser.id && (
              <button
                onClick={() => leaveGameSeat("w")}
                className="p-1 px-2.5 rounded bg-red-950/40 hover:bg-red-905 hover:bg-red-900 border border-red-950 hover:border-red-800 text-red-400 text-[10px] font-semibold transition-colors"
                title="Leave table seat. If active game, wager pool is forfeited!"
              >
                Leave Seat
              </button>
            )}
            {gameState?.turn === "w" && gameState.status === "active" && (
              <span className="animate-pulse flex items-center gap-1.5 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                Thinking Turn
              </span>
            )}
          </div>
        </div>

        {/* EXTRA TEST COINS FAUCET */}
        <div className="p-3 bg-zinc-950/40 border border-zinc-850 rounded-lg flex items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500" />
            <div className="flex flex-col select-none">
              <span className="font-sans font-semibold text-[11px] text-zinc-300">Run out of wager power?</span>
              <span className="text-[10px] text-zinc-500">Claim 500 test coins instantly to stay in the game</span>
            </div>
          </div>
          <button
            onClick={handleClaimFreeCoins}
            type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-855 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 rounded-lg text-amber-400 font-bold transition-all text-[11px]"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Claim 500 CP</span>
          </button>
        </div>

      </div>

      {/* Game Foot Deck Console */}
      <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400 select-none shrink-0">
        <div className="flex items-center gap-1.5 font-sans font-medium">
          {chess.inCheck() && gameState?.status === "active" ? (
            <span className="text-red-400 font-bold flex items-center gap-1 animate-pulse font-sans">
              <ShieldAlert className="w-3.5 h-3.5" /> CHECK! Make defensive move
            </span>
          ) : (
            <span className="text-zinc-505 font-medium flex items-center gap-1 text-zinc-400">
              <TrendingUp className="w-3.5 h-3.5 text-zinc-500" />
              {statusMessage}
            </span>
          )}
        </div>
        
        {myColor && gameState?.status === "active" && (
          <button
            onClick={resignGame}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-red-400 hover:bg-red-950/50 hover:text-red-300 transition-colors font-sans text-xs cursor-pointer border border-transparent hover:border-red-900"
          >
            <Flag className="w-3.5 h-3.5" /> Surrender/Forfeit
          </button>
        )}
      </div>
    </div>
  );
}
