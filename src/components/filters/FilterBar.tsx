"use client";

import { ReactNode } from "react";
import { hasActiveFilters, FilterState } from "@/types/filters";

interface FilterBarProps {
  filters: FilterState;
  onClearAll: () => void;
  children: ReactNode;
}

export function FilterBar({ filters, onClearAll, children }: FilterBarProps) {
  const isActive = hasActiveFilters(filters);

  return (
    <div className="mb-4 p-4 bg-white rounded-lg shadow border border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700">Filters</span>
        {isActive && (
          <button
            onClick={onClearAll}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {children}
      </div>
    </div>
  );
}
