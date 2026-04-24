import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultFilterState,
  firstDayOfMonth,
  resolveDashboardDateRange,
} from "../src/lib/dashboard-range.ts";

test("resolveDashboardDateRange defaults blank requests to the current month", () => {
  assert.deepStrictEqual(resolveDashboardDateRange({}, "2026-04-23"), {
    startDate: "2026-04-01",
    endDate: "2026-04-23",
  });
});

test("resolveDashboardDateRange anchors a missing start date to the month of the chosen end date", () => {
  assert.deepStrictEqual(resolveDashboardDateRange({ endDate: "2026-02-15" }, "2026-04-23"), {
    startDate: "2026-02-01",
    endDate: "2026-02-15",
  });
});

test("buildDefaultFilterState uses the current month for the dashboard defaults", () => {
  assert.deepStrictEqual(buildDefaultFilterState("2026-04-23"), {
    startDate: "2026-04-01",
    endDate: "2026-04-23",
    families: [],
  });
});

test("firstDayOfMonth returns the YYYY-MM-01 companion date", () => {
  assert.equal(firstDayOfMonth("2026-12-18"), "2026-12-01");
});
