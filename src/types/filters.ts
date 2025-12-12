// Reusable filter types for the application

export type FilterType = "select" | "range" | "search" | "date-range" | "multi-select";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterConfig {
  id: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
}

export interface RangeValue {
  min: number | null;
  max: number | null;
}

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

// Generic filter state - can hold any filter value
export type FilterValue = string | RangeValue | DateRangeValue | string[] | null;

export interface FilterState {
  [filterId: string]: FilterValue;
}

// Predefined range options
export const EMPLOYEE_SIZE_RANGES: { label: string; value: RangeValue }[] = [
  { label: "All Sizes", value: { min: null, max: null } },
  { label: "1-10", value: { min: 1, max: 10 } },
  { label: "11-50", value: { min: 11, max: 50 } },
  { label: "51-200", value: { min: 51, max: 200 } },
  { label: "201-500", value: { min: 201, max: 500 } },
  { label: "501-1000", value: { min: 501, max: 1000 } },
  { label: "1001-5000", value: { min: 1001, max: 5000 } },
  { label: "5000+", value: { min: 5001, max: null } },
];

export const FUNDING_AMOUNT_RANGES: { label: string; value: RangeValue }[] = [
  { label: "All Amounts", value: { min: null, max: null } },
  { label: "No Funding", value: { min: 0, max: 0 } },
  { label: "< $1M", value: { min: 1, max: 999999 } },
  { label: "$1M - $10M", value: { min: 1000000, max: 10000000 } },
  { label: "$10M - $50M", value: { min: 10000001, max: 50000000 } },
  { label: "$50M - $100M", value: { min: 50000001, max: 100000000 } },
  { label: "$100M+", value: { min: 100000001, max: null } },
];

export const FUNDING_ROUNDS_RANGES: { label: string; value: RangeValue }[] = [
  { label: "All", value: { min: null, max: null } },
  { label: "No Funding", value: { min: 0, max: 0 } },
  { label: "1 Round", value: { min: 1, max: 1 } },
  { label: "2-3 Rounds", value: { min: 2, max: 3 } },
  { label: "4-5 Rounds", value: { min: 4, max: 5 } },
  { label: "6+ Rounds", value: { min: 6, max: null } },
];

export const FUNDING_RECENCY_OPTIONS: { label: string; value: string }[] = [
  { label: "Any Time", value: "" },
  { label: "Last 6 Months", value: "6m" },
  { label: "Last Year", value: "1y" },
  { label: "Last 2 Years", value: "2y" },
  { label: "Last 5 Years", value: "5y" },
  { label: "No Funding", value: "none" },
];

// Helper to check if a range filter is active
export function isRangeActive(value: RangeValue | null | undefined): boolean {
  if (!value) return false;
  return value.min !== null || value.max !== null;
}

// Helper to check if any filter is active
export function hasActiveFilters(filters: FilterState): boolean {
  return Object.values(filters).some((value) => {
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "object" && "min" in value) {
      return isRangeActive(value as RangeValue);
    }
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

// Helper to parse funding date string like "Feb 2025" to Date
export function parseFundingDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

// Helper to check if a date is within recency period
export function isWithinRecency(dateStr: string | null, recency: string): boolean {
  if (recency === "") return true;
  if (recency === "none") return !dateStr;

  const date = parseFundingDate(dateStr);
  if (!date) return false;

  const now = new Date();
  const monthsAgo = {
    "6m": 6,
    "1y": 12,
    "2y": 24,
    "5y": 60,
  }[recency];

  if (!monthsAgo) return true;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsAgo);

  return date >= cutoff;
}

// Helper to check if a number is within a range
export function isInRange(value: number | null | undefined, range: RangeValue): boolean {
  if (range.min === null && range.max === null) return true;
  if (value === null || value === undefined) return false;

  // Special case: "No Funding" where min and max are both 0
  if (range.min === 0 && range.max === 0) {
    return value === 0;
  }

  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

// Helper to check if ranges overlap (for employee count filtering)
export function rangesOverlap(
  companyMin: number | null,
  companyMax: number | null,
  filterRange: RangeValue
): boolean {
  if (filterRange.min === null && filterRange.max === null) return true;
  if (companyMin === null && companyMax === null) return false;

  const cMin = companyMin ?? 0;
  const cMax = companyMax ?? Infinity;

  if (filterRange.min !== null && cMax < filterRange.min) return false;
  if (filterRange.max !== null && cMin > filterRange.max) return false;

  return true;
}
