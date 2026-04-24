import test from "node:test";
import assert from "node:assert/strict";
import { clampEndDateToLastClosedShift } from "../toteat.ts";

test("clampEndDateToLastClosedShift excludes the currently open shift date", () => {
  assert.equal(
    clampEndDateToLastClosedShift("2026-04-24", {
      status: "open",
      date: "2026-04-23T19:42:50",
    }),
    "2026-04-22",
  );
});

test("clampEndDateToLastClosedShift leaves historical ranges untouched", () => {
  assert.equal(
    clampEndDateToLastClosedShift("2026-04-20", {
      status: "open",
      date: "2026-04-23T19:42:50",
    }),
    "2026-04-20",
  );
});

test("clampEndDateToLastClosedShift does nothing when there is no open shift", () => {
  assert.equal(
    clampEndDateToLastClosedShift("2026-04-24", {
      status: "closed",
      date: "2026-04-23T19:42:50",
    }),
    "2026-04-24",
  );
});
