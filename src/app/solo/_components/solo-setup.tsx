"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { CategorySearch } from "./category-search";
import { LeaderboardOverview } from "./solo-leaderboard";
import { TIMER_OPTIONS, ALLOWED_TIMERS } from "../constants";

export function SoloSetup({
  initialCategory = "",
  initialTimer,
}: {
  initialCategory?: string;
  initialTimer?: number;
}) {
  const router = useRouter();
  const { sessionToken, displayName, setDisplayName, login, isReady } =
    useSession();
  const [category, setCategory] = useState(initialCategory);
  const [timerSeconds, setTimerSeconds] = useState(
    initialTimer && ALLOWED_TIMERS.includes(initialTimer) ? initialTimer : 60,
  );
  const [error, setError] = useState("");

  const randomCategory = api.solo.getRandomCategory.useQuery(undefined, {
    enabled: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (randomCategory.data) {
      setCategory(randomCategory.data.categoryDisplayName);
    }
  }, [randomCategory.data]);

  const createRun = api.solo.createRun.useMutation({
    onSuccess: (data) => {
      router.push(`/solo/run/${data.slug}`);
    },
    onError: (err) => setError(err.message),
  });

  const handleStart = async () => {
    if (!displayName.trim()) {
      setError("Enter a display name first");
      return;
    }
    if (!category.trim()) {
      setError("Enter a category");
      return;
    }
    setError("");
    await login(displayName.trim());
    createRun.mutate({
      sessionToken,
      category: category.trim(),
      timerSeconds,
    });
  };

  if (!isReady) return null;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-bold text-gray-900">solo mode</h1>
        <p className="text-center text-gray-500">
          name as many things as you can before time runs out
        </p>
      </div>

      <div className="flex w-full flex-col gap-4">
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

        <div className="flex w-full gap-2">
          <div className="flex-1">
            <CategorySearch value={category} onChange={setCategory} />
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              randomCategory.refetch();
            }}
            disabled={randomCategory.isFetching}
            className="shrink-0 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            random
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-gray-500">time limit</span>
          <div className="flex gap-2">
            {TIMER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimerSeconds(opt.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  timerSeconds === opt.value
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={createRun.isPending}
          className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {createRun.isPending ? "starting..." : "start run"}
        </button>

        {error && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}
      </div>

      <LeaderboardOverview limit={5} />

      <button
        onClick={() => router.push("/solo/leaderboards")}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
      >
        view all leaderboards
      </button>

      <button
        onClick={() => router.push("/")}
        className="text-sm text-gray-400 transition hover:text-gray-600"
      >
        back to home
      </button>
    </div>
  );
}
