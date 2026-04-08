"use client";

import { useRouter } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function DebugClient({ code, slug }: { code: string; slug: string }) {
  const router = useRouter();
  const { sessionToken, isReady } = useSession();

  const data = api.game.getVerifications.useQuery(
    { sessionToken, slug },
    { enabled: isReady && !!sessionToken },
  );

  if (!isReady || !data.data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </main>
    );
  }

  const { category, model, answers } = data.data;

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">verification debug</h2>
          <p className="mt-1 text-sm text-gray-500">
            {code} / {slug} — {category ?? "no topic"} — model: {model}
          </p>
        </div>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">answer</th>
              <th className="py-2 pr-3">player</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">label</th>
              <th className="py-2 pr-3">conf</th>
              <th className="py-2">reason</th>
            </tr>
          </thead>
          <tbody>
            {answers.map((a) => (
              <tr key={a.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-medium text-gray-900">
                  {a.text}
                  {a.normalizedText !== a.text.toLowerCase() && (
                    <span className="ml-1 text-xs text-gray-400">
                      ({a.normalizedText})
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">{a.player}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      a.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : a.status === "disputed"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {a.verification ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.verification.label === "invalid"
                          ? "bg-red-100 text-red-700"
                          : a.verification.label === "ambiguous"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {a.verification.label}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">
                  {a.verification?.confidence ?? "—"}
                </td>
                <td className="py-2 text-xs text-gray-500">
                  {a.verification?.reason ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          onClick={() => router.push(`/game/${code}/round/${slug}`)}
          className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100"
        >
          back to game
        </button>
      </div>
    </main>
  );
}
