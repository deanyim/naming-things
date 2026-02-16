"use client";

import { useState, useEffect } from "react";
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
  const [category, setCategory] = useState(game.category ?? "");
  const [timerValue, setTimerValue] = useState(60);
  const [timerUnit, setTimerUnit] = useState<"seconds" | "minutes">("seconds");
  const [error, setError] = useState("");

  // Keep local category in sync with server state (for non-host players)
  useEffect(() => {
    if (!game.isHost && game.category !== null) {
      setCategory(game.category);
    }
  }, [game.category, game.isHost]);

  const timerSeconds =
    timerUnit === "minutes" ? timerValue * 60 : timerValue;

  const utils = api.useUtils();

  const setCategoryMutation = api.game.setCategory.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const startGame = api.game.start.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const saveCategory = () => {
    const trimmed = category.trim();
    if (trimmed && trimmed !== game.category) {
      setCategoryMutation.mutate({
        sessionToken,
        gameId: game.id,
        category: trimmed,
      });
    }
  };

  const handleStart = () => {
    if (!game.category && !category.trim()) {
      setError("Set a topic first");
      return;
    }
    // Save category if it hasn't been saved yet
    if (category.trim() && category.trim() !== game.category) {
      saveCategory();
    }
    if (timerSeconds < 10 || timerSeconds > 3600) {
      setError("Timer must be between 10 seconds and 60 minutes");
      return;
    }
    setError("");
    startGame.mutate({
      sessionToken,
      gameId: game.id,
      timerSeconds,
    });
  };

  const topicSet = !!game.category;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h1 className="text-2xl font-bold text-gray-900">lobby</h1>

        <ShareCode code={game.code} />

        <PlayerList players={game.players} />

        {/* Topic — visible to all, editable by host */}
        {game.isHost ? (
          <div className="flex w-full flex-col gap-4">
            <div className="flex w-full gap-2">
              <input
                type="text"
                placeholder="topic (e.g. types of cheese)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={saveCategory}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCategory();
                }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
              />
              <button
                onClick={saveCategory}
                disabled={
                  setCategoryMutation.isPending ||
                  !category.trim() ||
                  category.trim() === game.category
                }
                className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                {setCategoryMutation.isPending ? "..." : "set"}
              </button>
            </div>

            {topicSet && (
              <p className="text-center text-sm text-gray-500">
                topic: <span className="font-medium text-gray-900">{game.category}</span>
              </p>
            )}

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-500">timer</label>
              <input
                type="number"
                min={1}
                value={timerValue}
                onChange={(e) => setTimerValue(Math.max(1, Number(e.target.value)))}
                className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
              />
              <select
                value={timerUnit}
                onChange={(e) =>
                  setTimerUnit(e.target.value as "seconds" | "minutes")
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
              >
                <option value="seconds">seconds</option>
                <option value="minutes">minutes</option>
              </select>
            </div>

            <button
              onClick={handleStart}
              disabled={startGame.isPending || !topicSet}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {startGame.isPending ? "starting..." : "start round"}
            </button>

            {error && (
              <p className="text-center text-sm text-red-600">{error}</p>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-4">
            {topicSet ? (
              <p className="text-sm text-gray-500">
                topic: <span className="font-medium text-gray-900">{game.category}</span>
              </p>
            ) : null}
            <p className="text-center text-gray-500">
              waiting for the host to start...
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
