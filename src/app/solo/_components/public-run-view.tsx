"use client";

import { useRouter } from "next/navigation";
import { SoloLeaderboard } from "./solo-leaderboard";
import { LabelBadge } from "./label-badge";
import { ScoreSummary } from "./score-summary";

type PublicRun = {
  slug: string;
  displayName: string;
  categoryDisplayName: string;
  categorySlug: string;
  timerSeconds: number;
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  answers: {
    id: number;
    text: string;
    label: string | null;
    isDuplicate: boolean;
  }[];
};

export function PublicRunView({ run }: { run: PublicRun }) {
  const router = useRouter();
  const nonDuplicateAnswers = run.answers.filter((a) => !a.isDuplicate);

  return (
    <div className="flex min-h-dvh flex-col items-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">
            {run.displayName}&apos;s run
          </h1>
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

        <div className="w-full">
          <h3 className="mb-2 text-sm font-medium text-gray-500">answers</h3>
          <div className="flex flex-col gap-1">
            {nonDuplicateAnswers.map((answer) => (
              <div
                key={answer.id}
                className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 ${
                  answer.label === "invalid"
                    ? "bg-red-50"
                    : answer.label === "ambiguous"
                      ? "bg-yellow-50"
                      : "bg-gray-50"
                }`}
              >
                <span
                  className={`min-w-0 break-words text-sm ${
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
            onClick={() => router.push(`/solo?category=${encodeURIComponent(run.categoryDisplayName)}`)}
            className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800"
          >
            play this category
          </button>
          <button
            onClick={() => router.push("/solo/leaderboards")}
            className="min-h-12 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
          >
            view all leaderboards
          </button>

          <button
            onClick={() => router.push(`/solo/run/${run.slug}/debug`)}
            className="text-xs text-gray-300 transition hover:text-gray-500"
          >
            debug
          </button>
        </div>
      </div>
    </div>
  );
}
