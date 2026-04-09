import { createTRPCRouter } from "~/server/api/trpc";
import { lobbyRouter } from "./lobby";
import { gameplayRouter } from "./gameplay";
import { reviewRouter } from "./review";
import { managementRouter } from "./management";

export const gameRouter = createTRPCRouter({
  // Lobby & setup
  create: lobbyRouter.create,
  join: lobbyRouter.join,
  getState: lobbyRouter.getState,
  getVerifications: lobbyRouter.getVerifications,
  getHistory: lobbyRouter.getHistory,
  setCategory: lobbyRouter.setCategory,
  setTimer: lobbyRouter.setTimer,
  setMode: lobbyRouter.setMode,
  setTurnTimer: lobbyRouter.setTurnTimer,
  setAutoClassificationEnabled: lobbyRouter.setAutoClassificationEnabled,
  setTeamMode: lobbyRouter.setTeamMode,
  setNumTeams: lobbyRouter.setNumTeams,
  setPlayerTeam: lobbyRouter.setPlayerTeam,
  start: lobbyRouter.start,

  // Active gameplay
  submitTurnAnswer: gameplayRouter.submitTurnAnswer,
  timeoutTurn: gameplayRouter.timeoutTurn,
  submitAnswersBatch: gameplayRouter.submitAnswersBatch,
  submitTeamAnswer: gameplayRouter.submitTeamAnswer,
  removeTeamAnswer: gameplayRouter.removeTeamAnswer,
  getTeamAnswers: gameplayRouter.getTeamAnswers,
  endAnswering: gameplayRouter.endAnswering,

  // Review & scoring
  getAllAnswers: reviewRouter.getAllAnswers,
  retryAutoClassification: reviewRouter.retryAutoClassification,
  disputeAnswer: reviewRouter.disputeAnswer,
  castVote: reviewRouter.castVote,
  finishGame: reviewRouter.finishGame,

  // Game management
  spectate: managementRouter.spectate,
  joinAsPlayer: managementRouter.joinAsPlayer,
  kickPlayer: managementRouter.kickPlayer,
  pauseGame: managementRouter.pauseGame,
  resumeGame: managementRouter.resumeGame,
  terminateGame: managementRouter.terminateGame,
  createRematch: managementRouter.createRematch,
});
