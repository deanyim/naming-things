"use client";

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

  const allAnswers = api.game.getAllAnswers.useQuery(
    { sessionToken, gameId: game.id },
    { refetchInterval: 3000 },
  );

  const disputeAnswer = api.game.disputeAnswer.useMutation({
    onSuccess: () => utils.game.getAllAnswers.invalidate(),
  });

  const finishGame = api.game.finishGame.useMutation({
    onSuccess: () => utils.game.getState.invalidate(),
  });

  const groups = allAnswers.data ?? [];
  const needsReview = groups.filter((g) => !g.isCommon);
  const commonGroups = groups.filter((g) => g.isCommon);

  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-4 pt-12">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <h2 className="text-2xl font-bold text-gray-900">review answers</h2>
        <p className="text-sm text-gray-500">{game.category}</p>

        {/* Needs Review Section */}
        <div className="w-full space-y-4">
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
                      />
                    );
                  }

                  return (
                    <div
                      key={answer.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div>
                        <span className="font-medium text-gray-900">
                          {answer.text}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          by {answer.player.displayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {answer.status === "accepted" && (
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
        </div>

        {/* Auto-Accepted Section */}
        {commonGroups.length > 0 && (
          <details className="w-full">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500">
              auto-accepted ({commonGroups.length})
            </summary>
            <div className="mt-3 space-y-2">
              {commonGroups.map((group) => (
                <div
                  key={group.normalizedText}
                  className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
                >
                  <span className="font-medium text-gray-900">
                    {group.answers[0]!.text}
                  </span>
                  <span className="text-xs text-green-600">
                    {group.answers.length} player{group.answers.length !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {groups.length === 0 && (
          <p className="text-gray-400">no answers submitted</p>
        )}

        {game.isHost && (
          <button
            onClick={() =>
              finishGame.mutate({ sessionToken, gameId: game.id })
            }
            disabled={finishGame.isPending}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {finishGame.isPending ? "tallying scores..." : "finish & score"}
          </button>
        )}

        {!game.isHost && (
          <p className="text-center text-gray-500">
            review answers above. the host will finalize scores.
          </p>
        )}
      </div>
    </main>
  );
}
