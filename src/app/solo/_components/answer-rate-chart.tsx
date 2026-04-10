"use client";

import { useRef, useState } from "react";

type Answer = {
  createdAt: Date | string;
  isDuplicate: boolean;
  label?: string | null;
};

type Mode = "all" | "valid" | "both";

/**
 * Compute cumulative count of non-duplicate answers at each second of the run.
 * Returns an array of [elapsedSeconds, cumulativeCount] pairs.
 * When validOnly is true, only answers with label === "valid" are counted.
 */
export function computeCumulativeSeries(
  answers: Answer[],
  startedAt: Date | string,
  durationSeconds: number,
  validOnly = false,
): { second: number; count: number }[] {
  const start = new Date(startedAt).getTime();
  const filtered = answers.filter((a) => {
    if (a.isDuplicate) return false;
    if (validOnly && a.label !== "valid") return false;
    return true;
  });
  const elapsedSeconds = filtered
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

const ALL_COLOR = "#111827";
const VALID_COLOR = "#10b981";

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
  const [mode, setMode] = useState<Mode>("all");

  const allSeries = computeCumulativeSeries(
    answers,
    startedAt,
    timerSeconds,
    false,
  );
  const validSeries = computeCumulativeSeries(
    answers,
    startedAt,
    timerSeconds,
    true,
  );

  // maxCount should reflect whatever's visible so the chart auto-scales
  const visibleMax =
    mode === "valid"
      ? validSeries[validSeries.length - 1]?.count ?? 0
      : allSeries[allSeries.length - 1]?.count ?? 0;
  const maxCount = Math.max(1, visibleMax);

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

  function buildPath(series: { second: number; count: number }[]) {
    return series
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.second).toFixed(2)} ${yFor(p.count).toFixed(2)}`)
      .join(" ");
  }

  function buildAreaPath(pathD: string) {
    return (
      pathD +
      ` L ${xFor(timerSeconds).toFixed(2)} ${(padTop + plotHeight).toFixed(2)}` +
      ` L ${xFor(0).toFixed(2)} ${(padTop + plotHeight).toFixed(2)} Z`
    );
  }

  const allPathD = buildPath(allSeries);
  const validPathD = buildPath(validSeries);

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.round(maxCount / 2), maxCount];
  // X-axis ticks — 5 evenly spaced
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((i * timerSeconds) / 4));

  function handleMouseMove(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * width;
    const second = Math.max(
      0,
      Math.min(
        timerSeconds,
        Math.round(((viewX - padLeft) / plotWidth) * timerSeconds),
      ),
    );
    setHoverIdx(second);
  }

  const showAll = mode === "all" || mode === "both";
  const showValid = mode === "valid" || mode === "both";

  const hoveredAll = hoverIdx !== null ? allSeries[hoverIdx] : null;
  const hoveredValid = hoverIdx !== null ? validSeries[hoverIdx] : null;

  // Tooltip anchors to the higher of the two visible lines
  const tooltipAnchorY =
    hoverIdx !== null
      ? Math.min(
          showAll && hoveredAll ? yFor(hoveredAll.count) : Infinity,
          showValid && hoveredValid ? yFor(hoveredValid.count) : Infinity,
        )
      : 0;
  const tooltipX = hoverIdx !== null ? xFor(hoverIdx) : 0;
  const flipLeft = tooltipX > width - 110;
  const tooltipBoxWidth = mode === "both" ? 100 : 90;
  const tooltipBoxHeight = mode === "both" ? 44 : 32;
  const tooltipBoxX = flipLeft ? tooltipX - 8 - tooltipBoxWidth : tooltipX + 8;
  const tooltipBoxY = tooltipAnchorY - tooltipBoxHeight + 4;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">answers over time</h3>
        <div className="flex gap-1 rounded-md border border-gray-200 p-0.5">
          {(["all", "valid", "both"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                mode === m
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {m === "all" ? "all" : m === "valid" ? "valid only" : "both"}
            </button>
          ))}
        </div>
      </div>
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

        {/* All series */}
        {showAll && (
          <>
            <path
              d={buildAreaPath(allPathD)}
              fill={ALL_COLOR}
              fillOpacity={mode === "both" ? 0.05 : 0.08}
            />
            <path d={allPathD} fill="none" stroke={ALL_COLOR} strokeWidth={2} />
          </>
        )}

        {/* Valid series */}
        {showValid && (
          <>
            <path
              d={buildAreaPath(validPathD)}
              fill={VALID_COLOR}
              fillOpacity={mode === "both" ? 0.1 : 0.12}
            />
            <path
              d={validPathD}
              fill="none"
              stroke={VALID_COLOR}
              strokeWidth={2}
            />
          </>
        )}

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

        {/* Legend for "both" mode */}
        {mode === "both" && (
          <g>
            <line
              x1={padLeft + 6}
              x2={padLeft + 18}
              y1={padTop + 8}
              y2={padTop + 8}
              stroke={ALL_COLOR}
              strokeWidth={2}
            />
            <text
              x={padLeft + 22}
              y={padTop + 11}
              className="fill-gray-500 text-[10px]"
            >
              all
            </text>
            <line
              x1={padLeft + 44}
              x2={padLeft + 56}
              y1={padTop + 8}
              y2={padTop + 8}
              stroke={VALID_COLOR}
              strokeWidth={2}
            />
            <text
              x={padLeft + 60}
              y={padTop + 11}
              className="fill-gray-500 text-[10px]"
            >
              valid
            </text>
          </g>
        )}

        {/* Hover crosshair + points + tooltip */}
        {hoverIdx !== null && (
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
            {showAll && hoveredAll && (
              <circle
                cx={tooltipX}
                cy={yFor(hoveredAll.count)}
                r={4}
                fill={ALL_COLOR}
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            {showValid && hoveredValid && (
              <circle
                cx={tooltipX}
                cy={yFor(hoveredValid.count)}
                r={4}
                fill={VALID_COLOR}
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            <rect
              x={tooltipBoxX}
              y={tooltipBoxY}
              width={tooltipBoxWidth}
              height={tooltipBoxHeight}
              rx={4}
              fill="#111827"
            />
            <text
              x={tooltipBoxX + 8}
              y={tooltipBoxY + 14}
              className="fill-white text-[10px]"
            >
              {hoverIdx}s elapsed
            </text>
            {mode === "both" ? (
              <>
                <text
                  x={tooltipBoxX + 8}
                  y={tooltipBoxY + 26}
                  className="fill-white text-[10px]"
                >
                  all: <tspan className="font-bold">{hoveredAll?.count ?? 0}</tspan>
                </text>
                <text
                  x={tooltipBoxX + 8}
                  y={tooltipBoxY + 38}
                  className="fill-white text-[10px]"
                >
                  valid: <tspan className="font-bold">{hoveredValid?.count ?? 0}</tspan>
                </text>
              </>
            ) : (
              <text
                x={tooltipBoxX + 8}
                y={tooltipBoxY + 26}
                className="fill-white text-[10px] font-bold"
              >
                {mode === "valid"
                  ? hoveredValid?.count ?? 0
                  : hoveredAll?.count ?? 0}
                {mode === "valid" ? " valid" : ""}
                {(mode === "valid"
                  ? hoveredValid?.count ?? 0
                  : hoveredAll?.count ?? 0) === 1
                  ? " answer"
                  : " answers"}
              </text>
            )}
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
