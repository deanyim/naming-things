export const TIMER_OPTIONS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 120, label: "2m" },
  { value: 180, label: "3m" },
  { value: 300, label: "5m" },
  { value: 600, label: "10m" },
] as const;

export const ALLOWED_TIMERS: readonly number[] = TIMER_OPTIONS.map(
  (o) => o.value,
);
