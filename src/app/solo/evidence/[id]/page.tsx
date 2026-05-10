"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { api } from "~/trpc/react";

export default function EvidencePacketDebugPage() {
  const params = useParams();
  const id = params.id as string;
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [queriesExpanded, setQueriesExpanded] = useState(false);

  const { data: packet, isLoading } = api.solo.getEvidencePacket.useQuery(
    { id },
    { enabled: !!id },
  );

  if (isLoading || !packet) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            evidence packet
          </h2>
          <p className="mt-1 font-mono text-sm text-gray-500">{packet.id}</p>
        </div>

        <div className="rounded-md border border-gray-200 p-4 text-sm">
          <div className="flex flex-col gap-1 text-xs text-gray-600">
            <p>
              <span className="font-medium text-gray-900">category:</span>{" "}
              {packet.category}
            </p>
            <p>
              <span className="font-medium text-gray-900">normalized:</span>{" "}
              {packet.normalizedCategory}
            </p>
            <p>
              <span className="font-medium text-gray-900">kind:</span>{" "}
              {packet.kind}
            </p>
            <p>
              <span className="font-medium text-gray-900">status:</span>{" "}
              <span
                className={
                  packet.status === "ready"
                    ? "text-green-600"
                    : packet.status === "retrieval_failed"
                      ? "text-red-600"
                      : "text-yellow-600"
                }
              >
                {packet.status}
              </span>
            </p>
            <p>
              <span className="font-medium text-gray-900">model:</span>{" "}
              {packet.model}
            </p>
            <p>
              <span className="font-medium text-gray-900">search provider:</span>{" "}
              {packet.searchProvider}
            </p>
            <p>
              <span className="font-medium text-gray-900">retrieved:</span>{" "}
              {new Date(packet.retrievedAt).toLocaleString()}
            </p>
            <p>
              <span className="font-medium text-gray-900">latency:</span>{" "}
              {packet.latencyMs != null
                ? `${(packet.latencyMs / 1000).toFixed(1)}s`
                : "—"}
            </p>
            <p>
              <span className="font-medium text-gray-900">expires:</span>{" "}
              {packet.expiresAt
                ? new Date(packet.expiresAt).toLocaleString()
                : "never"}
            </p>
            {packet.error && (
              <p className="text-red-600">
                <span className="font-medium">error:</span> {packet.error}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border border-gray-200 p-4">
          <button
            onClick={() => setQueriesExpanded(!queriesExpanded)}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {queriesExpanded ? "hide" : "show"} queries ({packet.queryLog.length})
          </button>
          {queriesExpanded && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-gray-600">
              {packet.queryLog.map((q, i) => (
                <li key={i} className="rounded border border-gray-100 px-2 py-1 font-mono">
                  {q}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-gray-200 p-4">
          <button
            onClick={() => setSourcesExpanded(!sourcesExpanded)}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {sourcesExpanded ? "hide" : "show"} sources ({packet.sources.length})
          </button>
          {sourcesExpanded && packet.sources.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2 text-xs text-gray-600">
              {packet.sources.map((source) => (
                <li
                  key={source.id}
                  className="rounded border border-gray-100 px-3 py-2"
                >
                  <a
                    className="font-medium text-gray-900 underline"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>
                  <span className="ml-1 text-gray-400">
                    [{source.sourceType}]
                  </span>
                  {source.snippet && (
                    <p className="mt-1 text-gray-500">{source.snippet}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-gray-200 p-4">
          <button
            onClick={() => setFactsExpanded(!factsExpanded)}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {factsExpanded ? "hide" : "show"} facts ({packet.facts.length})
          </button>
          {factsExpanded && packet.facts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5 text-xs text-gray-600">
              {packet.facts.map((fact, i) => (
                <li
                  key={i}
                  className="rounded border border-gray-100 px-3 py-2"
                >
                  <span className="font-medium text-gray-900">
                    {fact.canonicalAnswer}
                  </span>
                  {fact.aliases.length > 0 && (
                    <span className="ml-1 text-gray-400">
                      ({fact.aliases.join(", ")})
                    </span>
                  )}
                  {fact.notes && (
                    <p className="mt-0.5 text-gray-500">{fact.notes}</p>
                  )}
                  {fact.sourceIds.length > 0 && (
                    <p className="mt-0.5 text-gray-400">
                      sources: {fact.sourceIds.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {packet.runs.length > 0 && (
          <div className="rounded-md border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700">
              runs using this packet
            </h3>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {packet.runs.map((run) => (
                <li key={run.slug}>
                  <a
                    className="font-medium text-gray-900 underline"
                    href={`/solo/run/${run.slug}/debug`}
                  >
                    {run.slug}
                  </a>
                  <span className="ml-1 text-gray-500">
                    {run.categoryDisplayName} · score {run.score}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
