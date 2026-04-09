"use client";

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
}: {
  categorySlug: string;
  timerSeconds: number;
  limit?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const leaderboard = api.solo.getLeaderboard.useQuery({
    categorySlug,
    timerSeconds,
    limit,
  });

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
  const router = useRouter();
  const overview = api.solo.getLeaderboardOverview.useQuery({ limit });

  if (overview.isLoading) {
    return <p className="text-center text-sm text-gray-400">loading...</p>;
  }

  if (!overview.data || overview.data.length === 0) {
    return null;
  }

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
                `/solo/leaderboards?category=${encodeURIComponent(bucket.categoryDisplayName)}&slug=${bucket.categorySlug}&timer=${bucket.timerSeconds}`,
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
    </div>
  );
}
