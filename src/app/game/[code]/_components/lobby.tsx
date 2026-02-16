"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { ShareCode } from "./share-code";
import { PlayerList } from "./player-list";
import type { GameState } from "./types";

export function Lobby({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const [category, setCategory] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [error, setError] = useState("");

  const utils = api.useUtils();
  const startGame = api.game.start.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const handleStart = () => {
    if (!category.trim()) {
      setError("Enter a category");
      return;
    }
    setError("");
    startGame.mutate({
      sessionToken,
      gameId: game.id,
      category: category.trim(),
      timerSeconds,
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h1 className="text-2xl font-bold text-gray-900">lobby</h1>

        <ShareCode code={game.code} />

        <PlayerList players={game.players} />

        {game.isHost ? (
          <div className="flex w-full flex-col gap-4">
            <input
              type="text"
              placeholder="category (e.g. types of cheese)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
            />

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-500">timer</label>
              <select
                value={timerSeconds}
                onChange={(e) => setTimerSeconds(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
              >
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={90}>90s</option>
                <option value={120}>2 min</option>
                <option value={180}>3 min</option>
              </select>
            </div>

            <button
              onClick={handleStart}
              disabled={startGame.isPending}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {startGame.isPending ? "starting..." : "start round"}
            </button>

            {error && (
              <p className="text-center text-sm text-red-600">{error}</p>
            )}
          </div>
        ) : (
          <p className="text-center text-gray-500">
            waiting for the host to start...
          </p>
        )}
      </div>
    </main>
  );
}
