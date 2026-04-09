"use client";

import { api } from "~/trpc/react";
import type { GameState } from "./types";

export function useTimerDisplay(
  deadline: Date | string | null | undefined,
  game: Pick<GameState, "isPaused" | "pausedTimeRemainingMs">,
) {
  const { secondsRemaining, isExpired } = useCountdownImport(deadline);

  const displaySeconds =
    game.isPaused && game.pausedTimeRemainingMs != null
      ? Math.ceil(game.pausedTimeRemainingMs / 1000)
      : secondsRemaining;

  const timerDisplay =
    isExpired && !game.isPaused
      ? "0:00"
      : `${Math.floor(displaySeconds / 60)}:${String(displaySeconds % 60).padStart(2, "0")}`;

  const isUrgent = secondsRemaining <= 10 && secondsRemaining > 0 && !game.isPaused;

  return { secondsRemaining, isExpired, displaySeconds, timerDisplay, isUrgent };
}

// Re-export useCountdown so callers don't need a separate import
import { useCountdown as useCountdownImport } from "~/hooks/use-countdown";

export function RoundHeader({
  game,
  sessionToken,
  timerDisplay,
  isUrgent,
  showPause = true,
  isExpired = false,
}: {
  game: GameState;
  sessionToken: string;
  timerDisplay: string;
  isUrgent: boolean;
  showPause?: boolean;
  isExpired?: boolean;
}) {
  const utils = api.useUtils();
  const pauseGame = api.game.pauseGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  return (
    <div className="flex w-full items-center justify-between">
      <h2 className="text-lg font-bold text-gray-900">{game.category}</h2>
      <div className="flex items-center gap-2">
        {showPause && game.isHost && !game.isPaused && !isExpired && (
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
  );
}
