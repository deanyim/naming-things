"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import type { GameState } from "./types";

interface PlayerAnswer {
  text: string;
  isCommon: boolean;
  wasDisputed: boolean;
  status: "accepted" | "disputed" | "rejected";
}

export function FinalScoreboard({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const router = useRouter();
  const [expandedPlayer, setExpandedPlayer] = useState<number | null>(null);

  const answersQuery = api.game.getAllAnswers.useQuery(
    { sessionToken, gameId: game.id },
    { enabled: !!sessionToken, staleTime: 0 },
  );

  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;


  // Build per-player answer lists from grouped data
  const playerAnswers = new Map<number, PlayerAnswer[]>();
  if (answersQuery.data) {
    for (const group of answersQuery.data) {
      for (const answer of group.answers) {
        if (!playerAnswers.has(answer.playerId)) {
          playerAnswers.set(answer.playerId, []);
        }
        playerAnswers.get(answer.playerId)!.push({
          text: answer.text,
          isCommon: group.isCommon,
          wasDisputed: answer.disputeVotes.length > 0,
          status: answer.status,
        });
      }
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h2 className="text-2xl font-bold text-gray-900">final scores</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        <div className="w-full space-y-3">
          {sorted.map((player, i) => {
            const isTop = player.score === topScore && topScore > 0;
            const isExpanded = expandedPlayer === player.id;
            const answers = playerAnswers.get(player.id) ?? [];

            return (
              <div key={player.id}>
                <button
                  onClick={() =>
                    setExpandedPlayer(isExpanded ? null : player.id)
                  }
                  className={`flex w-full items-center justify-between rounded-lg p-4 text-left transition ${
                    isTop
                      ? "border-2 border-yellow-400 bg-yellow-50"
                      : "border border-gray-200 bg-gray-50"
                  } ${isExpanded ? "rounded-b-none" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-400">
                      {i + 1}
                    </span>
                    <span className="font-medium text-gray-900">
                      {player.displayName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-gray-900">
                      {player.score}
                    </span>
                    <span
                      className={`text-gray-400 transition ${isExpanded ? "rotate-180" : ""}`}
                    >
                      ▼
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div
                    className={`rounded-b-lg border border-t-0 px-4 py-3 ${
                      isTop
                        ? "border-yellow-400 bg-yellow-50/50"
                        : "border-gray-200 bg-gray-50/50"
                    }`}
                  >
                    {answers.length === 0 ? (
                      <p className="text-sm text-gray-400">no answers</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {answers.map((answer, j) => (
                          <li
                            key={j}
                            className="flex items-center justify-between text-sm"
                          >
                            <span
                              className={
                                answer.status === "rejected"
                                  ? "text-gray-400 line-through"
                                  : "text-gray-700"
                              }
                            >
                              {answer.text}
                            </span>
                            <span className="flex gap-1.5">
                              {answer.isCommon && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                  common
                                </span>
                              )}
                              {answer.wasDisputed && answer.status === "accepted" && (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                                  disputed — kept
                                </span>
                              )}
                              {answer.wasDisputed && answer.status === "rejected" && (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                  disputed — rejected
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {game.spectators.length > 0 && (
          <p className="text-sm text-gray-400">
            {game.spectators.length} spectator{game.spectators.length !== 1 ? "s" : ""} watched this game
          </p>
        )}

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
