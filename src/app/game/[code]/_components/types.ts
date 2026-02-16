export interface GameState {
  id: number;
  code: string;
  status: "lobby" | "playing" | "reviewing" | "finished";
  category: string | null;
  timerSeconds: number;
  startedAt: Date | null;
  endedAt: Date | null;
  isHost: boolean;
  isSpectator: boolean;
  rematchCode: string | null;
  hostPlayerId: number;
  myPlayerId: number;
  players: {
    id: number;
    displayName: string;
    score: number;
    isHost: boolean;
  }[];
  spectators: {
    id: number;
    displayName: string;
  }[];
}
