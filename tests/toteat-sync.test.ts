import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "../db.ts";
import { initializeAnalyticsSchema } from "../db.ts";
import { replaceSalesCacheRange } from "../toteat-cache.ts";
import * as sync from "../toteat-sync.ts";

function makeDb() {
  const db = new Database(":memory:") as unknown as SQLiteDatabase;
  initializeAnalyticsSchema(db);
  return db;
}

function seedOrders(db: SQLiteDatabase, dates: string[]) {
  replaceSalesCacheRange(
    db,
    {
      productRows: [],
      orderRows: dates.map((date, index) => ({
        order_id: `O-${index}`,
        date,
        channel: "Punto de Venta",
        total_sales: 1000,
        total_tax: 100,
        total_discount: 0,
        total_cost: 300,
        counts_as_order: 1,
      })),
    },
    { startDate: dates[0], endDate: dates[dates.length - 1], clearExisting: false },
  );
}

test("incremental sync starts from the latest cached sale minus the overlap on first run", () => {
  const db = makeDb();
  seedOrders(db, ["2026-08-01", "2026-08-10"]);

  assert.deepEqual(sync.planIncrementalRange(db, "2026-09-28", 3), {
    startDate: "2026-08-07",
    endDate: "2026-09-28",
  });
});

test("incremental sync resumes from where the last sync reached, not from the last sale", () => {
  const db = makeDb();
  seedOrders(db, ["2026-08-10"]);
  sync.recordIncrementalSync(db, "2026-09-27", "2026-09-28T10:00:00.000Z");

  assert.deepEqual(sync.planIncrementalRange(db, "2026-09-28", 3), {
    startDate: "2026-09-24",
    endDate: "2026-09-28",
  });
});

test("incremental sync on an empty database pulls the last 30 days", () => {
  const db = makeDb();
  assert.deepEqual(sync.planIncrementalRange(db, "2026-09-28", 3), {
    startDate: "2026-08-29",
    endDate: "2026-09-28",
  });
});

test("backfill walks backwards from today in 13-day chunks, ignoring what is already cached", () => {
  const db = makeDb();
  seedOrders(db, ["2026-04-19", "2026-08-10"]);

  const chunk = sync.planBackfillChunk(db, { floorDate: "2020-01-01", fallbackCursor: "2026-09-29" });
  assert.deepEqual(chunk, { startDate: "2026-09-16", endDate: "2026-09-28" });

  sync.recordBackfillChunk(db, chunk!, 120, { floorDate: "2020-01-01", maxEmptyDays: 90 });
  assert.deepEqual(sync.planBackfillChunk(db, { floorDate: "2020-01-01", fallbackCursor: "2026-09-29" }), {
    startDate: "2026-09-03",
    endDate: "2026-09-15",
  });
});

test("backfill never goes past the floor date and finishes there", () => {
  const db = makeDb();

  const chunk = sync.planBackfillChunk(db, { floorDate: "2026-01-01", fallbackCursor: "2026-01-10" });
  assert.deepEqual(chunk, { startDate: "2026-01-01", endDate: "2026-01-09" });

  sync.recordBackfillChunk(db, chunk!, 50, { floorDate: "2026-01-01", maxEmptyDays: 90 });
  assert.equal(sync.getSyncState(db).backfillDone, true);
  assert.equal(sync.planBackfillChunk(db, { floorDate: "2026-01-01", fallbackCursor: "2026-01-10" }), null);
});

test("backfill stops after a long run of empty chunks (restaurant had not opened yet)", () => {
  const db = makeDb();
  seedOrders(db, ["2026-04-19"]);
  const options = { floorDate: "2020-01-01", maxEmptyDays: 20 };

  const first = sync.planBackfillChunk(db, { floorDate: options.floorDate, fallbackCursor: "2026-09-29" })!;
  sync.recordBackfillChunk(db, first, 0, options);
  assert.equal(sync.getSyncState(db).backfillDone, false);

  const second = sync.planBackfillChunk(db, { floorDate: options.floorDate, fallbackCursor: "2026-09-29" })!;
  sync.recordBackfillChunk(db, second, 0, options);
  assert.equal(sync.getSyncState(db).backfillDone, true);
});

test("an empty chunk followed by sales resets the empty streak", () => {
  const db = makeDb();
  seedOrders(db, ["2026-04-19"]);
  const options = { floorDate: "2020-01-01", maxEmptyDays: 30 };

  const first = sync.planBackfillChunk(db, { floorDate: options.floorDate, fallbackCursor: "2026-09-29" })!;
  sync.recordBackfillChunk(db, first, 0, options);
  const second = sync.planBackfillChunk(db, { floorDate: options.floorDate, fallbackCursor: "2026-09-29" })!;
  sync.recordBackfillChunk(db, second, 10, options);

  const state = sync.getSyncState(db);
  assert.equal(state.backfillEmptyDays, 0);
  assert.equal(state.backfillDone, false);
});

test("backfill on an empty database starts just before the fallback cursor", () => {
  const db = makeDb();
  assert.deepEqual(sync.planBackfillChunk(db, { floorDate: "2020-01-01", fallbackCursor: "2026-09-29" }), {
    startDate: "2026-09-16",
    endDate: "2026-09-28",
  });
});
