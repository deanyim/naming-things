"use client";

import { useRef, useEffect } from "react";
import { api } from "~/trpc/react";
import { useCountdown } from "~/hooks/use-countdown";
import { AnswerInput } from "./answer-input";
import { MyAnswersList } from "./my-answers-list";
import type { GameState } from "./types";

export function PlayingRound({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const { secondsRemaining, isExpired } = useCountdown(game.endedAt);
  const hasEndedRef = useRef(false);

  const utils = api.useUtils();

  const myAnswers = api.game.getMyAnswers.useQuery(
    { sessionToken, gameId: game.id },
    { refetchInterval: 3000 },
  );

  const submitAnswer = api.game.submitAnswer.useMutation({
    onSuccess: () => utils.game.getMyAnswers.invalidate(),
  });

  const endAnswering = api.game.endAnswering.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  // Host auto-ends when timer expires
  useEffect(() => {
    if (game.isHost && isExpired && !hasEndedRef.current) {
      hasEndedRef.current = true;
      endAnswering.mutate({ sessionToken, gameId: game.id });
    }
  }, [game.isHost, isExpired, sessionToken, game.id, endAnswering]);

  const handleSubmit = (text: string) => {
    submitAnswer.mutate({ sessionToken, gameId: game.id, text });
  };

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

        <AnswerInput onSubmit={handleSubmit} disabled={isExpired} />

        {submitAnswer.error && (
          <p className="text-sm text-red-600">{submitAnswer.error.message}</p>
        )}

        <MyAnswersList answers={myAnswers.data ?? []} />

        {isExpired && !game.isHost && (
          <p className="text-center text-gray-500">
            time's up! waiting for host...
          </p>
        )}
      </div>
    </main>
  );
}
