"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { Lobby } from "./lobby";
import { PlayingRound } from "./playing-round";
import { ReviewPhase } from "./review-phase";
import { FinalScoreboard } from "./final-scoreboard";

export function GameClient({ code }: { code: string }) {
  const router = useRouter();
  const { sessionToken, displayName, login, isReady } = useSession();

  // Auto-login on mount if we have a saved display name
  const ensureSession = api.player.ensureSession.useMutation();
  useEffect(() => {
    if (isReady && sessionToken && displayName) {
      ensureSession.mutate({ sessionToken, displayName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, sessionToken, displayName]);

  const gameState = api.game.getState.useQuery(
    { sessionToken, code },
    {
      enabled: isReady && !!sessionToken,
      refetchInterval: 2000,
    },
  );

  if (!isReady) return null;

  if (gameState.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-500">loading...</p>
      </main>
    );
  }

  if (gameState.error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-4">
        <p className="text-red-600">{gameState.error.message}</p>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg border border-gray-900 px-4 py-2 text-gray-900 hover:bg-gray-100"
        >
          back to home
        </button>
      </main>
    );
  }

  const game = gameState.data;
  if (!game) return null;

  return (
    <>
      {game.status === "lobby" && (
        <Lobby game={game} sessionToken={sessionToken} />
      )}
      {game.status === "playing" && (
        <PlayingRound game={game} sessionToken={sessionToken} />
      )}
      {game.status === "reviewing" && (
        <ReviewPhase game={game} sessionToken={sessionToken} />
      )}
      {game.status === "finished" && (
        <FinalScoreboard game={game} />
      )}
    </>
  );
}
