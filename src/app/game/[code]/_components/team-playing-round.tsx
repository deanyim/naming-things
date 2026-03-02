"use client";

import { useRef, useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { useCountdown } from "~/hooks/use-countdown";
import { AnswerInput } from "./answer-input";
import { PauseOverlay } from "./pause-overlay";
import type { GameState } from "./types";

export function TeamPlayingRound({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const { secondsRemaining, isExpired } = useCountdown(game.endedAt);
  const hasEndedRef = useRef(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const utils = api.useUtils();
  const queryInput = { sessionToken, gameId: game.id };

  const teamAnswers = api.game.getTeamAnswers.useQuery(
    queryInput,
    { refetchInterval: 2000 },
  );

  // Find current player for optimistic entries
  const myPlayer = game.players.find((p) => p.id === game.myPlayerId);

  const submitTeamAnswer = api.game.submitTeamAnswer.useMutation({
    onMutate: async ({ text }) => {
      await utils.game.getTeamAnswers.cancel(queryInput);
      const previousData = utils.game.getTeamAnswers.getData(queryInput);
      utils.game.getTeamAnswers.setData(queryInput, (old) => [
        ...(old ?? []),
        {
          id: -Date.now(),
          text,
          normalizedText: text.toLowerCase().trim(),
          playerDisplayName: myPlayer?.displayName ?? "",
          playerId: myPlayer?.id ?? 0,
        },
      ]);
      return { previousData };
    },
    onSuccess: (data, _variables, context) => {
      if (!data.success && data.reason === "duplicate") {
        setDuplicateError("your team already has that answer");
        // Rollback the optimistic entry for duplicates
        if (context?.previousData) {
          utils.game.getTeamAnswers.setData(queryInput, context.previousData);
        }
        return;
      }
      void utils.game.getTeamAnswers.invalidate(queryInput);
    },
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getTeamAnswers.setData(queryInput, context.previousData);
      }
      setDuplicateError(err.message);
    },
  });

  const removeTeamAnswer = api.game.removeTeamAnswer.useMutation({
    onMutate: async ({ answerId }) => {
      await utils.game.getTeamAnswers.cancel(queryInput);
      const previousData = utils.game.getTeamAnswers.getData(queryInput);
      utils.game.getTeamAnswers.setData(queryInput, (old) =>
        (old ?? []).filter((a) => a.id !== answerId),
      );
      return { previousData };
    },
    onSuccess: () => {
      void utils.game.getTeamAnswers.invalidate(queryInput);
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getTeamAnswers.setData(queryInput, context.previousData);
      }
    },
  });

  const endAnswering = api.game.endAnswering.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  const pauseGame = api.game.pauseGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  // Host auto-ends when timer expires
  useEffect(() => {
    if (game.isSpectator || game.isPaused) return;
    if (game.endedAt && new Date(game.endedAt).getTime() > Date.now()) return;
    if (game.isHost && isExpired && !hasEndedRef.current) {
      hasEndedRef.current = true;
      endAnswering.mutate({ sessionToken, gameId: game.id });
    }
  }, [game.isHost, game.isSpectator, game.isPaused, game.endedAt, isExpired, sessionToken, game.id, endAnswering]);

  // Clear duplicate error after 2 seconds
  useEffect(() => {
    if (!duplicateError) return;
    const timer = setTimeout(() => setDuplicateError(null), 2000);
    return () => clearTimeout(timer);
  }, [duplicateError]);

  const handleSubmit = (text: string) => {
    const normalized = text.toLowerCase().trim();
    if (answers.some((a) => a.normalizedText === normalized)) {
      setDuplicateError("your team already has that answer");
      return;
    }
    submitTeamAnswer.mutate({
      sessionToken,
      gameId: game.id,
      text,
    });
  };

  const inputDisabled = isExpired || game.isPaused;
  const isUrgent = secondsRemaining <= 10 && secondsRemaining > 0 && !game.isPaused;

  // When paused, show frozen time from server
  const displaySeconds = game.isPaused && game.pausedTimeRemainingMs != null
    ? Math.ceil(game.pausedTimeRemainingMs / 1000)
    : secondsRemaining;

  const timerDisplay = isExpired && !game.isPaused
    ? "0:00"
    : `${Math.floor(displaySeconds / 60)}:${String(displaySeconds % 60).padStart(2, "0")}`;

  const myTeamId = myPlayer?.teamId;
  const teammates = game.players.filter((p) => p.teamId === myTeamId);

  const answers = teamAnswers.data ?? [];

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{game.category}</h2>
          <div className="flex items-center gap-2">
            {game.isHost && !game.isPaused && !isExpired && (
              <button
                onClick={() => pauseGame.mutate({ sessionToken, gameId: game.id })}
                disabled={pauseGame.isPending}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 disabled:opacity-50"
              >
                pause
              </button>
            )}
            <span
              className={`font-mono text-2xl font-bold ${
                isUrgent ? "text-red-600" : "text-gray-900"
              }`}
            >
              {timerDisplay}
            </span>
          </div>
        </div>

        {/* Team info */}
        {myTeamId && !game.isSpectator && (
          <p className="text-sm text-gray-500">
            team {myTeamId}: {teammates.map((t) => t.displayName).join(", ")}
          </p>
        )}

        {game.isSpectator ? (
          <p className="text-center text-gray-500">
            you are spectating — answers are hidden until review
          </p>
        ) : (
          <>
            <AnswerInput
              onSubmit={handleSubmit}
              disabled={inputDisabled}
              onInputChange={() => setDuplicateError(null)}
            />

            {duplicateError && (
              <p className="text-sm text-red-600">{duplicateError}</p>
            )}

            {answers.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-gray-500">
                  team answers ({answers.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {answers.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={inputDisabled}
                      onClick={() =>
                        removeTeamAnswer.mutate({
                          sessionToken,
                          gameId: game.id,
                          answerId: a.id,
                        })
                      }
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200 disabled:cursor-default disabled:hover:bg-gray-100"
                    >
                      {a.text}
                      <span className="text-xs text-gray-400">
                        ({a.playerDisplayName})
                      </span>
                      {!inputDisabled && (
                        <span className="text-xs text-gray-400">&times;</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isExpired && !game.isHost && (
              <p className="text-center text-gray-500">
                time&apos;s up! waiting for host...
              </p>
            )}
          </>
        )}
      </div>

      <PauseOverlay game={game} sessionToken={sessionToken} />
    </main>
  );
}
