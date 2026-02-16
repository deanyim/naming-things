"use client";

import { api } from "~/trpc/react";

interface DisputeVote {
  id: number;
  voterPlayerId: number;
  accept: boolean;
}

interface Answer {
  id: number;
  text: string;
  playerId: number;
  status: "accepted" | "disputed" | "rejected";
  player: { id: number; displayName: string };
  disputeVotes: DisputeVote[];
}

export function DisputeAnswerCard({
  answer,
  sessionToken,
  myPlayerId,
  isSpectator,
}: {
  answer: Answer;
  sessionToken: string;
  myPlayerId: number;
  isSpectator?: boolean;
}) {
  const utils = api.useUtils();
  const castVote = api.game.castVote.useMutation({
    onSuccess: () => utils.game.getAllAnswers.invalidate(),
  });

  const myVote = answer.disputeVotes.find(
    (v) => v.voterPlayerId === myPlayerId,
  );
  const isOwnAnswer = answer.playerId === myPlayerId;
  const acceptVotes = answer.disputeVotes.filter((v) => v.accept).length;
  const rejectVotes = answer.disputeVotes.filter((v) => !v.accept).length;

  const showVoteButtons = !isOwnAnswer && !isSpectator;

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-gray-900">{answer.text}</span>
          <span className="ml-2 text-xs text-gray-400">
            by {answer.player.displayName}
          </span>
        </div>
        <span className="text-xs text-yellow-600">disputed</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        {showVoteButtons ? (
          <>
            <button
              onClick={() =>
                castVote.mutate({
                  sessionToken,
                  answerId: answer.id,
                  accept: true,
                })
              }
              disabled={castVote.isPending}
              className={`rounded px-3 py-1 text-sm transition ${
                myVote?.accept === true
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-green-100"
              }`}
            >
              accept ({acceptVotes})
            </button>
            <button
              onClick={() =>
                castVote.mutate({
                  sessionToken,
                  answerId: answer.id,
                  accept: false,
                })
              }
              disabled={castVote.isPending}
              className={`rounded px-3 py-1 text-sm transition ${
                myVote?.accept === false
                  ? "bg-red-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-red-100"
              }`}
            >
              reject ({rejectVotes})
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-400">
            accept: {acceptVotes} / reject: {rejectVotes}
          </span>
        )}
      </div>
    </div>
  );
}
