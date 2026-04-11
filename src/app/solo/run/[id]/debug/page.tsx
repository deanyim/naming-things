"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { AnswerRateChart } from "../../../_components/answer-rate-chart";

const LEGACY_VERSION = "1";

function displayVersion(version: string | null): string {
  if (!version) return "—";
  if (version === LEGACY_VERSION) return "legacy";
  return version;
}

export default function SoloRunDebugPage() {
  const params = useParams();
  const slug = params.id as string;
  const router = useRouter();
  const utils = api.useUtils();
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(
    null,
  );
  const [rerunError, setRerunError] = useState<string | null>(null);

  const data = api.solo.getRunDebug.useQuery(
    { slug },
    { enabled: !!slug },
  );

  const rerunJudging = api.solo.rerunJudging.useMutation({
    onSuccess: async () => {
      setRerunError(null);
      await utils.solo.getRunDebug.invalidate({ slug });
    },
    onError: (err) => {
      setRerunError(err.message);
    },
  });

  if (!data.data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </main>
    );
  }

  const run = data.data;
  const isStale = run.judgeVersion !== run.currentJudgeVersion;
  const rerunDisabled = !isStale || rerunJudging.isPending;

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            solo run debug
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {run.slug} — {run.displayName} — {run.category} ({run.inputCategory}) — {run.timerSeconds}s
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            model: {run.judgeModel ?? "none"} · version: {displayVersion(run.judgeVersion)}
            {isStale ? (
              <span className="ml-1 text-amber-600">
                [stale — current: {run.currentJudgeVersion}]
              </span>
            ) : (
              <span className="ml-1 text-green-600">[up to date]</span>
            )}
            {" · "}score: {run.score} · duration: {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            valid: {run.validCount} · invalid: {run.invalidCount} · ambiguous: {run.ambiguousCount} · category slug: {run.categorySlug}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => rerunJudging.mutate({ slug })}
              disabled={rerunDisabled}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rerunJudging.isPending ? "rerunning…" : "rerun judging"}
            </button>
            {rerunError && (
              <span className="text-xs text-red-600">{rerunError}</span>
            )}
          </div>
        </div>

        <AnswerRateChart
          answers={run.answers}
          startedAt={run.startedAt}
          timerSeconds={run.timerSeconds}
        />

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">id</th>
              <th className="py-2 pr-3">answer</th>
              <th className="py-2 pr-3">normalized</th>
              <th className="py-2 pr-3">label</th>
              <th className="py-2 pr-3">conf</th>
              <th className="py-2 pr-3">dup</th>
              <th className="py-2">reason</th>
            </tr>
          </thead>
          <tbody>
            {run.answers.map((a) => (
              <tr key={a.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-mono text-xs text-gray-400">
                  {a.id}
                </td>
                <td className="py-2 pr-3 font-medium text-gray-900">
                  {a.text}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-400">
                  {a.normalizedText}
                </td>
                <td className="py-2 pr-3">
                  {a.label ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.label === "invalid"
                          ? "bg-red-100 text-red-700"
                          : a.label === "ambiguous"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {a.label}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-500">
                  {a.confidence != null
                    ? `${(a.confidence * 100).toFixed(0)}%`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {a.isDuplicate ? (
                    <span className="text-yellow-600">yes</span>
                  ) : (
                    <span className="text-gray-300">no</span>
                  )}
                </td>
                <td className="py-2 text-xs text-gray-500">
                  {a.reason ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {run.history.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-500">
              previous attempts
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {run.history.map((h) => {
                const expanded = expandedHistoryId === h.id;
                return (
                  <li
                    key={h.id}
                    className="rounded-md border border-gray-200"
                  >
                    <button
                      onClick={() =>
                        setExpandedHistoryId(expanded ? null : h.id)
                      }
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-gray-400">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                        <span>{h.judgeModel ?? "none"}</span>
                        <span className="font-mono text-gray-400">
                          {displayVersion(h.judgeVersion)}
                        </span>
                        <span>
                          score {h.score} ({h.validCount}v/{h.invalidCount}i/
                          {h.ambiguousCount}a)
                        </span>
                      </span>
                      <span className="text-gray-400">
                        {expanded ? "hide" : "show answers"}
                      </span>
                    </button>
                    {expanded && (
                      <table className="w-full border-t border-gray-100 text-left text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                            <th className="px-3 py-1.5">answer</th>
                            <th className="px-3 py-1.5">label</th>
                            <th className="px-3 py-1.5">conf</th>
                            <th className="px-3 py-1.5">reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.answersSnapshot.map((a) => (
                            <tr
                              key={a.answerId}
                              className="border-t border-gray-100"
                            >
                              <td className="px-3 py-1.5 font-medium text-gray-900">
                                {a.text}
                              </td>
                              <td className="px-3 py-1.5">
                                {a.label ? (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                                      a.label === "invalid"
                                        ? "bg-red-100 text-red-700"
                                        : a.label === "ambiguous"
                                          ? "bg-yellow-100 text-yellow-700"
                                          : "bg-green-100 text-green-700"
                                    }`}
                                  >
                                    {a.label}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-gray-500">
                                {a.confidence != null
                                  ? `${(a.confidence * 100).toFixed(0)}%`
                                  : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-gray-500">
                                {a.reason ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <button
          onClick={() => router.push(`/solo/run/${slug}`)}
          className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          back to run
        </button>
      </div>
    </main>
  );
}
