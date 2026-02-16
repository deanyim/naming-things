"use client";

import { useRef, useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { useCountdown } from "~/hooks/use-countdown";
import { useLocalAnswers } from "~/hooks/use-local-answers";
import { AnswerInput } from "./answer-input";
import type { GameState } from "./types";

export function PlayingRound({
  game,
  sessionToken,
  disabled,
}: {
  game: GameState;
  sessionToken: string;
  disabled?: boolean;
}) {
  const { secondsRemaining, isExpired } = useCountdown(game.endedAt);
  const hasEndedRef = useRef(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const utils = api.useUtils();
  const { answers, addAnswer } = useLocalAnswers(game.id);

  const endAnswering = api.game.endAnswering.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  // Host auto-ends when timer expires (skip if disabled — means we're already in reviewing)
  useEffect(() => {
    if (disabled) return;
    if (game.isHost && isExpired && !hasEndedRef.current) {
      hasEndedRef.current = true;
      endAnswering.mutate({ sessionToken, gameId: game.id });
    }
  }, [disabled, game.isHost, isExpired, sessionToken, game.id, endAnswering]);

  // Clear duplicate error after 2 seconds
  useEffect(() => {
    if (!duplicateError) return;
    const timer = setTimeout(() => setDuplicateError(null), 2000);
    return () => clearTimeout(timer);
  }, [duplicateError]);

  const handleSubmit = (text: string) => {
    const added = addAnswer(text);
    if (!added) {
      setDuplicateError("you already have that answer");
    }
  };

  const inputDisabled = isExpired || !!disabled;
  const isUrgent = secondsRemaining <= 10 && secondsRemaining > 0;

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{game.category}</h2>
          <span
            className={`font-mono text-2xl font-bold ${
              isUrgent ? "text-red-600" : "text-gray-900"
            }`}
          >
            {isExpired ? "0:00" : `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}
          </span>
        </div>

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
              your answers ({answers.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {answers.map((a, i) => (
                <span
                  key={i}
                  className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                >
                  {a.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {isExpired && !game.isHost && !disabled && (
          <p className="text-center text-gray-500">
            time's up! waiting for host...
          </p>
        )}

        {disabled && (
          <p className="text-center text-gray-500">
            submitting answers...
          </p>
        )}
      </div>
    </main>
  );
}
