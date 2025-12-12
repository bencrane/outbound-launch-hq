"use client";

interface SearchFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchFilter({
  label,
  value,
  onChange,
  placeholder = "Search...",
}: SearchFilterProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
