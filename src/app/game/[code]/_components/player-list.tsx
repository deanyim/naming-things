"use client";

interface Player {
  id: number;
  displayName: string;
  score: number;
  isHost: boolean;
}

interface Spectator {
  id: number;
  displayName: string;
}

export function PlayerList({
  players,
  spectators,
}: {
  players: Player[];
  spectators?: Spectator[];
}) {
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

      {spectators && spectators.length > 0 && (
        <>
          <p className="mt-2 text-sm font-medium text-gray-400">
            spectating ({spectators.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {spectators.map((s) => (
              <span
                key={s.id}
                className="rounded-full bg-gray-50 px-3 py-1 text-sm text-gray-400"
              >
                {s.displayName}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
