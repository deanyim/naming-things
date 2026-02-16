"use client";

import { useState } from "react";

export function AnswerInput({
  onSubmit,
  disabled,
  onInputChange,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
  onInputChange?: () => void;
}) {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSubmit(text.trim());
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onInputChange?.();
        }}
        placeholder="type an answer..."
        disabled={disabled}
        autoFocus
        className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        add
      </button>
    </form>
  );
}
