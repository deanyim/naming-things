"use client";

interface Answer {
  id: number;
  text: string;
}

export function MyAnswersList({ answers }: { answers: Answer[] }) {
  if (answers.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-500">
        your answers ({answers.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {answers.map((a) => (
          <span
            key={a.id}
            className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
          >
            {a.text}
          </span>
        ))}
      </div>
    </div>
  );
}
