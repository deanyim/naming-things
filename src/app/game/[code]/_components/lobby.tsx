"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { ShareCode } from "./share-code";
import { PlayerList } from "./player-list";
import { TeamPlayerList } from "./team-player-list";
import { ToggleGroup } from "./toggle-group";
import { TOPIC_SUGGESTIONS } from "./topic-suggestions";
import type { GameState } from "./types";

function formatTimer(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} min`;
  }
  return `${seconds}s`;
}

export function Lobby({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const [category, setCategory] = useState(game.category ?? "");
  const [timerValue, setTimerValue] = useState<number | "">(
    game.timerSeconds >= 60 && game.timerSeconds % 60 === 0
      ? game.timerSeconds / 60
      : game.timerSeconds,
  );
  const [timerUnit, setTimerUnit] = useState<"seconds" | "minutes">(
    game.timerSeconds >= 60 && game.timerSeconds % 60 === 0
      ? "minutes"
      : "seconds",
  );
  const [turnTimerValue, setTurnTimerValue] = useState<number | "">(
    game.turnTimerSeconds,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!game.isHost && game.category !== null) {
      setCategory(game.category);
    }
  }, [game.category, game.isHost]);

  const timerSeconds =
    timerValue === ""
      ? null
      : timerUnit === "minutes"
        ? timerValue * 60
        : timerValue;

  const utils = api.useUtils();
  const queryInput = { sessionToken, code: game.code };

  const setModeMutation = api.game.setMode.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, mode: variables.mode } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setCategoryMutation = api.game.setCategory.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, category: variables.category } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setTimerMutation = api.game.setTimer.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, timerSeconds: variables.timerSeconds } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setTurnTimerMutation = api.game.setTurnTimer.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, turnTimerSeconds: variables.turnTimerSeconds } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setAutoClassificationMutation = api.game.setAutoClassificationEnabled.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, autoClassificationEnabled: variables.enabled } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setTeamModeMutation = api.game.setTeamMode.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, isTeamMode: variables.isTeamMode } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setNumTeamsMutation = api.game.setNumTeams.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) =>
        old ? { ...old, numTeams: variables.numTeams } : old,
      );
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _v, ctx) => {
      if (ctx?.previousData) utils.game.getState.setData(queryInput, ctx.previousData);
      setError(err.message);
    },
  });

  const setPlayerTeamMutation = api.game.setPlayerTeam.useMutation({
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err) => setError(err.message),
  });

  const startGame = api.game.start.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const joinAsPlayer = api.game.joinAsPlayer.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  const kickPlayerMutation = api.game.kickPlayer.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const mutInput = { sessionToken, gameId: game.id };

  const saveCategory = () => {
    const trimmed = category.trim();
    if (trimmed && trimmed !== game.category) {
      setCategoryMutation.mutate({ ...mutInput, category: trimmed });
    }
  };

  const saveTimer = () => {
    if (timerSeconds === null) {
      setError("Enter a timer");
      return false;
    }
    if (timerSeconds < 10 || timerSeconds > 7200) {
      setError("Timer must be between 10 seconds and 120 minutes");
      return false;
    }
    if (timerSeconds !== game.timerSeconds) {
      setTimerMutation.mutate({ ...mutInput, timerSeconds });
    }
    return true;
  };

  const saveTurnTimer = () => {
    if (turnTimerValue === "") {
      setError("Enter a turn timer");
      return false;
    }
    if (turnTimerValue < 3 || turnTimerValue > 30) {
      setError("Turn timer must be between 3 and 30 seconds");
      return false;
    }
    if (turnTimerValue !== game.turnTimerSeconds) {
      setTurnTimerMutation.mutate({ ...mutInput, turnTimerSeconds: turnTimerValue });
    }
    return true;
  };

  const handleStart = () => {
    if (!game.category && !category.trim()) {
      setError("Set a topic first");
      return;
    }
    if (category.trim() && category.trim() !== game.category) {
      saveCategory();
    }
    if (game.mode === "classic" && timerSeconds !== game.timerSeconds) {
      if (!saveTimer()) return;
    }
    if (game.mode === "turns" && turnTimerValue !== game.turnTimerSeconds) {
      if (!saveTurnTimer()) return;
    }
    setError("");
    startGame.mutate(mutInput);
  };

  const suggestTopic = () => {
    const options = TOPIC_SUGGESTIONS.filter((t) => t !== category);
    const pick = options[Math.floor(Math.random() * options.length)]!;
    setCategory(pick);
  };

  const topicSet = !!game.category;
  const needMorePlayers = game.mode === "turns" && game.players.length < 2;
  const timerChanged = timerSeconds !== null && timerSeconds !== game.timerSeconds;
  const turnTimerChanged =
    turnTimerValue !== "" && turnTimerValue !== game.turnTimerSeconds;

  const playerListSection = game.isTeamMode ? (
    <TeamPlayerList
      players={game.players}
      spectators={game.spectators}
      numTeams={game.numTeams}
      isHost={game.isHost}
      myPlayerId={game.myPlayerId}
      isSpectator={game.isSpectator}
      onSetTeam={(playerId, teamId) =>
        setPlayerTeamMutation.mutate({ ...mutInput, playerId, teamId })
      }
      onKick={(playerId) =>
        kickPlayerMutation.mutate({ ...mutInput, playerId })
      }
    />
  ) : (
    <PlayerList
      players={game.players}
      spectators={game.spectators}
      isHost={game.isHost}
      onKick={(playerId) =>
        kickPlayerMutation.mutate({ ...mutInput, playerId })
      }
    />
  );

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-4 py-6 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+1.5rem)] sm:justify-center sm:py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <h1 className="text-2xl font-bold text-gray-900">lobby</h1>

        <ShareCode code={game.code} />

        {playerListSection}

        {game.isHost ? (
          <div className="flex w-full flex-col gap-4">
            <ToggleGroup
              label="mode"
              value={game.mode}
              onChange={(mode) =>
                setModeMutation.mutate({ ...mutInput, mode: mode as "classic" | "turns" })
              }
              options={[
                { value: "classic", label: "classic" },
                { value: "turns", label: "last one standing" },
              ]}
            />

            {game.mode === "classic" && (
              <ToggleGroup
                label="teams"
                value={game.isTeamMode ? "on" : "off"}
                onChange={(v) =>
                  setTeamModeMutation.mutate({ ...mutInput, isTeamMode: v === "on" })
                }
                options={[
                  { value: "off", label: "off" },
                  { value: "on", label: "on" },
                ]}
              />
            )}

            {game.mode === "classic" && game.isTeamMode && (
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-gray-500"># teams</label>
                <input
                  type="number"
                  min={1}
                  value={game.numTeams}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value));
                    setNumTeamsMutation.mutate({ ...mutInput, numTeams: val });
                  }}
                  className="min-h-11 w-24 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-gray-900"
                />
              </div>
            )}

            <ToggleGroup
              label="auto review"
              value={game.autoClassificationEnabled ? "on" : "off"}
              onChange={(v) =>
                setAutoClassificationMutation.mutate({ ...mutInput, enabled: v === "on" })
              }
              options={[
                { value: "off", label: "off" },
                { value: "on", label: "on" },
              ]}
            />

            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">
              <label className="col-span-2 text-sm text-gray-500 sm:col-span-1">topic</label>
              <input
                type="text"
                placeholder="e.g. types of cheese"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={saveCategory}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCategory();
                }}
                className="col-span-2 min-h-11 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900 sm:col-span-1"
              />
              <button
                onClick={saveCategory}
                disabled={
                  setCategoryMutation.isPending ||
                  !category.trim() ||
                  category.trim() === game.category
                }
                className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                {setCategoryMutation.isPending ? "..." : "set"}
              </button>
              <button
                onClick={suggestTopic}
                className="min-h-11 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-400 transition hover:border-gray-400 hover:text-gray-600"
              >
                random
              </button>
            </div>

            {topicSet && (
              <p className="text-center text-sm text-gray-500">
                topic: <span className="font-medium text-gray-900">{game.category}</span>
              </p>
            )}

            {game.mode === "classic" ? (
              <>
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 sm:flex">
                  <label className="text-sm text-gray-500">timer</label>
                  <input
                    type="number"
                    min={1}
                    value={timerValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTimerValue(next === "" ? "" : Number(next));
                    }}
                    className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-gray-900 sm:w-20"
                  />
                  <select
                    value={timerUnit}
                    onChange={(e) =>
                      setTimerUnit(e.target.value as "seconds" | "minutes")
                    }
                    className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-gray-900"
                  >
                    <option value="seconds">seconds</option>
                    <option value="minutes">minutes</option>
                  </select>
                  <button
                    onClick={saveTimer}
                    disabled={
                      setTimerMutation.isPending ||
                      timerSeconds === null ||
                      !timerChanged
                    }
                    className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                  >
                    {setTimerMutation.isPending ? "..." : "set"}
                  </button>
                </div>

                <p className="text-center text-sm text-gray-500">
                  timer: <span className="font-medium text-gray-900">{formatTimer(game.timerSeconds)}</span>
                </p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 sm:flex">
                  <label className="text-sm text-gray-500">turn timer</label>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={turnTimerValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTurnTimerValue(next === "" ? "" : Number(next));
                    }}
                    className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 outline-none focus:border-gray-900 sm:w-20"
                  />
                  <span className="text-sm text-gray-500">seconds</span>
                  <button
                    onClick={saveTurnTimer}
                    disabled={
                      setTurnTimerMutation.isPending ||
                      turnTimerValue === "" ||
                      !turnTimerChanged
                    }
                    className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                  >
                    {setTurnTimerMutation.isPending ? "..." : "set"}
                  </button>
                </div>

                <p className="text-center text-sm text-gray-500">
                  turn timer: <span className="font-medium text-gray-900">{game.turnTimerSeconds}s</span>
                </p>
              </>
            )}

            <button
              onClick={handleStart}
              disabled={startGame.isPending || !topicSet || needMorePlayers}
              className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {startGame.isPending ? "starting..." : "start round"}
            </button>

            {needMorePlayers && (
              <p className="text-center text-sm text-gray-500">
                need at least 2 players
              </p>
            )}

            {error && (
              <p className="text-center text-sm text-red-600">{error}</p>
            )}
          </div>
        ) : game.isSpectator ? (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="text-center text-gray-500">you are spectating</p>
            <button
              onClick={() =>
                joinAsPlayer.mutate({ sessionToken, gameId: game.id })
              }
              disabled={joinAsPlayer.isPending}
              className="min-h-12 w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {joinAsPlayer.isPending ? "joining..." : "join as player"}
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-4">
            <p className="text-sm text-gray-500">
              mode: <span className="font-medium text-gray-900">{game.mode === "classic" ? "classic" : "last one standing"}</span>
            </p>
            {game.isTeamMode && (
              <p className="text-sm text-gray-500">
                teams: <span className="font-medium text-gray-900">on ({game.numTeams} teams)</span>
              </p>
            )}
            <p className="text-sm text-gray-500">
              auto review: <span className="font-medium text-gray-900">{game.autoClassificationEnabled ? "on" : "off"}</span>
            </p>
            {topicSet ? (
              <p className="text-sm text-gray-500">
                topic: <span className="font-medium text-gray-900">{game.category}</span>
              </p>
            ) : null}
            <p className="text-sm text-gray-500">
              {game.mode === "classic"
                ? <>timer: <span className="font-medium text-gray-900">{formatTimer(game.timerSeconds)}</span></>
                : <>turn timer: <span className="font-medium text-gray-900">{game.turnTimerSeconds}s</span></>
              }
            </p>
            <p className="text-center text-gray-500">
              waiting for the host to start...
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
