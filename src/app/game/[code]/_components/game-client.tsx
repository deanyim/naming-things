"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { Lobby } from "./lobby";
import { PlayingRound } from "./playing-round";
import { ReviewPhase } from "./review-phase";
import { FinalScoreboard } from "./final-scoreboard";

function loadLocalAnswers(gameId: number): { text: string }[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`naming-things-answers-${gameId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text: string }[];
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function clearLocalAnswers(gameId: number) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`naming-things-answers-${gameId}`);
}

export function GameClient({ code }: { code: string }) {
  const router = useRouter();
  const { sessionToken, displayName, isReady } = useSession();
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);
  const hasSubmittedRef = useRef(false);

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

  const submitBatch = api.game.submitAnswersBatch.useMutation();

  // Batch-submit local answers when game transitions to reviewing
  const game = gameState.data;
  useEffect(() => {
    if (!game || game.status !== "reviewing" || hasSubmittedRef.current) return;

    const localAnswers = loadLocalAnswers(game.id);
    if (!localAnswers) {
      // Nothing to submit
      return;
    }

    hasSubmittedRef.current = true;
    setIsSubmittingAnswers(true);

    submitBatch
      .mutateAsync({
        sessionToken,
        gameId: game.id,
        answers: localAnswers.map((a) => ({ text: a.text })),
      })
      .then(() => {
        clearLocalAnswers(game.id);
      })
      .catch((err) => {
        console.error("Failed to submit answers batch:", err);
      })
      .finally(() => {
        setIsSubmittingAnswers(false);
      });
  }, [game?.status, game?.id, sessionToken, submitBatch]);

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

  if (!game) return null;

  return (
    <>
      {game.status === "lobby" && (
        <Lobby game={game} sessionToken={sessionToken} />
      )}
      {game.status === "playing" && (
        <PlayingRound game={game} sessionToken={sessionToken} />
      )}
      {game.status === "reviewing" && isSubmittingAnswers && (
        <PlayingRound game={game} sessionToken={sessionToken} disabled />
      )}
      {game.status === "reviewing" && !isSubmittingAnswers && (
        <ReviewPhase game={game} sessionToken={sessionToken} />
      )}
      {game.status === "finished" && (
        <FinalScoreboard game={game} sessionToken={sessionToken} />
      )}
    </>
  );
}
