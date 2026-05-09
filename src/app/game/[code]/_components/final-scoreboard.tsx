"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import type { GameState } from "./types";


interface PlayerAnswer {
  id: number;
  text: string;
  isCommon: boolean;
  wasDisputed: boolean;
  status: "accepted" | "disputed" | "rejected";
  playerDisplayName?: string;
}

export function FinalScoreboard({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const router = useRouter();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const utils = api.useUtils();
  const createRematch = api.game.createRematch.useMutation({
    onSuccess: () => {
      void utils.game.getState.invalidate();
    },
  });

  const answersQuery = api.game.getAllAnswers.useQuery(
    { sessionToken, gameId: game.id },
    { enabled: !!sessionToken, staleTime: 0 },
  );

  const isTurnsMode = game.mode === "turns";

  // Build per-player answer lists from grouped data
  const playerAnswers = new Map<number, PlayerAnswer[]>();
  if (answersQuery.data) {
    for (const group of answersQuery.data.groups) {
      for (const answer of group.answers) {
        if (!playerAnswers.has(answer.playerId)) {
          playerAnswers.set(answer.playerId, []);
        }
        playerAnswers.get(answer.playerId)!.push({
          id: answer.id,
          text: answer.text,
          isCommon: group.isCommon,
          wasDisputed: answer.disputeVotes.length > 0,
          status: answer.status,
          playerDisplayName: answer.player.displayName,
        });
      }
    }
  }

  if (game.isTeamMode) {
    return (
      <TeamScoreboard
        game={game}
        sessionToken={sessionToken}
        playerAnswers={playerAnswers}
        expandedItem={expandedItem}
        setExpandedItem={setExpandedItem}
        createRematch={createRematch}
        router={router}
      />
    );
  }

  const sorted = [...game.players].sort((a, b) => {
    if (isTurnsMode) {
      if (a.isEliminated !== b.isEliminated) {
        return a.isEliminated ? 1 : -1;
      }
      if (a.eliminatedAt && b.eliminatedAt) {
        return new Date(b.eliminatedAt).getTime() - new Date(a.eliminatedAt).getTime();
      }
    }
    return b.score - a.score;
  });
  const topScore = sorted[0]?.score ?? 0;
  const turnsWinner = isTurnsMode
    ? game.players.find((p) => !p.isEliminated)
    : null;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)] sm:justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <h2 className="text-2xl font-bold text-gray-900">final scores</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        {turnsWinner && (
          <div className="w-full rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4 text-center">
            <p className="text-lg font-bold text-gray-900">
              {turnsWinner.displayName} is the last one standing!
            </p>
          </div>
        )}

        <div className="w-full space-y-3">
          {sorted.map((player, i) => {
            const isTop = player.score === topScore && topScore > 0;
            const key = `player-${player.id}`;
            const isExpanded = expandedItem === key;
            const answers = (playerAnswers.get(player.id) ?? []).sort((a, b) =>
              isTurnsMode ? b.id - a.id : 0,
            );

            return (
              <div key={player.id}>
                <button
                  onClick={() =>
                    setExpandedItem(isExpanded ? null : key)
                  }
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition ${
                    isTop
                      ? "border-2 border-yellow-400 bg-yellow-50"
                      : "border border-gray-200 bg-gray-50"
                  } ${isExpanded ? "rounded-b-none" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 text-lg font-bold text-gray-400">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate font-medium text-gray-900">
                      {player.displayName}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
                  <AnswersList
                    answers={answers}
                    isTurnsMode={isTurnsMode}
                    isTop={isTop}
                  />
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

        {game.isHost ? (
          <button
            onClick={() =>
              createRematch.mutate({ sessionToken, gameId: game.id })
            }
            disabled={createRematch.isPending || createRematch.isSuccess}
            className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {createRematch.isPending || createRematch.isSuccess
              ? "starting rematch..."
              : "rematch"}
          </button>
        ) : (
          <p className="text-sm text-gray-500">
            waiting for host to start rematch...
          </p>
        )}

        <button
          onClick={() => router.push(`/game/${game.code}/history`)}
          className="min-h-12 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
        >
          view past rounds
        </button>

        <button
          onClick={() => router.push("/")}
          className="min-h-12 w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          back to home
        </button>

        <button
          onClick={() => router.push(`/game/${game.code}/round/${game.slug}/debug`)}
          className="text-xs text-gray-300 transition hover:text-gray-500"
        >
          debug
        </button>
      </div>
    </main>
  );
}

function TeamScoreboard({
  game,
  sessionToken,
  playerAnswers,
  expandedItem,
  setExpandedItem,
  createRematch,
  router,
}: {
  game: GameState;
  sessionToken: string;
  playerAnswers: Map<number, PlayerAnswer[]>;
  expandedItem: string | null;
  setExpandedItem: (item: string | null) => void;
  createRematch: { mutate: (input: { sessionToken: string; gameId: number }) => void; isPending: boolean; isSuccess: boolean };
  router: ReturnType<typeof useRouter>;
}) {
  // Build team data
  const teamMap = new Map<number, { players: typeof game.players; score: number }>();
  for (const player of game.players) {
    const teamId = player.teamId ?? 0;
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, { players: [], score: 0 });
    }
    teamMap.get(teamId)!.players.push(player);
    teamMap.get(teamId)!.score = player.score; // All team members have the same score
  }

  const teams = Array.from(teamMap.entries())
    .filter(([id]) => id > 0)
    .sort(([, a], [, b]) => b.score - a.score);

  const topTeamScore = teams[0]?.[1].score ?? 0;
  const isSingleTeam = teams.length === 1;

  // Collect all answers for a team
  const getTeamAnswers = (teamPlayers: typeof game.players): PlayerAnswer[] => {
    const all: PlayerAnswer[] = [];
    for (const p of teamPlayers) {
      const pAnswers = playerAnswers.get(p.id) ?? [];
      all.push(...pAnswers);
    }
    return all;
  };

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)] sm:justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <h2 className="text-2xl font-bold text-gray-900">final scores</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        {!isSingleTeam && topTeamScore > 0 && (
          <div className="w-full rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4 text-center">
            <p className="text-lg font-bold text-gray-900">
              team {teams[0]![0]} wins!
            </p>
          </div>
        )}

        <div className="w-full space-y-3">
          {teams.map(([teamId, teamData], i) => {
            const isTop = teamData.score === topTeamScore && topTeamScore > 0;
            const key = `team-${teamId}`;
            const isExpanded = expandedItem === key;
            const teamAnswersList = getTeamAnswers(teamData.players);

            return (
              <div key={teamId}>
                <button
                  onClick={() =>
                    setExpandedItem(isExpanded ? null : key)
                  }
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition ${
                    isTop
                      ? "border-2 border-yellow-400 bg-yellow-50"
                      : "border border-gray-200 bg-gray-50"
                  } ${isExpanded ? "rounded-b-none" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 text-lg font-bold text-gray-400">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate font-medium text-gray-900">
                      team {teamId}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xl font-bold text-gray-900">
                      {teamData.score}
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
                    <p className="mb-2 text-xs text-gray-500">
                      {teamData.players
                        .map((p) => {
                          const count = (playerAnswers.get(p.id) ?? []).filter((a) => a.status === "accepted").length;
                          return `${p.displayName} (${count})`;
                        })
                        .join(", ")}
                    </p>
                    {teamAnswersList.length === 0 ? (
                      <p className="text-sm text-gray-400">no answers</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {teamAnswersList.map((answer, j) => (
                          <li
                            key={j}
                            className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between"
                          >
                            <span
                              className={
                                answer.status === "rejected"
                                  ? "min-w-0 break-words text-gray-400 line-through"
                                  : "min-w-0 break-words text-gray-700"
                              }
                            >
                              {answer.text}
                              {answer.playerDisplayName && (
                                <span className="ml-1 text-xs text-gray-400">
                                  ({answer.playerDisplayName})
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
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

        {game.isHost ? (
          <button
            onClick={() =>
              createRematch.mutate({ sessionToken, gameId: game.id })
            }
            disabled={createRematch.isPending || createRematch.isSuccess}
            className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {createRematch.isPending || createRematch.isSuccess
              ? "starting rematch..."
              : "rematch"}
          </button>
        ) : (
          <p className="text-sm text-gray-500">
            waiting for host to start rematch...
          </p>
        )}

        <button
          onClick={() => router.push(`/game/${game.code}/history`)}
          className="min-h-12 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
        >
          view past rounds
        </button>

        <button
          onClick={() => router.push("/")}
          className="min-h-12 w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          back to home
        </button>

        <button
          onClick={() => router.push(`/game/${game.code}/round/${game.slug}/debug`)}
          className="text-xs text-gray-300 transition hover:text-gray-500"
        >
          debug
        </button>
      </div>
    </main>
  );
}

function AnswersList({
  answers,
  isTurnsMode,
  isTop,
}: {
  answers: PlayerAnswer[];
  isTurnsMode: boolean;
  isTop: boolean;
}) {
  return (
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
              className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between"
            >
              <span
                className={
                  answer.status === "rejected"
                    ? "min-w-0 break-words text-gray-400 line-through"
                    : "min-w-0 break-words text-gray-700"
                }
              >
                {answer.text}
              </span>
              <span className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                {!isTurnsMode && answer.isCommon && (
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
  );
}
