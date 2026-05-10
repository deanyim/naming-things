"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "~/trpc/react";

export default function EvidencePacketDebugPage() {
  const params = useParams();
  const id = params.id as string;
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [queriesExpanded, setQueriesExpanded] = useState(false);
  const [factFilter, setFactFilter] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [selectedFactIndexes, setSelectedFactIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const [primaryFactIndex, setPrimaryFactIndex] = useState<number | null>(null);
  const utils = api.useUtils();

  const { data: packet, isLoading } = api.solo.getEvidencePacket.useQuery(
    { id },
    { enabled: !!id },
  );
  const mergeFacts = api.admin.mergeEvidenceFacts.useMutation({
    onSuccess: async () => {
      setSelectedFactIndexes(new Set());
      setPrimaryFactIndex(null);
      await utils.solo.getEvidencePacket.invalidate({ id });
    },
  });
  const assignSlug = api.admin.assignEvidencePacketSlug.useMutation({
    onSuccess: async () => {
      setSlugInput("");
      await utils.solo.getEvidencePacket.invalidate({ id });
    },
  });
  const unassignSlug = api.admin.unassignEvidencePacketSlug.useMutation({
    onSuccess: async () => {
      await utils.solo.getEvidencePacket.invalidate({ id });
    },
  });

  const selectedFactIndexesList = useMemo(
    () => Array.from(selectedFactIndexes).sort((a, b) => a - b),
    [selectedFactIndexes],
  );
  const filteredFacts = useMemo(() => {
    const needle = factFilter.trim().toLowerCase();
    return (packet?.facts ?? [])
      .map((fact, index) => ({ fact, index }))
      .filter(({ fact }) => {
        if (!needle) return true;
        return [
          fact.canonicalAnswer,
          ...fact.aliases,
          ...(fact.matchKeys ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [factFilter, packet?.facts]);

  function toggleFactSelection(index: number) {
    setSelectedFactIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      const nextValues = Array.from(next).sort((a, b) => a - b);
      setPrimaryFactIndex((currentPrimary) =>
        currentPrimary != null && next.has(currentPrimary)
          ? currentPrimary
          : nextValues[0] ?? null,
      );
      return next;
    });
  }

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
          <h3 className="text-sm font-medium text-gray-700">
            category slug assignments
          </h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={slugInput}
              onChange={(event) => setSlugInput(event.target.value)}
              placeholder="survivor contestants"
              className="min-h-9 flex-1 rounded-md border border-gray-300 px-3 text-xs outline-none focus:border-gray-900"
            />
            <button
              onClick={() =>
                assignSlug.mutate({
                  id,
                  categorySlug: slugInput,
                })
              }
              disabled={!slugInput.trim() || assignSlug.isPending}
              className="min-h-9 rounded-md border border-gray-900 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assignSlug.isPending ? "Assigning" : "Assign slug"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Slugs are normalized the same way solo categories are bucketed.
            Assigning an existing slug moves it to this packet.
          </p>
          {assignSlug.error && (
            <p className="mt-2 text-xs text-red-600">
              {assignSlug.error.message}
            </p>
          )}
          {unassignSlug.error && (
            <p className="mt-2 text-xs text-red-600">
              {unassignSlug.error.message}
            </p>
          )}
          {(packet.assignedCategorySlugs ?? []).length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {(packet.assignedCategorySlugs ?? []).map((slug) => (
                <li
                  key={slug}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1"
                >
                  <span className="font-mono text-gray-700">{slug}</span>
                  <button
                    onClick={() =>
                      unassignSlug.mutate({
                        categorySlug: slug,
                      })
                    }
                    disabled={unassignSlug.isPending}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-gray-500">
              No category slugs are assigned to this packet.
            </p>
          )}
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
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-2 border-y border-gray-100 py-3">
                <input
                  value={factFilter}
                  onChange={(event) => setFactFilter(event.target.value)}
                  placeholder="Filter entries"
                  className="min-h-9 rounded-md border border-gray-300 px-3 text-xs outline-none focus:border-gray-900"
                />
                <div className="flex flex-col gap-2 text-xs text-gray-500 sm:flex-row sm:items-center">
                  <span>
                    {selectedFactIndexesList.length} selected · {filteredFacts.length} shown
                  </span>
                  {selectedFactIndexesList.length > 0 && (
                    <label className="flex items-center gap-2">
                      <span>primary</span>
                      <select
                        value={primaryFactIndex ?? ""}
                        onChange={(event) =>
                          setPrimaryFactIndex(Number(event.target.value))
                        }
                        className="min-h-8 rounded-md border border-gray-300 px-2 text-xs text-gray-900"
                      >
                        {selectedFactIndexesList.map((index) => (
                          <option key={index} value={index}>
                            {packet.facts[index]?.canonicalAnswer ?? `Entry ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    onClick={() =>
                      mergeFacts.mutate({
                        id,
                        factIndexes: selectedFactIndexesList,
                        primaryFactIndex: primaryFactIndex ?? undefined,
                      })
                    }
                    disabled={
                      selectedFactIndexesList.length < 2 ||
                      mergeFacts.isPending
                    }
                    className="min-h-8 rounded-md border border-gray-900 px-3 text-xs font-medium text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mergeFacts.isPending ? "Merging" : "Merge selected"}
                  </button>
                  {selectedFactIndexesList.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedFactIndexes(new Set());
                        setPrimaryFactIndex(null);
                      }}
                      className="min-h-8 rounded-md border border-gray-300 px-3 text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {mergeFacts.error && (
                  <p className="text-xs text-red-600">
                    {mergeFacts.error.message}
                  </p>
                )}
              </div>
              <ul className="flex flex-col gap-1.5 text-xs text-gray-600">
                {filteredFacts.map(({ fact, index }) => (
                  <li
                    key={index}
                    className="rounded border border-gray-100 px-3 py-2"
                  >
                    <label className="flex cursor-pointer gap-3">
                      <input
                        type="checkbox"
                        checked={selectedFactIndexes.has(index)}
                        onChange={() => toggleFactSelection(index)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
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
                          <p className="mt-0.5 break-all text-gray-400">
                            sources: {fact.sourceIds.join(", ")}
                          </p>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
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
