"use client";

import React from "react";

const AVATAR_BG_COLORS = [
  "bg-emerald-600 text-white",
  "bg-blue-600 text-white",
  "bg-amber-500 text-white",
  "bg-purple-600 text-white",
  "bg-rose-500 text-white",
  "bg-indigo-600 text-white",
  "bg-teal-600 text-white",
  "bg-pink-600 text-white",
  "bg-cyan-600 text-white",
  "bg-violet-600 text-white",
  "bg-orange-500 text-white",
  "bg-lime-600 text-white",
];

export function getInitialChar(name: string): string {
  const clean = name.trim().replace(/^[^a-zA-Z\u0980-\u09FF0-9]+/u, "");
  if (!clean) return "হ";
  const chars = Array.from(clean);
  return (chars[0] || "হ").toUpperCase();
}

export function getAvatarColor(charOrName: string): string {
  const key = charOrName.trim();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_BG_COLORS.length;
  return AVATAR_BG_COLORS[idx];
}

export function LedgerAvatar({
  name,
  imageUrl,
  size = "md",
  className = "",
}: {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const char = getInitialChar(name);
  const colorClass = getAvatarColor(char);

  const sizeClasses = {
    sm: "w-8 h-8 text-xs rounded-md",
    md: "w-10 h-10 text-base rounded-lg",
    lg: "w-14 h-14 text-xl rounded-lg",
    xl: "w-20 h-20 text-2xl rounded-xl",
  }[size];

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${sizeClasses} object-cover shrink-0 ring-1 ring-slate-200/80 shadow-xs ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} ${colorClass} flex items-center justify-center font-bold shrink-0 select-none shadow-xs ${className}`}
      aria-hidden="true"
    >
      {char}
    </div>
  );
}
