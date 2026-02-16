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
  const { sessionToken, displayName, login, isReady } = useSession();
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);
  const hasSubmittedRef = useRef(false);
  const hasSpectatedRef = useRef(false);
  const [nameInput, setNameInput] = useState("");

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
      enabled: isReady && !!sessionToken && !!displayName,
      refetchInterval: 2000,
    },
  );

  const submitBatch = api.game.submitAnswersBatch.useMutation();
  const spectate = api.game.spectate.useMutation();

  // Auto-spectate when user is not in the game
  const game = gameState.data;
  useEffect(() => {
    if (
      !game ||
      !game.isSpectator ||
      hasSpectatedRef.current ||
      spectate.isPending
    )
      return;

    // Check if already in spectators list
    const alreadyInGame =
      game.players.some((p) => p.id === game.myPlayerId) ||
      game.spectators.some((s) => s.id === game.myPlayerId);
    if (alreadyInGame) return;

    hasSpectatedRef.current = true;
    spectate.mutate({ sessionToken, code });
  }, [
    game?.isSpectator,
    game?.myPlayerId,
    game?.players,
    game?.spectators,
    sessionToken,
    code,
    spectate,
  ]);

  // Auto-navigate to rematch when rematchCode appears
  useEffect(() => {
    if (game?.rematchCode) {
      router.push(`/game/${game.rematchCode}`);
    }
  }, [game?.rematchCode, router]);

  // Batch-submit local answers when game transitions to reviewing (skip for spectators)
  useEffect(() => {
    if (!game || game.status !== "reviewing" || hasSubmittedRef.current) return;
    if (game.isSpectator) return;

    const localAnswers = loadLocalAnswers(game.id);
    if (!localAnswers) {
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
  }, [game?.status, game?.id, game?.isSpectator, sessionToken, submitBatch]);

  if (!isReady) return null;

  // No display name — show inline name prompt
  if (!displayName) {
    const handleNameSubmit = async () => {
      const name = nameInput.trim();
      if (!name) return;
      await login(name);
    };

    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <p className="text-center text-gray-500">
            enter your name to watch this game
          </p>
          <input
            type="text"
            placeholder="your display name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleNameSubmit();
            }}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
          />
          <button
            onClick={() => void handleNameSubmit()}
            disabled={!nameInput.trim()}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            continue
          </button>
        </div>
      </main>
    );
  }

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
