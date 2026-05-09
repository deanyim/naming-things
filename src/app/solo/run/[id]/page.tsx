"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { SoloRun } from "../../_components/solo-run";
import { SoloResults } from "../../_components/solo-results";
import { PublicRunView } from "../../_components/public-run-view";

export default function SoloRunPage() {
  const params = useParams();
  const slug = params.id as string;
  const { sessionToken, isReady } = useSession();
  const [showResults, setShowResults] = useState(false);

  // Try to load as owner first
  const runQuery = api.solo.getRun.useQuery(
    { sessionToken, slug },
    { enabled: isReady && !!sessionToken && !!slug, retry: false },
  );

  // Fall back to public view if the run doesn't belong to this player
  const isNotOwner =
    (runQuery.isError && runQuery.error?.data?.code === "NOT_FOUND") ||
    (runQuery.isError && runQuery.error?.data?.code === "UNAUTHORIZED") ||
    (!runQuery.isLoading && !runQuery.isError && !runQuery.data);
  const publicQuery = api.solo.getPublicRun.useQuery(
    { slug },
    { enabled: isReady && !!slug && isNotOwner },
  );

  if (!isReady || (runQuery.isLoading && !isNotOwner)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4">
        <p className="text-gray-400">loading...</p>
      </div>
    );
  }

  // Public view of someone else's finished run
  if (isNotOwner) {
    if (publicQuery.isLoading) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-white px-4">
          <p className="text-gray-400">loading...</p>
        </div>
      );
    }
    if (!publicQuery.data) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-white px-4">
          <p className="text-gray-500">run not found</p>
        </div>
      );
    }
    return <PublicRunView run={publicQuery.data} />;
  }

  if (!runQuery.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4">
        <p className="text-gray-500">run not found</p>
      </div>
    );
  }

  if (runQuery.data.status === "finished" || showResults) {
    return <SoloResults slug={slug} />;
  }

  return (
    <SoloRun
      slug={slug}
      onFinished={() => setShowResults(true)}
    />
  );
}
