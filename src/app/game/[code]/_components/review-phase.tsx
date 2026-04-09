"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { DisputeAnswerCard } from "./dispute-answer-card";
import type { GameState } from "./types";

export function ReviewPhase({
  game,
  sessionToken,
}: {
  game: GameState;
  sessionToken: string;
}) {
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const allAnswers = api.game.getAllAnswers.useQuery(
    { sessionToken, gameId: game.id },
    { refetchInterval: 5000 },
  );

  const disputeAnswer = api.game.disputeAnswer.useMutation({
    onSuccess: () => utils.game.getAllAnswers.invalidate(),
  });

  const finishGame = api.game.finishGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
    onError: (err) => setError(err.message),
  });

  const retryAutoClassification = api.game.retryAutoClassification.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.game.getAllAnswers.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const isLoading = allAnswers.isLoading;
  const groups = allAnswers.data?.groups ?? [];
  const classifying = allAnswers.data?.classifying ?? false;
  const canManuallyClassify = allAnswers.data?.canManuallyClassify ?? false;
  const commonGroups = groups.filter((g) => g.isCommon);
  const nonCommon = groups.filter((g) => !g.isCommon);

  // Split non-common answers: ambiguous/disputed/unclassified go to "needs review",
  // definitively classified (valid/invalid) go to "auto-classified"
  const needsReview = nonCommon.filter((g) =>
    g.answers.some(
      (a) =>
        a.status === "disputed" ||
        !a.verification ||
        a.verification.label === "ambiguous",
    ),
  );
  const autoClassified = nonCommon.filter(
    (g) =>
      !g.answers.some(
        (a) =>
          a.status === "disputed" ||
          !a.verification ||
          a.verification.label === "ambiguous",
      ),
  );

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <h2 className="text-2xl font-bold text-gray-900">review answers</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            <p className="text-sm text-gray-400">loading answers...</p>
          </div>
        )}

        {classifying && !isLoading && (
          <div className="w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <p className="text-sm text-blue-700">classifying answers...</p>
          </div>
        )}

        {error && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Needs Review Section */}
        {!isLoading && !classifying && <div className="w-full space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            needs review
          </h3>
          {needsReview.length === 0 ? (
            <p className="text-sm text-gray-400">
              all answers matched — nothing to review!
            </p>
          ) : (
            needsReview.map((group) => (
              <div key={group.normalizedText} className="space-y-2">
                {group.answers.map((answer) => {
                  if (answer.status === "disputed") {
                    return (
                      <DisputeAnswerCard
                        key={answer.id}
                        answer={answer}
                        sessionToken={sessionToken}
                        myPlayerId={game.myPlayerId}
                        isSpectator={game.isSpectator}
                      />
                    );
                  }

                  const isRejected = answer.status === "rejected";

                  return (
                    <div
                      key={answer.id}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        isRejected
                          ? "border-red-200 bg-red-50"
                          : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <div>
                        <span
                          className={`font-medium ${
                            isRejected
                              ? "text-gray-400 line-through"
                              : "text-gray-900"
                          }`}
                        >
                          {answer.text}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          by {answer.player.displayName}
                          {game.isTeamMode && group.teamId != null && (
                            <> (team {group.teamId})</>
                          )}
                        </span>
                        {isRejected && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                            rejected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!game.isSpectator && (
                          <button
                            onClick={() =>
                              disputeAnswer.mutate({
                                sessionToken,
                                answerId: answer.id,
                              })
                            }
                            disabled={disputeAnswer.isPending}
                            className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-red-100 hover:text-red-600"
                          >
                            dispute
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>}

        {/* Auto-Classified Section */}
        {autoClassified.length > 0 && (
          <details className="w-full">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500">
              auto-classified ({autoClassified.length})
            </summary>
            <div className="mt-3 space-y-2">
              {autoClassified.map((group) =>
                group.answers.map((answer) => {
                  const isRejected = answer.status === "rejected";
                  return (
                    <div
                      key={answer.id}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        isRejected
                          ? "border-red-200 bg-red-50"
                          : "border-green-200 bg-green-50"
                      }`}
                    >
                      <div>
                        <span
                          className={`font-medium ${
                            isRejected
                              ? "text-gray-400 line-through"
                              : "text-gray-900"
                          }`}
                        >
                          {answer.text}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          by {answer.player.displayName}
                        </span>
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                            isRejected
                              ? "bg-red-100 text-red-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {isRejected ? "rejected" : "accepted"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!game.isSpectator && (
                          <button
                            onClick={() =>
                              disputeAnswer.mutate({
                                sessionToken,
                                answerId: answer.id,
                              })
                            }
                            disabled={disputeAnswer.isPending}
                            className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-red-100 hover:text-red-600"
                          >
                            dispute
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }),
              )}
            </div>
          </details>
        )}

        {/* Common / Shared Section */}
        {commonGroups.length > 0 && (
          <details className="w-full">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500">
              {game.isTeamMode ? "shared across teams" : "common answers"} ({commonGroups.length})
            </summary>
            <div className="mt-3 space-y-2">
              {commonGroups.map((group) => (
                <div
                  key={group.normalizedText}
                  className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
                >
                  <div>
                    <span className="font-medium text-gray-900">
                      {group.answers[0]!.text}
                    </span>
                    <span className="ml-2 text-xs text-green-600">
                      {group.answers.length} player{group.answers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {!game.isSpectator && (
                    <button
                      onClick={() =>
                        disputeAnswer.mutate({
                          sessionToken,
                          answerId: group.answers[0]!.id,
                        })
                      }
                      disabled={disputeAnswer.isPending}
                      className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-red-100 hover:text-red-600"
                    >
                      dispute
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {groups.length === 0 && !isLoading && !classifying && (
          <p className="text-gray-400">no answers submitted</p>
        )}

        {game.isHost && (
          <div className="flex w-full flex-col gap-3">
            {canManuallyClassify && (
              <button
                onClick={() =>
                  retryAutoClassification.mutate({ sessionToken, gameId: game.id })
                }
                disabled={retryAutoClassification.isPending || finishGame.isPending}
                className="w-full rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
              >
                {retryAutoClassification.isPending
                  ? "retrying auto-classification..."
                  : "retry auto-classification"}
              </button>
            )}

            <button
              onClick={() =>
                finishGame.mutate({ sessionToken, gameId: game.id })
              }
              disabled={finishGame.isPending || retryAutoClassification.isPending}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              {finishGame.isPending ? "tallying scores..." : "finish & score"}
            </button>
          </div>
        )}

        {!game.isHost && !game.isSpectator && (
          <p className="text-center text-gray-500">
            review answers above. the host will finalize scores.
          </p>
        )}

        {game.isSpectator && (
          <p className="text-center text-gray-400">
            you are spectating this review
          </p>
        )}
      </div>
    </main>
  );
}
