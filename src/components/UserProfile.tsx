import React, { useState } from "react";
import { UserProfile } from "../types";
import { Terminal, Shuffle, ArrowRight, User } from "lucide-react";

interface UserProfileProps {
  onSaved: (profile: UserProfile) => void;
  initialProfile?: UserProfile | null;
}

const AVATAR_PRESETS = [
  { char: "♘", label: "White Knight", bg: "bg-amber-600/20 border-amber-500 text-amber-400" },
  { char: "♚", label: "Black King", bg: "bg-zinc-800/80 border-zinc-600 text-zinc-100" },
  { char: "♛", label: "Tech Queen", bg: "bg-emerald-600/20 border-emerald-500 text-emerald-400" },
  { char: "▲", label: "Cipher Delta", bg: "bg-sky-600/20 border-sky-500 text-sky-400" },
  { char: "◆", label: "Quantum Gem", bg: "bg-indigo-600/20 border-indigo-500 text-indigo-400" },
  { char: "◈", label: "Matrix Node", bg: "bg-rose-600/20 border-rose-500 text-rose-400" },
  { char: "✦", label: "Star Cluster", bg: "bg-purple-600/20 border-purple-500 text-purple-400" },
  { char: "♜", label: "Royal Castle", bg: "bg-teal-600/20 border-teal-500 text-teal-400" },
];

const HIGHLIGHT_COLORS = [
  "border-amber-500/50 text-amber-400 shadow-amber-500/20",
  "border-emerald-500/50 text-emerald-400 shadow-emerald-500/20",
  "border-sky-500/50 text-sky-400 shadow-sky-500/20",
  "border-indigo-500/50 text-indigo-400 shadow-indigo-500/20",
  "border-rose-500/50 text-rose-400 shadow-rose-500/20",
  "border-purple-500/50 text-purple-400 shadow-purple-500/20",
];

export default function UserProfileSettings({ onSaved, initialProfile }: UserProfileProps) {
  const [username, setUsername] = useState(
    initialProfile?.username || ""
  );
  const [selectedAvatar, setSelectedAvatar] = useState(
    initialProfile?.avatar || AVATAR_PRESETS[0].char
  );
  const [selectedColor, setSelectedColor] = useState(
    initialProfile?.color || "text-amber-400"
  );

  const handleRandomize = () => {
    const prefixes = ["Cipher", "Ghost", "Matrix", "Shadow", "Vector", "Cosmic", "Quantum", "Glitch"];
    const suffixes = ["Rider", "Knight", "Pawn", "Seer", "Specter", "Node", "Core", "Engine"];
    const randomName = `${prefixes[Math.floor(Math.random() * prefixes.length)]}_${
      suffixes[Math.floor(Math.random() * suffixes.length)]
    }${Math.floor(10 + Math.random() * 90)}`;
    
    setUsername(randomName);

    const randomAvatar = AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)];
    setSelectedAvatar(randomAvatar.char);

    const colorClasses = ["text-amber-400", "text-emerald-400", "text-sky-400", "text-indigo-400", "text-rose-400", "text-purple-400"];
    setSelectedColor(colorClasses[Math.floor(Math.random() * colorClasses.length)]);
  };

  const handleSave = () => {
    const finalName = username.trim() || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    const profile: UserProfile = {
      id: initialProfile?.id || `user_${Math.random().toString(36).substring(2, 11)}`,
      username: finalName,
      avatar: selectedAvatar,
      color: selectedColor,
    };
    onSaved(profile);
  };

  return (
    <div className="w-full max-w-sm p-6 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl relative overflow-hidden">
      {/* Decorative ambient background */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none"></div>

      <div className="flex flex-col items-center mb-6">
        <div className="p-2.5 rounded-full bg-zinc-900 border border-zinc-800 text-amber-500/90 mb-3">
          <Terminal className="w-6 h-6" />
        </div>
        <h2 className="font-sans font-semibold text-lg text-zinc-100 tracking-tight">
          Initialize Profile
        </h2>
        <p className="text-xs text-zinc-500 mt-1 text-center font-sans">
          Select your cyber-identity for secure communication
        </p>
      </div>

      <div className="space-y-4">
        {/* Username input with randomize button */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Username / Nickname
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Ex. Net_Runner..."
                maxLength={20}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-3 pl-8 text-base text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 font-sans"
              />
              <User className="absolute left-2.5 top-2.5 w-4 h-4 text-zinc-600" />
            </div>
            <button
              onClick={handleRandomize}
              type="button"
              title="Randomize identity detail"
              className="p-2 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors shadow hover:bg-zinc-800"
            >
              <Shuffle className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Avatar Selectors */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Select Your Avatar
          </label>
          <div className="grid grid-cols-4 gap-2">
            {AVATAR_PRESETS.map((preset) => {
              const isSelected = selectedAvatar === preset.char;
              return (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.label}
                  onClick={() => setSelectedAvatar(preset.char)}
                  className={`aspect-square flex items-center justify-center text-2xl font-semibold border-2 rounded-lg transition-all ${preset.bg}
                    ${isSelected ? "scale-95 ring-2 ring-amber-500 ring-offset-2 ring-offset-zinc-950 border-transparent" : "opacity-60 hover:opacity-100 hover:scale-[1.03]"}
                  `}
                >
                  {preset.char}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Highlighter select */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Visual Color Highlight
          </label>
          <div className="flex gap-2.5 justify-between">
            {HIGHLIGHT_COLORS.map((colStr) => {
              const textVal = colStr.split(" ")[1];
              const isSelected = selectedColor === textVal;
              const bgDotClass = textVal.replace("text-", "bg-");

              return (
                <button
                  key={textVal}
                  type="button"
                  onClick={() => setSelectedColor(textVal)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all border ${
                    isSelected ? "ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950 scale-110" : "hover:scale-105 opacity-80"
                  }`}
                  style={{ borderColor: "rgba(255,255,255,0.1)" }}
                >
                  <span className={`w-3.5 h-3.5 rounded-full ${bgDotClass}`}></span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 py-2.5 px-4 rounded-lg font-sans font-medium text-sm transition-colors shadow-lg cursor-pointer mt-2"
        >
          Enter Workspace
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
