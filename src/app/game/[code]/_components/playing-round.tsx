"use client";

import { useRef, useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { useLocalAnswers } from "~/hooks/use-local-answers";
import { AnswerInput } from "./answer-input";
import { PauseOverlay } from "./pause-overlay";
import { RoundHeader, useTimerDisplay } from "./round-header";
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
  const { isExpired, timerDisplay, isUrgent } = useTimerDisplay(game.endedAt, game);
  const hasEndedRef = useRef(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const utils = api.useUtils();
  const { answers, addAnswer, removeAnswer } = useLocalAnswers(game.id);

  const endAnswering = api.game.endAnswering.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  // Host auto-ends when timer expires
  useEffect(() => {
    if (disabled || game.isSpectator || game.isPaused) return;
    if (game.endedAt && new Date(game.endedAt).getTime() > Date.now()) return;
    if (game.isHost && isExpired && !hasEndedRef.current) {
      hasEndedRef.current = true;
      endAnswering.mutate({ sessionToken, gameId: game.id });
    }
  }, [disabled, game.isHost, game.isSpectator, game.isPaused, game.endedAt, isExpired, sessionToken, game.id, endAnswering]);

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

  const inputDisabled = isExpired || !!disabled || game.isPaused;

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <RoundHeader
          game={game}
          sessionToken={sessionToken}
          timerDisplay={timerDisplay}
          isUrgent={isUrgent}
          isExpired={isExpired}
        />

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
                  your answers ({answers.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {answers.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={inputDisabled}
                      onClick={() => removeAnswer(i)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200 disabled:cursor-default disabled:hover:bg-gray-100"
                    >
                      {a.text}
                      {!inputDisabled && (
                        <span className="text-xs text-gray-400">&times;</span>
                      )}
                    </button>
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
          </>
        )}
      </div>

      <PauseOverlay game={game} sessionToken={sessionToken} />
    </main>
  );
}
