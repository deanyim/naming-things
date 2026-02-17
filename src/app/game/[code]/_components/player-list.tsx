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
  isHost,
  onKick,
}: {
  players: Player[];
  spectators?: Spectator[];
  isHost?: boolean;
  onKick?: (playerId: number) => void;
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
            className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
          >
            {p.displayName}
            {p.isHost && (
              <span className="ml-1 text-xs text-gray-400">(host)</span>
            )}
            {isHost && !p.isHost && onKick && (
              <button
                onClick={() => onKick(p.id)}
                className="ml-1 text-gray-400 hover:text-red-500"
                aria-label={`Kick ${p.displayName}`}
              >
                x
              </button>
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
                className="flex items-center rounded-full bg-gray-50 px-3 py-1 text-sm text-gray-400"
              >
                {s.displayName}
                {isHost && onKick && (
                  <button
                    onClick={() => onKick(s.id)}
                    className="ml-1 text-gray-400 hover:text-red-500"
                    aria-label={`Kick ${s.displayName}`}
                  >
                    x
                  </button>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
