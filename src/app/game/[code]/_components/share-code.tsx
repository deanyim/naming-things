"use client";

import { useState } from "react";

export function ShareCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-gray-500">game code</p>
      <button
        onClick={handleCopy}
        className="rounded-lg bg-gray-100 px-6 py-3 font-mono text-2xl font-bold tracking-widest text-gray-900 transition hover:bg-gray-200"
      >
        {code}
      </button>
      <p className="text-xs text-gray-400">
        {copied ? "copied!" : "tap to copy"}
      </p>
    </div>
  );
}
