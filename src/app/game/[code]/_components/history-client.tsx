"use client";

import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function HistoryClient({ code }: { code: string }) {
  const router = useRouter();
  const { sessionToken, isReady } = useSession();

  const history = api.game.getHistory.useQuery(
    { sessionToken, code },
    { enabled: isReady && !!sessionToken },
  );

  if (!isReady || !history.data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-white px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </main>
    );
  }

  const rounds = history.data;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h2 className="text-2xl font-bold text-gray-900">game history</h2>
        <p className="text-sm text-gray-500">code: {code}</p>

        {rounds.length === 0 ? (
          <p className="text-gray-400">no rounds played yet</p>
        ) : (
          <div className="w-full space-y-3">
            {rounds.map((round, i) => {
              const isLatest = i === 0;
              const winner = round.players.reduce(
                (best, p) => (p.score > best.score ? p : best),
                round.players[0]!,
              );
              const dateStr = round.endedAt
                ? new Date(round.endedAt).toLocaleDateString()
                : round.startedAt
                  ? "in progress"
                  : "not started";

              return (
                <button
                  key={round.id}
                  onClick={() =>
                    router.push(
                      isLatest
                        ? `/game/${code}`
                        : `/game/${code}/round/${round.slug}`,
                    )
                  }
                  className={`flex min-h-20 w-full flex-col gap-1 rounded-lg border p-4 text-left transition hover:bg-gray-50 ${
                    isLatest
                      ? "border-gray-900"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words font-medium text-gray-900">
                      {round.category ?? "no topic"}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{dateStr}</span>
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-gray-500 sm:flex-row sm:items-start sm:justify-between">
                    <span className="min-w-0">
                      {round.playerCount} player{round.playerCount !== 1 ? "s" : ""}
                      {" · "}
                      {round.mode === "classic" ? "classic" : "last one standing"}
                    </span>
                    {round.status === "finished" && winner && (
                      <span className="break-words text-gray-700 sm:text-right">
                        {winner.displayName} ({winner.score})
                      </span>
                    )}
                  </div>
                  {isLatest && (
                    <span className="mt-1 text-xs text-gray-400">current</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => router.push(`/game/${code}`)}
          className="min-h-12 w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          back to game
        </button>
      </div>
    </main>
  );
}
