"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function HomeClient() {
  const router = useRouter();
  const { sessionToken, displayName, setDisplayName, login, isReady } =
    useSession();
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");

  const createGame = api.game.create.useMutation({
    onSuccess: (data) => {
      router.push(`/game/${data.code}`);
    },
    onError: (err) => setError(err.message),
  });

  const joinGame = api.game.join.useMutation({
    onSuccess: (data) => {
      router.push(`/game/${data.code}`);
    },
    onError: (err) => setError(err.message),
  });

  const handleCreate = async () => {
    if (!displayName.trim()) {
      setError("Enter a display name first");
      return;
    }
    setError("");
    await login(displayName.trim());
    createGame.mutate({ sessionToken });
  };

  const handleJoin = async () => {
    if (!displayName.trim()) {
      setError("Enter a display name first");
      return;
    }
    if (!gameCode.trim()) {
      setError("Enter a game code");
      return;
    }
    setError("");
    await login(displayName.trim());
    joinGame.mutate({
      sessionToken,
      code: gameCode.trim().toUpperCase(),
    });
  };

  if (!isReady) return null;

  const isLoading = createGame.isPending || joinGame.isPending;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-10">
        <h1 className="text-4xl font-bold text-gray-900">naming things</h1>

        <p className="text-center text-gray-600">
          compete with your friends to see who can name the most things
        </p>

        <div className="flex w-full flex-col gap-6">
          <input
            type="text"
            placeholder="your display name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              localStorage.setItem(
                "naming-things-display-name",
                e.target.value,
              );
            }}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
          />

          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {createGame.isPending ? "creating..." : "create game"}
          </button>

          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="enter game code"
              value={gameCode}
              onChange={(e) => setGameCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center font-mono text-lg tracking-widest text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
            />
            <button
              onClick={handleJoin}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {joinGame.isPending ? "joining..." : "join game"}
            </button>
          </div>

          {error && (
            <p className="text-center text-sm text-red-600">{error}</p>
          )}
        </div>
      </div>
    </main>
  );
}
