"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function SoloRun({
  slug,
  onFinished,
}: {
  slug: string;
  onFinished: () => void;
}) {
  const { sessionToken } = useSession();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const hasAutoFinished = useRef(false);
  const pendingMutations = useRef(0);

  const runQuery = api.solo.getRun.useQuery(
    { sessionToken, slug },
    {
      enabled: !!sessionToken,
      refetchInterval: false,
    },
  );

  const run = runQuery.data;

  const utils = api.useUtils();

  const submitAnswer = api.solo.submitAnswer.useMutation({
    onMutate: async (variables) => {
      pendingMutations.current++;
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await utils.solo.getRun.cancel({ sessionToken, slug });

      const previous = utils.solo.getRun.getData({ sessionToken, slug });

      // Optimistically add the answer
      if (previous) {
        utils.solo.getRun.setData({ sessionToken, slug }, {
          ...previous,
          answers: [
            ...previous.answers,
            {
              id: -Date.now(), // temporary id
              runId: previous.id,
              playerId: previous.playerId,
              text: variables.text.trim(),
              normalizedText: variables.text.trim().toLowerCase(),
              isDuplicate: false,
              label: null,
              confidence: null,
              reason: null,
              createdAt: new Date(),
            },
          ],
        });
      }

      setInput("");
      setError("");
      inputRef.current?.focus();

      return { previous };
    },
    onError: (err, _variables, context) => {
      // Roll back to previous state
      if (context?.previous) {
        utils.solo.getRun.setData({ sessionToken, slug }, context.previous);
      }
      setError(err.message);
      setTimeout(() => setError(""), 2000);
      inputRef.current?.focus();
    },
    onSettled: () => {
      pendingMutations.current--;
      // Only sync with server once all in-flight submissions have settled,
      // otherwise the refetch can overwrite optimistic updates from newer submissions.
      if (pendingMutations.current === 0) {
        void utils.solo.getRun.invalidate({ sessionToken, slug });
      }
    },
  });

  const finishRun = api.solo.finishRun.useMutation({
    onSuccess: () => {
      void runQuery.refetch();
      onFinished();
    },
    onError: (err) => {
      setIsFinishing(false);
      hasAutoFinished.current = false;
      setError(err.message);
    },
  });

  const handleFinish = useCallback(() => {
    if (isFinishing || finishRun.isPending) return;
    setIsFinishing(true);
    finishRun.mutate({ sessionToken, slug });
  }, [sessionToken, slug, isFinishing, finishRun]);

  // Countdown timer: only starts after run data loads.
  // Avoids the stale isExpired=true from useCountdown(undefined).
  useEffect(() => {
    if (!run) return;

    const endsAt =
      new Date(run.startedAt).getTime() + run.timerSeconds * 1000;

    function tick() {
      const remaining = Math.max(
        0,
        Math.ceil((endsAt - Date.now()) / 1000),
      );
      setSecondsRemaining(remaining);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [run?.startedAt, run?.timerSeconds]);

  // Auto-finish via setTimeout
  useEffect(() => {
    if (!run || run.status !== "playing" || hasAutoFinished.current) return;

    const endsAt =
      new Date(run.startedAt).getTime() + run.timerSeconds * 1000;
    const remaining = endsAt - Date.now();

    if (remaining <= 0) {
      hasAutoFinished.current = true;
      handleFinish();
      return;
    }

    const timeout = setTimeout(() => {
      if (!hasAutoFinished.current) {
        hasAutoFinished.current = true;
        handleFinish();
      }
    }, remaining);

    return () => clearTimeout(timeout);
  }, [run, handleFinish]);

  // null = not loaded yet, 0 = expired
  const isExpired = secondsRemaining !== null && secondsRemaining <= 0;
  const displaySeconds = secondsRemaining ?? 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Read directly from the DOM ref so form submission works even when
    // React state hasn't re-rendered yet (e.g. Playwright's fill + Enter).
    const text = inputRef.current?.value?.trim() ?? input.trim();
    if (!text || isExpired) return;
    submitAnswer.mutate({
      sessionToken,
      slug,
      text,
    });
  };

  if (!run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-400">loading...</p>
      </div>
    );
  }

  const nonDuplicateAnswers = run.answers.filter((a) => !a.isDuplicate);
  const isUrgent = displaySeconds <= 10 && displaySeconds > 0;

  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {run.categoryDisplayName}
            </h2>
            <p className="text-xs text-gray-400">solo mode</p>
          </div>
          <div
            className={`font-mono text-2xl font-bold ${
              isUrgent ? "text-red-600" : "text-gray-900"
            }`}
          >
            {displaySeconds}s
          </div>
        </div>

        {isFinishing ? (
          <p className="text-center text-gray-500">
            judging your answers...
          </p>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex w-full gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="type an answer..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isExpired}
                autoFocus
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isExpired || !input.trim()}
                className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
              >
                add
              </button>
            </form>

            {error && (
              <p className="text-center text-sm text-red-600">{error}</p>
            )}

            <button
              onClick={handleFinish}
              disabled={nonDuplicateAnswers.length === 0}
              className="text-sm text-gray-400 transition hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-400"
            >
              finish early
            </button>
          </>
        )}

        <div className="w-full">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              answers ({nonDuplicateAnswers.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {nonDuplicateAnswers.map((answer) => (
              <span
                key={answer.id}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
              >
                {answer.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
