"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { ShareCode } from "./share-code";
import { PlayerList } from "./player-list";
import type { GameState } from "./types";

const TOPIC_SUGGESTIONS = [
  "types of cheese",
  "things in a toolbox",
  "cartoon characters",
  "pizza toppings",
  "dog breeds",
  "board games",
  "things in a fridge",
  "famous landmarks",
  "ice cream flavors",
  "superheroes",
  "breakfast foods",
  "musical instruments",
  "halloween costumes",
  "vegetables",
  "olympic sports",
  "things in a backpack",
  "movie genres",
  "birds",
  "cocktails",
  "things in a hospital",
  "candy bars",
  "dance moves",
  "things in space",
  "card games",
  "desserts",
  "mythical creatures",
  "pasta shapes",
  "things in a classroom",
  "emojis",
  "types of fish",
  "things in a garage",
  "disney movies",
  "fast food chains",
  "currencies",
  "yoga poses",
  "video game characters",
  "ball sports",
  "salad ingredients",
  "things in a museum",
  "sandwich types",
  "things at a campsite",
  "tv show genres",
  "national parks",
  "sushi rolls",
  "things in an office",
  "fairy tale characters",
  "types of hats",
  "rock bands",
  "fruits",
  "things in a bathroom",
  "types of shoes",
  "animals at a zoo",
  "soup varieties",
  "things in a gym",
  "types of trees",
  "baked goods",
  "things in a library",
  "types of weather",
  "things at an airport",
  "types of dances",
  "car brands",
  "herbs and spices",
  "things in a kitchen",
  "winter sports",
  "rides at a theme park",
  "things that slither",
  "countries in europe",
  "baby names",
  "things on a pizza menu",
  "u.s. states",
  "planet earth animals",
  "things in a toolshed",
  "languages",
  "types of sandwiches",
  "insects",
  "flowers",
  "things in a wallet",
  "cereals",
  "reptiles",
  "modes of transportation",
  "things at a playground",
  "farm animals",
  "things in a pencil case",
  "snack foods",
  "ocean creatures",
  "things in a first aid kit",
  "cat breeds",
  "things at a carnival",
  "camping gear",
  "asian cuisines",
  "things in a suitcase",
  "nuts",
  "berries",
  "things at a baseball game",
  "kitchen utensils",
  "dinosaurs",
  "furniture",
  "things in a vending machine",
  "bodies of water",
  "martial arts",
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

  const setCategoryMutation = api.game.setCategory.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const setTimerMutation = api.game.setTimer.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
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
    if (timerSeconds < 10 || timerSeconds > 3600) {
      setError("Timer must be between 10 seconds and 60 minutes");
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
    if (timerSeconds !== game.timerSeconds) {
      saveTimer();
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
  const timerChanged = timerSeconds !== game.timerSeconds;

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

            <button
              onClick={handleStart}
              disabled={startGame.isPending || !topicSet}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {startGame.isPending ? "starting..." : "start round"}
            </button>

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
            {topicSet ? (
              <p className="text-sm text-gray-500">
                topic: <span className="font-medium text-gray-900">{game.category}</span>
              </p>
            ) : null}
            <p className="text-sm text-gray-500">
              timer: <span className="font-medium text-gray-900">{formatTimer(game.timerSeconds)}</span>
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
