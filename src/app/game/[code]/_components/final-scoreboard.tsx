"use client";

import { useRouter } from "next/navigation";
import type { GameState } from "./types";

export function FinalScoreboard({ game }: { game: GameState }) {
  const router = useRouter();

  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h2 className="text-2xl font-bold text-gray-900">final scores</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        <div className="w-full space-y-3">
          {sorted.map((player, i) => (
            <div
              key={player.id}
              className={`flex items-center justify-between rounded-lg p-4 ${
                player.score === topScore && topScore > 0
                  ? "border-2 border-yellow-400 bg-yellow-50"
                  : "border border-gray-200 bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-gray-400">
                  {i + 1}
                </span>
                <span className="font-medium text-gray-900">
                  {player.displayName}
                </span>
              </div>
              <span className="text-xl font-bold text-gray-900">
                {player.score}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push("/")}
          className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          play again
        </button>
      </div>
    </main>
  );
}
