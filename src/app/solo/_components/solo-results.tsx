"use client";

import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { SoloLeaderboard } from "./solo-leaderboard";
import { LabelBadge } from "./label-badge";
import { ScoreSummary } from "./score-summary";

const SUGGESTED_CATEGORIES = [
  "fruits", "countries", "animals", "colors", "movies",
  "sports", "vegetables", "cities", "songs", "books",
  "board games", "dog breeds", "pizza toppings", "superheroes",
];

export function SoloResults({ slug }: { slug: string }) {
  const router = useRouter();
  const { sessionToken } = useSession();

  const runQuery = api.solo.getRun.useQuery(
    { sessionToken, slug },
    { enabled: !!sessionToken },
  );

  const run = runQuery.data;

  const myBest = api.solo.getMyBest.useQuery(
    {
      sessionToken,
      categorySlug: run?.categorySlug ?? "",
      timerSeconds: run?.timerSeconds ?? 60,
    },
    { enabled: !!sessionToken && !!run },
  );

  if (!run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-400">loading...</p>
      </div>
    );
  }

  const nonDuplicateAnswers = run.answers.filter((a) => !a.isDuplicate);
  const otherCategories = SUGGESTED_CATEGORIES
    .filter((c) => c !== run.categoryDisplayName)
    .sort((a, b) => {
      const ha = ((a.charCodeAt(0) + run.id) * 31) % 1000;
      const hb = ((b.charCodeAt(0) + run.id) * 31) % 1000;
      return ha - hb;
    })
    .slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">results</h1>
          <p className="text-gray-500">{run.categoryDisplayName}</p>
          <p className="text-xs text-gray-400">
            {run.timerSeconds}s time limit
          </p>
        </div>

        <ScoreSummary
          score={run.score}
          validCount={run.validCount}
          invalidCount={run.invalidCount}
          ambiguousCount={run.ambiguousCount}
        />

        {myBest.data && (
          <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center">
            <p className="text-sm text-gray-500">
              your best: <span className="font-bold text-gray-900">{myBest.data.score}</span>
              {" "}· rank{" "}
              <span className="font-bold text-gray-900">#{myBest.data.rank}</span>
            </p>
          </div>
        )}

        <div className="w-full">
          <h3 className="mb-2 text-sm font-medium text-gray-500">
            your answers
          </h3>
          <div className="flex flex-col gap-1">
            {nonDuplicateAnswers.map((answer) => (
              <div
                key={answer.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  answer.label === "invalid"
                    ? "bg-red-50"
                    : answer.label === "ambiguous"
                      ? "bg-yellow-50"
                      : "bg-gray-50"
                }`}
              >
                <span
                  className={`text-sm ${
                    answer.label === "invalid"
                      ? "text-gray-400 line-through"
                      : "text-gray-900"
                  }`}
                >
                  {answer.text}
                </span>
                <LabelBadge label={answer.label} />
              </div>
            ))}
          </div>
        </div>

        <SoloLeaderboard
          categorySlug={run.categorySlug}
          timerSeconds={run.timerSeconds}
          limit={10}
        />

        <div className="flex w-full flex-col gap-2">
          <button
            onClick={() => router.push(`/solo?category=${encodeURIComponent(run.categoryDisplayName)}&timer=${run.timerSeconds}`)}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800"
          >
            play again
          </button>

          {otherCategories.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-center text-xs text-gray-400">
                try another category
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                {otherCategories.map((c) => (
                  <button
                    key={c}
                    onClick={() =>
                      router.push(`/solo?category=${encodeURIComponent(c)}`)
                    }
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => router.push("/solo/leaderboards")}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
          >
            view all leaderboards
          </button>

          <button
            onClick={() => router.push(`/solo/run/${slug}/debug`)}
            className="text-xs text-gray-300 transition hover:text-gray-500"
          >
            debug
          </button>
        </div>
      </div>
    </div>
  );
}
