"use client";

import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export default function SoloRunDebugPage() {
  const params = useParams();
  const slug = params.id as string;
  const router = useRouter();

  const data = api.solo.getRunDebug.useQuery(
    { slug },
    { enabled: !!slug },
  );

  if (!data.data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </main>
    );
  }

  const run = data.data;

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
            model: {run.judgeModel ?? "none"} · version: {run.judgeVersion ?? "—"} · score: {run.score} · duration: {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            valid: {run.validCount} · invalid: {run.invalidCount} · ambiguous: {run.ambiguousCount} · category slug: {run.categorySlug}
          </p>
        </div>

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
