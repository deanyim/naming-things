"use client";

import { useRef, useState } from "react";

type Answer = {
  createdAt: Date | string;
  isDuplicate: boolean;
};

/**
 * Compute cumulative count of non-duplicate answers at each second of the run.
 * Returns an array of [elapsedSeconds, cumulativeCount] pairs.
 */
export function computeCumulativeSeries(
  answers: Answer[],
  startedAt: Date | string,
  durationSeconds: number,
): { second: number; count: number }[] {
  const start = new Date(startedAt).getTime();
  const nonDuplicates = answers.filter((a) => !a.isDuplicate);
  const elapsedSeconds = nonDuplicates
    .map((a) => Math.max(0, Math.floor((new Date(a.createdAt).getTime() - start) / 1000)))
    .sort((a, b) => a - b);

  const series: { second: number; count: number }[] = [];
  let cumulative = 0;
  let answerIdx = 0;
  for (let s = 0; s <= durationSeconds; s++) {
    while (answerIdx < elapsedSeconds.length && elapsedSeconds[answerIdx]! <= s) {
      cumulative++;
      answerIdx++;
    }
    series.push({ second: s, count: cumulative });
  }
  return series;
}

export function AnswerRateChart({
  answers,
  startedAt,
  timerSeconds,
}: {
  answers: Answer[];
  startedAt: Date | string;
  timerSeconds: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = computeCumulativeSeries(answers, startedAt, timerSeconds);
  const maxCount = Math.max(1, series[series.length - 1]?.count ?? 0);

  const width = 600;
  const height = 200;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const xFor = (second: number) =>
    padLeft + (second / timerSeconds) * plotWidth;
  const yFor = (count: number) =>
    padTop + plotHeight - (count / maxCount) * plotHeight;

  const pathD = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.second).toFixed(2)} ${yFor(p.count).toFixed(2)}`)
    .join(" ");

  const areaD =
    pathD +
    ` L ${xFor(timerSeconds).toFixed(2)} ${(padTop + plotHeight).toFixed(2)}` +
    ` L ${xFor(0).toFixed(2)} ${(padTop + plotHeight).toFixed(2)} Z`;

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.round(maxCount / 2), maxCount];
  // X-axis ticks — 5 evenly spaced
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((i * timerSeconds) / 4));

  function handleMouseMove(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert mouse x to viewBox coordinates
    const viewX = ((e.clientX - rect.left) / rect.width) * width;
    // Convert viewBox x back to seconds
    const second = Math.max(
      0,
      Math.min(
        timerSeconds,
        Math.round(((viewX - padLeft) / plotWidth) * timerSeconds),
      ),
    );
    setHoverIdx(second);
  }

  const hovered = hoverIdx !== null ? series[hoverIdx] : null;

  // Tooltip positioning — flip to the left if too close to the right edge
  const tooltipX = hovered ? xFor(hovered.second) : 0;
  const tooltipY = hovered ? yFor(hovered.count) : 0;
  const flipLeft = tooltipX > width - 100;
  const tooltipBoxX = flipLeft ? tooltipX - 8 - 90 : tooltipX + 8;

  return (
    <div className="w-full">
      <h3 className="mb-2 text-sm font-medium text-gray-500">
        answers over time
      </h3>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-lg border border-gray-200 bg-white"
        preserveAspectRatio="none"
      >
        {/* Gridlines */}
        {yTicks.map((t) => (
          <line
            key={`grid-${t}`}
            x1={padLeft}
            x2={width - padRight}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="#f3f4f6"
            strokeWidth={1}
          />
        ))}

        {/* Area fill */}
        <path d={areaD} fill="#111827" fillOpacity={0.08} />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#111827" strokeWidth={2} />

        {/* Y-axis labels */}
        {yTicks.map((t) => (
          <text
            key={`ylabel-${t}`}
            x={padLeft - 6}
            y={yFor(t) + 3}
            textAnchor="end"
            className="fill-gray-400 text-[10px]"
          >
            {t}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t) => (
          <text
            key={`xlabel-${t}`}
            x={xFor(t)}
            y={height - 8}
            textAnchor="middle"
            className="fill-gray-400 text-[10px]"
          >
            {t}s
          </text>
        ))}

        {/* Hover crosshair + point + tooltip */}
        {hovered && (
          <g pointerEvents="none">
            <line
              x1={tooltipX}
              x2={tooltipX}
              y1={padTop}
              y2={padTop + plotHeight}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={tooltipX}
              cy={tooltipY}
              r={4}
              fill="#111827"
              stroke="#fff"
              strokeWidth={2}
            />
            <rect
              x={tooltipBoxX}
              y={tooltipY - 28}
              width={90}
              height={32}
              rx={4}
              fill="#111827"
            />
            <text
              x={tooltipBoxX + 8}
              y={tooltipY - 14}
              className="fill-white text-[10px]"
            >
              {hovered.second}s elapsed
            </text>
            <text
              x={tooltipBoxX + 8}
              y={tooltipY - 2}
              className="fill-white text-[10px] font-bold"
            >
              {hovered.count} {hovered.count === 1 ? "answer" : "answers"}
            </text>
          </g>
        )}

        {/* Invisible overlay to capture mouse events */}
        <rect
          x={padLeft}
          y={padTop}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        />
      </svg>
    </div>
  );
}
