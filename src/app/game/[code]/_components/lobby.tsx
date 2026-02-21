"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { ShareCode } from "./share-code";
import { PlayerList } from "./player-list";
import type { GameState } from "./types";

const TOPIC_SUGGESTIONS = [
  "types of cheese",
  "harry potter characters",
  "cartoon characters",
  "pizza toppings",
  "dog breeds",
  "board games",
  "periodic table elements",
  "famous landmarks",
  "ice cream flavors",
  "marvel characters",
  "breakfast foods",
  "musical instruments",
  "snack foods",
  "vegetables",
  "olympic sports",
  "nfl teams",
  "animated movies",
  "birds",
  "cocktails",
  "u.s. presidents",
  "candy bars",
  "world capitals",
  "tv shows",
  "card games",
  "desserts",
  "mythical creatures",
  "pasta shapes",
  "nba teams",
  "body parts",
  "types of fish",
  "greek gods",
  "disney movies",
  "fast food chains",
  "currencies",
  "yoga poses",
  "video game characters",
  "taylor swift songs",
  "countries in africa",
  "sandwich types",
  "corporate logos",
  "shakespeare plays",
  "national parks",
  "children's books",
  "pokémon",
  "fairy tale characters",
  "star wars characters",
  "rock bands",
  "fruits",
  "horror movies",
  "game of thrones characters",
  "animals at a zoo",
  "comedians",
  "simpsons characters",
  "toys",
  "christmas songs",
  "action movies",
  "rom-coms",
  "countries in asia",
  "premier league clubs",
  "car brands",
  "herbs and spices",
  "rappers",
  "dances",
  "rides at a theme park",
  "apps",
  "countries in europe",
  "baby names",
  "world flags",
  "u.s. states",
  "countries of the world",
  "90s tv shows",
  "languages",
  "mlb teams",
  "insects",
  "flowers",
  "musicals",
  "cereals",
  "reptiles",
  "the office characters",
  "farm animals",
  "oscar best picture winners",
  "ocean creatures",
  "cat breeds",
  "super smash bros. characters",
  "nhl teams",
  "kitchen utensils",
  "dinosaurs",
  "comedies",
  "superheroes",
  "candy",
  "video games",
];

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
  const [timerValue, setTimerValue] = useState(
    game.timerSeconds >= 60 && game.timerSeconds % 60 === 0
      ? game.timerSeconds / 60
      : game.timerSeconds,
  );
  const [timerUnit, setTimerUnit] = useState<"seconds" | "minutes">(
    game.timerSeconds >= 60 && game.timerSeconds % 60 === 0
      ? "minutes"
      : "seconds",
  );
  const [turnTimerValue, setTurnTimerValue] = useState(game.turnTimerSeconds);
  const [error, setError] = useState("");

  // Keep local category in sync with server state (for non-host players)
  useEffect(() => {
    if (!game.isHost && game.category !== null) {
      setCategory(game.category);
    }
  }, [game.category, game.isHost]);

  const timerSeconds =
    timerUnit === "minutes" ? timerValue * 60 : timerValue;

  const utils = api.useUtils();
  const queryInput = { sessionToken, code: game.code };

  const setModeMutation = api.game.setMode.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) => {
        if (!old) return old;
        return { ...old, mode: variables.mode };
      });
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getState.setData(queryInput, context.previousData);
      }
      setError(err.message);
    },
  });

  const setCategoryMutation = api.game.setCategory.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) => {
        if (!old) return old;
        return { ...old, category: variables.category };
      });
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getState.setData(queryInput, context.previousData);
      }
      setError(err.message);
    },
  });

  const setTimerMutation = api.game.setTimer.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) => {
        if (!old) return old;
        return { ...old, timerSeconds: variables.timerSeconds };
      });
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getState.setData(queryInput, context.previousData);
      }
      setError(err.message);
    },
  });

  const setTurnTimerMutation = api.game.setTurnTimer.useMutation({
    onMutate: async (variables) => {
      await utils.game.getState.cancel(queryInput);
      const previousData = utils.game.getState.getData(queryInput);
      utils.game.getState.setData(queryInput, (old) => {
        if (!old) return old;
        return { ...old, turnTimerSeconds: variables.turnTimerSeconds };
      });
      return { previousData };
    },
    onSuccess: () => utils.game.getState.invalidate(queryInput),
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        utils.game.getState.setData(queryInput, context.previousData);
      }
      setError(err.message);
    },
  });

  const startGame = api.game.start.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const saveCategory = () => {
    const trimmed = category.trim();
    if (trimmed && trimmed !== game.category) {
      setCategoryMutation.mutate({
        sessionToken,
        gameId: game.id,
        category: trimmed,
      });
    }
  };

  const saveTimer = () => {
    if (timerSeconds < 10 || timerSeconds > 7200) {
      setError("Timer must be between 10 seconds and 120 minutes");
      return;
    }
    if (timerSeconds !== game.timerSeconds) {
      setTimerMutation.mutate({
        sessionToken,
        gameId: game.id,
        timerSeconds,
      });
    }
  };

  const saveTurnTimer = () => {
    if (turnTimerValue < 3 || turnTimerValue > 30) {
      setError("Turn timer must be between 3 and 30 seconds");
      return;
    }
    if (turnTimerValue !== game.turnTimerSeconds) {
      setTurnTimerMutation.mutate({
        sessionToken,
        gameId: game.id,
        turnTimerSeconds: turnTimerValue,
      });
    }
  };

  const joinAsPlayer = api.game.joinAsPlayer.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  const kickPlayerMutation = api.game.kickPlayer.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const handleStart = () => {
    if (!game.category && !category.trim()) {
      setError("Set a topic first");
      return;
    }
    // Save category if it hasn't been saved yet
    if (category.trim() && category.trim() !== game.category) {
      saveCategory();
    }
    // Save timer if it hasn't been saved yet
    if (game.mode === "classic" && timerSeconds !== game.timerSeconds) {
      saveTimer();
    }
    if (game.mode === "turns" && turnTimerValue !== game.turnTimerSeconds) {
      saveTurnTimer();
    }
    setError("");
    startGame.mutate({
      sessionToken,
      gameId: game.id,
    });
  };

  const suggestTopic = () => {
    const options = TOPIC_SUGGESTIONS.filter((t) => t !== category);
    const pick = options[Math.floor(Math.random() * options.length)]!;
    setCategory(pick);
  };

  const topicSet = !!game.category;
  const needMorePlayers = game.mode === "turns" && game.players.length < 2;
  const timerChanged = timerSeconds !== game.timerSeconds;
  const turnTimerChanged = turnTimerValue !== game.turnTimerSeconds;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h1 className="text-2xl font-bold text-gray-900">lobby</h1>

        <ShareCode code={game.code} />

        <PlayerList
          players={game.players}
          spectators={game.spectators}
          isHost={game.isHost}
          onKick={(playerId) =>
            kickPlayerMutation.mutate({
              sessionToken,
              gameId: game.id,
              playerId,
            })
          }
        />

        {/* Topic & timer — visible to all, editable by host */}
        {game.isHost ? (
          <div className="flex w-full flex-col gap-4">
            {/* Mode selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">mode</label>
              <div className="flex flex-1 gap-2">
                <button
                  onClick={() =>
                    game.mode !== "classic" &&
                    setModeMutation.mutate({
                      sessionToken,
                      gameId: game.id,
                      mode: "classic",
                    })
                  }
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    game.mode === "classic"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  classic
                </button>
                <button
                  onClick={() =>
                    game.mode !== "turns" &&
                    setModeMutation.mutate({
                      sessionToken,
                      gameId: game.id,
                      mode: "turns",
                    })
                  }
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    game.mode === "turns"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  last one standing
                </button>
              </div>
            </div>

            <div className="flex w-full items-center gap-2">
              <label className="text-sm text-gray-500">topic</label>
              <input
                type="text"
                placeholder="e.g. types of cheese"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={saveCategory}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCategory();
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
              />
              <button
                onClick={saveCategory}
                disabled={
                  setCategoryMutation.isPending ||
                  !category.trim() ||
                  category.trim() === game.category
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                {setCategoryMutation.isPending ? "..." : "set"}
              </button>
              <button
                onClick={suggestTopic}
                className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-400 transition hover:border-gray-400 hover:text-gray-600"
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
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-500">timer</label>
                  <input
                    type="number"
                    min={1}
                    value={timerValue}
                    onChange={(e) => setTimerValue(Math.max(1, Number(e.target.value)))}
                    className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
                  />
                  <select
                    value={timerUnit}
                    onChange={(e) =>
                      setTimerUnit(e.target.value as "seconds" | "minutes")
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
                  >
                    <option value="seconds">seconds</option>
                    <option value="minutes">minutes</option>
                  </select>
                  <button
                    onClick={saveTimer}
                    disabled={
                      setTimerMutation.isPending || !timerChanged
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
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
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-500">turn timer</label>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={turnTimerValue}
                    onChange={(e) => setTurnTimerValue(Math.max(3, Math.min(30, Number(e.target.value))))}
                    className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-gray-900"
                  />
                  <span className="text-sm text-gray-500">seconds</span>
                  <button
                    onClick={saveTurnTimer}
                    disabled={
                      setTurnTimerMutation.isPending || !turnTimerChanged
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
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
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
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
              className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {joinAsPlayer.isPending ? "joining..." : "join as player"}
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-4">
            <p className="text-sm text-gray-500">
              mode: <span className="font-medium text-gray-900">{game.mode === "classic" ? "classic" : "last one standing"}</span>
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
