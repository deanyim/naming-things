"use client";

import { useRef, useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { useCountdown } from "~/hooks/use-countdown";
import { AnswerInput } from "./answer-input";
import type { GameState } from "./types";

export function TurnsRound({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const { secondsRemaining, isExpired } = useCountdown(game.currentTurnDeadline);
  const lastTimeoutTurnIdRef = useRef<number | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const utils = api.useUtils();

  const submitTurnAnswer = api.game.submitTurnAnswer.useMutation({
    onSuccess: (result) => {
      void utils.game.getState.invalidate();
      if (!result.success && result.reason === "duplicate") {
        setDuplicateError("already used — you're eliminated!");
      }
    },
    onError: (err) => {
      setDuplicateError(err.message);
    },
  });

  const timeoutTurn = api.game.timeoutTurn.useMutation({
    onSuccess: () => void utils.game.getState.invalidate(),
  });

  // Timeout enforcement: when deadline passes, any client calls timeoutTurn
  useEffect(() => {
    if (game.isSpectator) return;
    if (!isExpired || !game.currentTurnPlayerId) return;
    if (lastTimeoutTurnIdRef.current === game.currentTurnPlayerId) return;

    lastTimeoutTurnIdRef.current = game.currentTurnPlayerId;
    timeoutTurn.mutate({ sessionToken, gameId: game.id });
  }, [isExpired, game.currentTurnPlayerId, game.isSpectator, sessionToken, game.id, timeoutTurn]);

  // Clear duplicate error after 3 seconds
  useEffect(() => {
    if (!duplicateError) return;
    const timer = setTimeout(() => setDuplicateError(null), 3000);
    return () => clearTimeout(timer);
  }, [duplicateError]);

  const isMyTurn = game.currentTurnPlayerId === game.myPlayerId;
  const currentPlayer = game.players.find(
    (p) => p.id === game.currentTurnPlayerId,
  );
  const myPlayer = game.players.find((p) => p.id === game.myPlayerId);
  const isEliminated = myPlayer?.isEliminated ?? false;

  const handleSubmit = (text: string) => {
    setDuplicateError(null);
    submitTurnAnswer.mutate({
      sessionToken,
      gameId: game.id,
      text: text.trim(),
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{game.category}</h2>
          <span
            className={`font-mono text-2xl font-bold ${
              secondsRemaining <= 2 && secondsRemaining > 0
                ? "text-red-600"
                : "text-gray-900"
            }`}
          >
            {secondsRemaining}s
          </span>
        </div>

        {/* Player list with alive/eliminated status */}
        <div className="w-full space-y-1">
          {game.players.map((player) => (
            <div
              key={player.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                player.id === game.currentTurnPlayerId
                  ? "bg-gray-100 font-medium"
                  : ""
              } ${player.isEliminated ? "opacity-40 line-through" : ""}`}
            >
              <span className="text-gray-900">
                {player.displayName}
                {player.id === game.currentTurnPlayerId && !player.isEliminated
                  ? " \u2190"
                  : ""}
              </span>
              <span className="text-gray-500">{player.score}</span>
            </div>
          ))}
        </div>

        {/* Turn status */}
        {game.isSpectator ? (
          <p className="text-center text-gray-500">
            you are spectating
          </p>
        ) : isEliminated ? (
          <p className="text-center text-gray-500">
            you've been eliminated — watching the rest
          </p>
        ) : isMyTurn ? (
          <div className="flex w-full flex-col gap-3">
            <p className="text-center font-medium text-gray-900">
              your turn!
            </p>
            <AnswerInput
              onSubmit={handleSubmit}
              disabled={submitTurnAnswer.isPending || isExpired}
              onInputChange={() => setDuplicateError(null)}
            />
            {duplicateError && (
              <p className="text-center text-sm text-red-600">
                {duplicateError}
              </p>
            )}
          </div>
        ) : (
          <p className="text-center text-gray-500">
            {currentPlayer
              ? `${currentPlayer.displayName} is thinking...`
              : "waiting..."}
          </p>
        )}

        {/* Answer history */}
        {game.turnsHistory && game.turnsHistory.length > 0 && (
          <div className="w-full">
            <p className="mb-2 text-sm text-gray-500">
              answers ({game.turnsHistory.length})
            </p>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {game.turnsHistory.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-700">{entry.text}</span>
                  <span className="text-gray-400">
                    {entry.playerDisplayName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
