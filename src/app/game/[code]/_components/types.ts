export interface GameState {
  id: number;
  code: string;
  status: "lobby" | "playing" | "reviewing" | "finished";
  mode: "classic" | "turns";
  category: string | null;
  timerSeconds: number;
  turnTimerSeconds: number;
  currentTurnPlayerId: number | null;
  currentTurnDeadline: Date | null;
  turnsHistory: { text: string; playerDisplayName: string }[] | null;
  startedAt: Date | null;
  endedAt: Date | null;
  isHost: boolean;
  isSpectator: boolean;
  hostPlayerId: number;
  myPlayerId: number;
  players: {
    id: number;
    displayName: string;
    score: number;
    isHost: boolean;
    isEliminated: boolean;
  }[];
  spectators: {
    id: number;
    displayName: string;
  }[];
}
