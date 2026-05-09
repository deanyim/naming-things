"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CategorySearch } from "../_components/category-search";
import {
  SoloLeaderboard,
  LeaderboardOverview,
} from "../_components/solo-leaderboard";
import { TIMER_OPTIONS } from "../constants";

export function LeaderboardsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const slugParam = searchParams.get("category") ?? "";
  const timerParam = Number(searchParams.get("timer")) || 60;

  const [category, setCategory] = useState(slugParam.replace(/-/g, " "));
  const [categorySlug, setCategorySlug] = useState(slugParam);
  const [timerSeconds, setTimerSeconds] = useState(timerParam);

  // Sync state when URL search params change (e.g. clicking a leaderboard bucket)
  useEffect(() => {
    if (slugParam) {
      setCategorySlug(slugParam);
      // Temporary display until server resolves the real name
      setCategory(slugParam.replace(/-/g, " "));
    }
    if (searchParams.get("timer")) setTimerSeconds(timerParam);
  }, [slugParam, timerParam, searchParams]);

  // Update display name once server resolves it
  const handleDisplayNameResolved = useCallback((displayName: string) => {
    setCategory(displayName);
  }, []);

  const hasSelection = categorySlug.trim().length > 0;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">leaderboards</h1>
          <p className="text-sm text-gray-500">
            browse solo mode leaderboards
          </p>
        </div>

        <div className="flex w-full flex-col gap-4">
          <CategorySearch
            value={category}
            onChange={(v) => {
              setCategory(v);
              // Clear slug when user types freely — only set it from dropdown selection
              setCategorySlug("");
            }}
            onSlugChange={setCategorySlug}
          />

          <div className="flex flex-col gap-1">
            <span className="text-sm text-gray-500">time limit</span>
            <div className="grid grid-cols-4 gap-2 sm:flex">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimerSeconds(opt.value)}
                  className={`min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
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
        </div>

        {hasSelection ? (
          <SoloLeaderboard
            categorySlug={categorySlug.trim().toLowerCase()}
            timerSeconds={timerSeconds}
            limit={20}
            onDisplayNameResolved={handleDisplayNameResolved}
          />
        ) : (
          <LeaderboardOverview limit={10} />
        )}

        <div className="flex w-full flex-col gap-2">
          <button
            onClick={() => router.push(hasSelection ? `/solo?category=${encodeURIComponent(category.trim())}&timer=${timerSeconds}` : "/solo")}
            className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800"
          >
            start a solo run
          </button>
          <button
            onClick={() => router.push("/")}
            className="min-h-10 text-sm text-gray-400 transition hover:text-gray-600"
          >
            back to home
          </button>
        </div>
      </div>
    </main>
  );
}
