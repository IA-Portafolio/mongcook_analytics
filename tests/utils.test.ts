import test from "node:test";
import assert from "node:assert/strict";
import { formatCompact, formatCurrency, formatPercent } from "../src/lib/utils.ts";

test("formatCurrency uses Colombian pesos grouping, not USD cents", () => {
  assert.equal(formatCurrency(67375400), "$67.375.400");
  assert.equal(formatCurrency(-4531850), "-$4.531.850");
  assert.equal(formatCurrency(0), "$0");
});

test("formatCompact uses mill. so amounts are not read as US dollars", () => {
  assert.equal(formatCompact(29200000), "$29,2 mill.");
  assert.equal(formatCompact(1700000), "$1,7 mill.");
  assert.equal(formatCompact(15000), "$15 mil");
  assert.equal(formatCompact(8500), "$8.500");
});

test("formatPercent uses Colombian decimal comma", () => {
  assert.equal(formatPercent(0.664), "66,4%");
});
