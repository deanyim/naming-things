import { Suspense } from "react";
import { LeaderboardsContent } from "./leaderboards-content";

export default function LeaderboardsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-white">
          <p className="text-gray-400">loading...</p>
        </main>
      }
    >
      <LeaderboardsContent />
    </Suspense>
  );
}
