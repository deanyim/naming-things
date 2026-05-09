"use client";

import { useState } from "react";
import { api } from "~/trpc/react";

export function CategorySearch({
  value,
  onChange,
  onSlugChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSlugChange?: (slug: string) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);

  const searchResults = api.solo.searchCategories.useQuery(
    { query: value, limit: 5 },
    { enabled: value.length >= 2 && isFocused },
  );

  return (
    <div className="relative w-full">
      <input
        type="text"
        placeholder="enter a category (e.g. fruits, countries)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        className="min-h-12 w-full rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
      />
      {isFocused &&
        searchResults.data &&
        searchResults.data.length > 0 && (
          <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
            {searchResults.data.map((item) => (
              <button
                key={item.categorySlug}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(item.categoryDisplayName);
                  onSlugChange?.(item.categorySlug);
                  setIsFocused(false);
                }}
                className="min-h-11 w-full px-4 py-2 text-left text-sm text-gray-700 transition first:rounded-t-lg last:rounded-b-lg hover:bg-gray-100"
              >
                {item.categoryDisplayName}
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
