export function ScoreSummary({
  score,
  validCount,
  invalidCount,
  ambiguousCount,
}: {
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
}) {
  return (
    <div className="flex w-full justify-center gap-8">
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold text-gray-900">{score}</span>
        <span className="text-xs text-gray-400">score</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold text-green-600">{validCount}</span>
        <span className="text-xs text-gray-400">valid</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold text-red-600">{invalidCount}</span>
        <span className="text-xs text-gray-400">invalid</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold text-yellow-600">
          {ambiguousCount}
        </span>
        <span className="text-xs text-gray-400">ambiguous</span>
      </div>
    </div>
  );
}
