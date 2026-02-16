"use client";

interface Player {
  id: number;
  displayName: string;
  score: number;
  isHost: boolean;
}

export function PlayerList({ players }: { players: Player[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-500">
        players ({players.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {players.map((p) => (
          <span
            key={p.id}
            className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
          >
            {p.displayName}
            {p.isHost && (
              <span className="ml-1 text-xs text-gray-400">(host)</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
