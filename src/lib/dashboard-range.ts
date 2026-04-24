import type { FilterState } from "../types";

export interface DashboardDateRangeInput {
  startDate?: string;
  endDate?: string;
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function firstDayOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function resolveDashboardDateRange(
  input: DashboardDateRangeInput,
  fallbackDate = todayDate(),
) {
  const endDate = input.endDate || fallbackDate;
  const startDate = input.startDate || firstDayOfMonth(endDate);

  return { startDate, endDate };
}

export function buildDefaultFilterState(referenceDate = todayDate()): FilterState {
  return {
    startDate: firstDayOfMonth(referenceDate),
    endDate: referenceDate,
    families: [],
  };
}
