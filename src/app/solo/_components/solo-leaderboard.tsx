"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function SoloLeaderboard({
  categorySlug,
  timerSeconds,
  limit = 10,
  compact = false,
  onDisplayNameResolved,
}: {
  categorySlug: string;
  timerSeconds: number;
  limit?: number;
  compact?: boolean;
  onDisplayNameResolved?: (displayName: string) => void;
}) {
  const router = useRouter();
  const leaderboard = api.solo.getLeaderboard.useQuery({
    categorySlug,
    timerSeconds,
    limit,
  });

  // Resolve display name from first result
  useEffect(() => {
    if (leaderboard.data?.[0]?.categoryDisplayName && onDisplayNameResolved) {
      onDisplayNameResolved(leaderboard.data[0].categoryDisplayName);
    }
  }, [leaderboard.data, onDisplayNameResolved]);

  if (leaderboard.isLoading) {
    return <p className="text-center text-sm text-gray-400">loading...</p>;
  }

  if (!leaderboard.data || leaderboard.data.length === 0) {
    return (
      <p className="text-center text-sm text-gray-400">
        no entries yet — be the first!
      </p>
    );
  }

  return (
    <div className="w-full">
      {!compact && (
        <h3 className="mb-3 text-sm font-medium text-gray-500">
          leaderboard
        </h3>
      )}
      <div className="flex flex-col gap-1">
        {leaderboard.data.map((entry, i) => (
          <button
            key={entry.id}
            onClick={() => router.push(`/solo/run/${entry.slug}`)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 transition hover:opacity-80 ${
              i === 0
                ? "border border-yellow-400 bg-yellow-50"
                : "bg-gray-50 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="w-6 text-right text-sm font-medium text-gray-400">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-gray-900">
                {entry.displayName}
                {entry.attempt > 1 && (
                  <span className="ml-1 text-xs text-gray-400">
                    (attempt {entry.attempt})
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {formatDuration(entry.durationMs)}
              </span>
              <span className="text-sm font-bold text-gray-900">
                {entry.score}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LeaderboardOverview({
  limit = 10,
}: {
  limit?: number;
}) {
  const [page, setPage] = useState(0);
  const router = useRouter();
  const overview = api.solo.getLeaderboardOverview.useQuery({
    limit,
    offset: page * limit,
  });

  if (overview.isLoading) {
    return <p className="text-center text-sm text-gray-400">loading...</p>;
  }

  if (!overview.data || overview.data.length === 0) {
    if (page === 0) return null;
    return (
      <div className="w-full">
        <h3 className="mb-3 text-sm font-medium text-gray-500">
          popular categories
        </h3>
        <p className="mb-3 text-center text-sm text-gray-400">
          no more categories
        </p>
        <button
          onClick={() => setPage(page - 1)}
          className="w-full text-center text-sm text-gray-400 transition hover:text-gray-600"
        >
          previous
        </button>
      </div>
    );
  }

  const hasMore = overview.data.length === limit;

  return (
    <div className="w-full">
      <h3 className="mb-3 text-sm font-medium text-gray-500">
        popular categories
      </h3>
      <div className="flex flex-col gap-1">
        {overview.data.map((bucket) => (
          <button
            key={`${bucket.categorySlug}-${bucket.timerSeconds}`}
            onClick={() =>
              router.push(
                `/solo/leaderboards?category=${bucket.categorySlug}&timer=${bucket.timerSeconds}`,
              )
            }
            className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 transition hover:bg-gray-100"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {bucket.categoryDisplayName}
              </span>
              <span className="text-xs text-gray-400">
                {bucket.timerSeconds}s
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                {bucket.runCount} {bucket.runCount === 1 ? "run" : "runs"}
              </span>
              <span className="text-sm font-medium text-gray-700">
                best: {bucket.topScore}
              </span>
            </div>
          </button>
        ))}
      </div>
      {(page > 0 || hasMore) && (
        <div className="mt-3 flex justify-between">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page === 0}
            className="text-sm text-gray-400 transition hover:text-gray-600 disabled:invisible"
          >
            previous
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={!hasMore}
            className="text-sm text-gray-400 transition hover:text-gray-600 disabled:invisible"
          >
            next
          </button>
        </div>
      )}
    </div>
  );
}
