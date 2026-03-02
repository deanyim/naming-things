"use client";

interface Player {
  id: number;
  displayName: string;
  score: number;
  isHost: boolean;
  teamId: number | null;
}

interface Spectator {
  id: number;
  displayName: string;
}

export function TeamPlayerList({
  players,
  spectators,
  numTeams,
  isHost,
  myPlayerId,
  isSpectator,
  onSetTeam,
  onKick,
}: {
  players: Player[];
  spectators?: Spectator[];
  numTeams: number;
  isHost?: boolean;
  myPlayerId: number;
  isSpectator?: boolean;
  onSetTeam?: (playerId: number, teamId: number) => void;
  onKick?: (playerId: number) => void;
}) {
  // Group players by team
  const teamGroups: Map<number, Player[]> = new Map();
  const unassigned: Player[] = [];

  for (let i = 1; i <= numTeams; i++) {
    teamGroups.set(i, []);
  }

  for (const p of players) {
    if (p.teamId && teamGroups.has(p.teamId)) {
      teamGroups.get(p.teamId)!.push(p);
    } else {
      unassigned.push(p);
    }
  }

  const canChangeTeam = (playerId: number) => {
    if (isSpectator) return false;
    return isHost || playerId === myPlayerId;
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {Array.from(teamGroups.entries()).map(([teamId, teamPlayers]) => (
        <div key={teamId} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-gray-500">
            team {teamId} ({teamPlayers.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {teamPlayers.length === 0 ? (
              <span className="text-xs text-gray-400">no players</span>
            ) : (
              teamPlayers.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                >
                  {p.displayName}
                  {p.isHost && (
                    <span className="ml-1 text-xs text-gray-400">(host)</span>
                  )}
                  {canChangeTeam(p.id) && onSetTeam && (
                    <select
                      value={p.teamId ?? ""}
                      onChange={(e) => onSetTeam(p.id, Number(e.target.value))}
                      className="ml-1 rounded border border-gray-300 bg-transparent px-1 py-0.5 text-xs text-gray-500 outline-none"
                    >
                      {Array.from({ length: numTeams }, (_, i) => i + 1).map(
                        (tid) => (
                          <option key={tid} value={tid}>
                            T{tid}
                          </option>
                        ),
                      )}
                    </select>
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
              ))
            )}
          </div>
        </div>
      ))}

      {unassigned.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-gray-400">unassigned</p>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((p) => (
              <span
                key={p.id}
                className="flex items-center rounded-full bg-yellow-50 px-3 py-1 text-sm text-gray-700"
              >
                {p.displayName}
                {p.isHost && (
                  <span className="ml-1 text-xs text-gray-400">(host)</span>
                )}
                {canChangeTeam(p.id) && onSetTeam && (
                  <select
                    value=""
                    onChange={(e) => onSetTeam(p.id, Number(e.target.value))}
                    className="ml-1 rounded border border-gray-300 bg-transparent px-1 py-0.5 text-xs text-gray-500 outline-none"
                  >
                    <option value="" disabled>
                      pick
                    </option>
                    {Array.from({ length: numTeams }, (_, i) => i + 1).map(
                      (tid) => (
                        <option key={tid} value={tid}>
                          T{tid}
                        </option>
                      ),
                    )}
                  </select>
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
        </div>
      )}

      {spectators && spectators.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-gray-400">
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
        </div>
      )}
    </div>
  );
}
