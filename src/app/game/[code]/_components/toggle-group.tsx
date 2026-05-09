"use client";

export function ToggleGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="text-sm text-gray-500 sm:w-24 sm:shrink-0">{label}</label>
      <div className="flex flex-1 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => value !== option.value && onChange(option.value)}
            className={`min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              value === option.value
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
