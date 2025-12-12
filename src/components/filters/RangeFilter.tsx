"use client";

import { RangeValue } from "@/types/filters";

interface RangeFilterProps {
  label: string;
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  options: { label: string; value: RangeValue }[];
}

export function RangeFilter({
  label,
  value,
  onChange,
  options,
}: RangeFilterProps) {
  const currentKey =
    value.min === null && value.max === null
      ? ""
      : JSON.stringify(value);

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      <select
        value={currentKey}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange({ min: null, max: null });
          } else {
            onChange(JSON.parse(e.target.value));
          }
        }}
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option
            key={opt.label}
            value={
              opt.value.min === null && opt.value.max === null
                ? ""
                : JSON.stringify(opt.value)
            }
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
