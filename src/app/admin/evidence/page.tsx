"use client";

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";

type SourceCandidate = {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  snippet: string;
};

type TablePreview = {
  selectionId: string;
  blockType: "table" | "list";
  blockId: string;
  sourceUrl: string;
  tableIndex: number;
  heading: string | null;
  headers: string[];
  rowCount: number;
  score: number;
  answerColumnName: string;
  sampleRecords: string[];
  includedByDefault: boolean;
};

type SourcePreviewError = {
  source: {
    url: string;
    contentType: string;
  };
  error: string | null;
};

export default function EvidenceAdminPage() {
  const utils = api.useUtils();
  const [category, setCategory] = useState(
    () =>
      new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      ).get("category") ?? "survivor contestants",
  );
  const [customSourceUrlsText, setCustomSourceUrlsText] = useState("");
  const [selectedSourceUrls, setSelectedSourceUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [sources, setSources] = useState<SourceCandidate[]>([]);
  const [tables, setTables] = useState<TablePreview[]>([]);
  const [sourcePreviewErrors, setSourcePreviewErrors] = useState<
    SourcePreviewError[]
  >([]);
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hasPreviewedTables, setHasPreviewedTables] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const resolved = api.admin.resolveEvidenceCategory.useQuery(
    { category },
    { enabled: category.trim().length > 0 },
  );
  const latest = api.admin.getLatestEvidenceForCategory.useQuery(
    { category },
    { enabled: category.trim().length > 0 },
  );
  const packets = api.admin.listEvidencePackets.useQuery({ limit: 20 });

  const discover = api.admin.discoverEvidenceSources.useMutation({
    onSuccess: (data) => {
      setSources(data.sources);
      setSelectedSourceUrls(
        new Set(
          (data.recommendedUrl ? [data.recommendedUrl] : [data.sources[0]?.url])
            .filter((url): url is string => !!url),
        ),
      );
      setTables([]);
      setSourcePreviewErrors([]);
      setSelectedTableIds(new Set());
      setHasPreviewedTables(false);
    },
  });
  const previewTables = api.admin.previewSourceTables.useMutation({
    onSuccess: (data) => {
      setTables(data.tables);
      setSourcePreviewErrors(data.sources.filter((source) => source.error));
      setSelectedTableIds(
        new Set(data.tables.map((table) => table.selectionId)),
      );
      setHasPreviewedTables(true);
    },
  });
  const build = api.admin.buildEvidenceDataset.useMutation({
    onSuccess: async (packet) => {
      setBuildError(null);
      await Promise.all([
        utils.admin.getLatestEvidenceForCategory.invalidate({ category }),
        utils.admin.listEvidencePackets.invalidate({ limit: 20 }),
      ]);
      window.location.href = `/solo/evidence/${packet.id}`;
    },
    onError: (err) => setBuildError(err.message),
  });

  const spec = resolved.data?.spec;
  const customSourceUrls = useMemo(
    () =>
      Array.from(
        new Set(
          customSourceUrlsText
            .split(/[\s,]+/)
            .map((url) => url.trim())
            .filter(Boolean),
        ),
      ),
    [customSourceUrlsText],
  );
  const selectedSources = useMemo(
    () => Array.from(selectedSourceUrls),
    [selectedSourceUrls],
  );
  const sourceUrlsForRun = useMemo(
    () => Array.from(new Set([...selectedSources, ...customSourceUrls])),
    [customSourceUrls, selectedSources],
  );
  const selectedTables = useMemo(
    () => Array.from(selectedTableIds),
    [selectedTableIds],
  );

  function resetTablePreview() {
    setTables([]);
    setSourcePreviewErrors([]);
    setSelectedTableIds(new Set());
    setHasPreviewedTables(false);
  }

  function toggleSource(url: string) {
    setSelectedSourceUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
    resetTablePreview();
  }

  function toggleTable(selectionId: string) {
    setSelectedTableIds((current) => {
      const next = new Set(current);
      if (next.has(selectionId)) {
        next.delete(selectionId);
      } else {
        next.add(selectionId);
      }
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-gray-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold">Evidence admin</h1>
          <p className="mt-1 text-sm text-gray-500">
            Build canonical datasets here; games only read packets that already exist.
          </p>
        </header>

        <section className="flex flex-col gap-3 border-y border-gray-200 py-5">
          <label className="text-xs font-medium uppercase text-gray-500">
            Category
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setSelectedSourceUrls(new Set());
                setCustomSourceUrlsText("");
                resetTablePreview();
              }}
              className="min-h-10 flex-1 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-gray-900"
            />
            <button
              onClick={() => {
                resetTablePreview();
                discover.mutate({ category });
              }}
              disabled={!resolved.data?.buildable || discover.isPending}
              className="min-h-10 rounded-md border border-gray-900 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {discover.isPending ? "Discovering" : "Discover sources"}
            </button>
          </div>
          {spec && (
            <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
              <p>
                <span className="font-medium text-gray-900">buildable:</span>{" "}
                {spec.buildable ? "yes" : "no"}
              </p>
              <p>
                <span className="font-medium text-gray-900">entity:</span>{" "}
                {spec.entityType}
              </p>
              <p>
                <span className="font-medium text-gray-900">freshness:</span>{" "}
                {spec.freshness}
              </p>
              {!spec.buildable && spec.notBuildableReason ? (
                <p className="sm:col-span-3">{spec.notBuildableReason}</p>
              ) : null}
            </div>
          )}
          {latest.data && (
            <p className="text-xs text-gray-500">
              Latest packet:{" "}
              <a className="font-medium underline" href={`/solo/evidence/${latest.data.id}`}>
                {latest.data.id}
              </a>{" "}
              · {latest.data.status} · {latest.data.facts.length} entries
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sources</h2>
            {discover.error && (
              <span className="text-xs text-red-600">
                {discover.error.message}
              </span>
            )}
          </div>
          {sources.length === 0 ? (
            <p className="text-sm text-gray-500">
              Run source discovery or use a known mapped category to pick a source.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500">
                Select one or more sources to evaluate. Preview will inspect only selected sources.
              </p>
              {sources.map((source) => (
                <label
                  key={source.id}
                  className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedSourceUrls.has(source.url)}
                    onChange={() => {
                      toggleSource(source.url);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-gray-900">
                      {source.title}
                    </span>
                    <span className="block break-all text-xs text-gray-500">
                      {source.url}
                    </span>
                    {source.snippet && (
                      <span className="mt-1 block text-xs text-gray-500">
                        {source.snippet}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              value={customSourceUrlsText}
              onChange={(event) => {
                setCustomSourceUrlsText(event.target.value);
                resetTablePreview();
              }}
              placeholder={"Optional custom URLs, one per line\nhttps://en.wikipedia.org/wiki/..."}
              rows={3}
              className="min-h-24 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() =>
                previewTables.mutate({
                  category,
                  sourceUrls: sourceUrlsForRun,
                })
              }
              disabled={
                sourceUrlsForRun.length === 0 ||
                previewTables.isPending
              }
              className="min-h-10 rounded-md border border-gray-900 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewTables.isPending ? "Previewing" : "Preview tables"}
            </button>
            <button
              onClick={() =>
                build.mutate({
                  category,
                  sourceUrls:
                    sourceUrlsForRun.length > 0 ? sourceUrlsForRun : undefined,
                  includeBlockIds: hasPreviewedTables
                    ? selectedTables
                    : undefined,
                  forceRefresh: true,
                })
              }
              disabled={
                !resolved.data?.buildable ||
                build.isPending ||
                (hasPreviewedTables && selectedTables.length === 0)
              }
              className="min-h-10 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {build.isPending ? "Building" : "Build dataset"}
            </button>
          </div>
          {previewTables.error && (
            <p className="text-xs text-red-600">
              {previewTables.error.message}
            </p>
          )}
          <p className="text-xs text-gray-500">
            Selected sources:{" "}
            {sourceUrlsForRun.length > 0 ? (
              <>
                {sourceUrlsForRun.length} total ({selectedSources.length} discovered,{" "}
                {customSourceUrls.length} custom)
              </>
            ) : (
              "none"
            )}
          </p>
          {buildError && <p className="text-xs text-red-600">{buildError}</p>}
        </section>

        {hasPreviewedTables && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Block preview</h2>
              <span className="text-xs text-gray-500">
                {selectedTables.length}/{tables.length} selected
              </span>
            </div>
            {tables.length === 0 ? (
              <p className="text-sm text-gray-500">
                No candidate answer tables or lists were found for the selected sources.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {tables.map((table) => (
                  <label
                    key={table.selectionId}
                    className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTableIds.has(table.selectionId)}
                      onChange={() => toggleTable(table.selectionId)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {table.heading ?? `Table ${table.tableIndex + 1}`}
                        </span>
                        <span className="text-xs text-gray-400">
                          {table.blockType} · {table.blockId} ·{" "}
                          {table.rowCount} rows · answer: {table.answerColumnName}
                        </span>
                      </span>
                      <span className="mt-1 block break-all text-xs text-gray-400">
                        {table.sourceUrl}
                      </span>
                      <span className="mt-1 block truncate text-xs text-gray-500">
                        {table.headers.join(" · ")}
                      </span>
                      <span className="mt-2 block text-xs text-gray-600">
                        Examples: {table.sampleRecords.join(", ") || "none"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {sourcePreviewErrors.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-medium">Some sources could not be previewed</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {sourcePreviewErrors.map((source) => (
                    <li key={source.source.url}>
                      {source.source.url}: {source.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Recent packets</h2>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2 pr-3">packet</th>
                <th className="py-2 pr-3">category</th>
                <th className="py-2 pr-3">status</th>
                <th className="py-2 pr-3">entries</th>
                <th className="py-2 pr-3">slugs</th>
                <th className="py-2">built</th>
              </tr>
            </thead>
            <tbody>
              {(packets.data ?? []).map((packet) => (
                <tr key={packet.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-mono">
                    <a className="underline" href={`/solo/evidence/${packet.id}`}>
                      {packet.id}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{packet.category}</td>
                  <td className="py-2 pr-3">{packet.status}</td>
                  <td className="py-2 pr-3">{packet.facts.length}</td>
                  <td className="py-2 pr-3 text-gray-500">
                    {packet.assignedCategorySlugs.length > 0
                      ? packet.assignedCategorySlugs.join(", ")
                      : "none"}
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(packet.retrievedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
