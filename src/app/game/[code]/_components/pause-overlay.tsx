"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import type { GameState } from "./types";

export function PauseOverlay({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const utils = api.useUtils();

  const resumeGame = api.game.resumeGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  const terminateGame = api.game.terminateGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  if (!game.isPaused) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl bg-white p-8">
        <h2 className="text-2xl font-bold text-gray-900">game paused</h2>

        {game.isHost ? (
          <div className="flex w-full flex-col gap-3">
            <button
              onClick={() => resumeGame.mutate({ sessionToken, gameId: game.id })}
              disabled={resumeGame.isPending}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {resumeGame.isPending ? "resuming..." : "resume"}
            </button>

            {confirmEnd ? (
              <div className="flex w-full flex-col gap-2">
                <p className="text-center text-sm text-gray-500">
                  are you sure? this will end the game immediately.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmEnd(false)}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-100"
                  >
                    cancel
                  </button>
                  <button
                    onClick={() =>
                      terminateGame.mutate({ sessionToken, gameId: game.id })
                    }
                    disabled={terminateGame.isPending}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {terminateGame.isPending ? "ending..." : "end game"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmEnd(true)}
                className="w-full rounded-lg border border-red-300 px-4 py-3 font-medium text-red-600 transition hover:bg-red-50"
              >
                end game
              </button>
            )}
          </div>
        ) : (
          <p className="text-center text-gray-500">
            waiting for host to resume...
          </p>
        )}
      </div>
    </div>
  );
}
