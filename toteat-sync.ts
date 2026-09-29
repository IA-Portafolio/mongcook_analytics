import type { SQLiteDatabase } from "./db.ts";
import { buildAutoSyncReport, getCacheBounds, syncToteatRange } from "./toteat-cache.ts";
import { clampEndDateToLastClosedShift, fetchToteatShiftStatus, type ToteatConfig } from "./toteat.ts";

/**
 * Background sync that keeps SQLite as the dashboard's only data source.
 *
 * Two jobs share Toteat's 3 requests/minute budget:
 *  - incremental: every few minutes, re-import from just before the last synced
 *    day up to the last closed shift, so new sales land in the DB;
 *  - backfill: walk backwards from today in 13-day chunks, re-importing every
 *    window, until a long empty stretch (or the floor date) says there is no older
 *    history. Re-importing (instead of starting at the oldest cached sale) fills the
 *    holes left by older partial imports and keeps order and product rows in step.
 *
 * Progress lives in `sync_state`, so restarts and deploys resume where they left off.
 */

export interface SyncState {
  incrementalThrough: string | null;
  lastIncrementalAt: string | null;
  backfillCursor: string | null;
  backfillEmptyDays: number;
  backfillDone: boolean;
  lastBackfillAt: string | null;
  lastError: string | null;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

// syncToteatRange asks Toteat for two extra days before each window (overnight
// shifts), so 13 days keeps every chunk inside Toteat's 15-day request limit.
const BACKFILL_CHUNK_DAYS = 13;

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daysInRange(range: DateRange) {
  return Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000) + 1;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function ensureSyncStateTable(database: SQLiteDatabase) {
  database.exec("CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)");
}

function readState(database: SQLiteDatabase): Map<string, string> {
  ensureSyncStateTable(database);
  const rows = database.prepare("SELECT key, value FROM sync_state").all() as { key: string; value: string }[];
  return new Map(rows.map((row) => [row.key, row.value]));
}

function writeState(database: SQLiteDatabase, values: Record<string, string | number | boolean | null>) {
  ensureSyncStateTable(database);
  const upsert = database.prepare(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = database.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      upsert.run(key, value === null ? null : String(value));
    }
  });
  tx();
}

export function getSyncState(database: SQLiteDatabase): SyncState {
  const state = readState(database);
  return {
    incrementalThrough: state.get("incremental_through") || null,
    lastIncrementalAt: state.get("last_incremental_at") || null,
    backfillCursor: state.get("backfill_cursor") || null,
    backfillEmptyDays: Number(state.get("backfill_empty_days") || 0),
    backfillDone: state.get("backfill_done") === "true",
    lastBackfillAt: state.get("last_backfill_at") || null,
    lastError: state.get("last_error") || null,
  };
}

export function planIncrementalRange(
  database: SQLiteDatabase,
  lastClosedDate: string,
  overlapDays = 3,
): DateRange | null {
  const { incrementalThrough } = getSyncState(database);
  const anchor = incrementalThrough || getCacheBounds(database).maxDate;
  const startDate = anchor ? addDays(anchor, -overlapDays) : addDays(lastClosedDate, -30);

  if (startDate > lastClosedDate) return null;
  return { startDate, endDate: lastClosedDate };
}

export function recordIncrementalSync(database: SQLiteDatabase, endDate: string, at = new Date().toISOString()) {
  writeState(database, { incremental_through: endDate, last_incremental_at: at, last_error: null });
}

export function planBackfillChunk(
  database: SQLiteDatabase,
  { floorDate, fallbackCursor }: { floorDate: string; fallbackCursor: string },
): DateRange | null {
  const state = getSyncState(database);
  if (state.backfillDone) return null;

  const cursor = state.backfillCursor || fallbackCursor;
  const endDate = addDays(cursor, -1);
  if (endDate < floorDate) return null;

  const earliest = addDays(endDate, -(BACKFILL_CHUNK_DAYS - 1));
  return { startDate: earliest < floorDate ? floorDate : earliest, endDate };
}

export function recordBackfillChunk(
  database: SQLiteDatabase,
  chunk: DateRange,
  orderRows: number,
  { floorDate, maxEmptyDays }: { floorDate: string; maxEmptyDays: number },
) {
  const previous = getSyncState(database);
  const emptyDays = orderRows > 0 ? 0 : previous.backfillEmptyDays + daysInRange(chunk);
  const done = chunk.startDate <= floorDate || emptyDays >= maxEmptyDays;

  writeState(database, {
    backfill_cursor: chunk.startDate,
    backfill_empty_days: emptyDays,
    backfill_done: done,
    last_backfill_at: new Date().toISOString(),
    last_error: null,
  });
}

export interface SyncEngineOptions {
  database: SQLiteDatabase;
  getConfig: () => ToteatConfig;
  incrementalIntervalMs?: number;
  backfillStepDelayMs?: number;
  initialDelayMs?: number;
  backfillFloorDate?: string;
  backfillMaxEmptyDays?: number;
  log?: Pick<Console, "log" | "warn" | "error">;
}

export function createToteatSyncEngine(options: SyncEngineOptions) {
  const {
    database,
    getConfig,
    incrementalIntervalMs = 30 * 60 * 1000,
    // The global Toteat request gate already paces calls (3/min); this only adds a short breather.
    backfillStepDelayMs = 5 * 1000,
    initialDelayMs = 60 * 1000,
    backfillFloorDate = "2020-01-01",
    backfillMaxEmptyDays = 120,
    log = console,
  } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let activity: string | null = null;
  let lastIncrementalRunAt = 0;

  async function resolveLastClosedDate() {
    try {
      const status = await fetchToteatShiftStatus(getConfig());
      return clampEndDateToLastClosedShift(todayDate(), status);
    } catch (error: any) {
      // Without shift status we cannot tell whether today's shift is still open;
      // stop at yesterday so a half-finished day is never stored as final.
      log.warn(`[sync] Shift status unavailable (${error?.message || error}); syncing through yesterday.`);
      return addDays(todayDate(), -1);
    }
  }

  async function runIncremental() {
    const lastClosedDate = await resolveLastClosedDate();
    const range = planIncrementalRange(database, lastClosedDate);
    lastIncrementalRunAt = Date.now();
    if (!range) return;

    activity = `incremental ${range.startDate} → ${range.endDate}`;
    log.log(`[sync] Incremental ${range.startDate} → ${range.endDate}`);
    const previousMaxDate = getCacheBounds(database).maxDate;
    const result = await syncToteatRange(database, getConfig(), { ...range, clearExisting: true });
    recordIncrementalSync(database, range.endDate);

    const report = buildAutoSyncReport(result, previousMaxDate);
    (report.level === "warn" ? log.warn : log.log)(`[sync] ${report.message}`);
  }

  async function runBackfillStep() {
    const chunk = planBackfillChunk(database, { floorDate: backfillFloorDate, fallbackCursor: todayDate() });
    if (!chunk) return;

    activity = `backfill ${chunk.startDate} → ${chunk.endDate}`;
    const result = await syncToteatRange(database, getConfig(), { ...chunk, clearExisting: true });
    recordBackfillChunk(database, chunk, result.orderRows, {
      floorDate: backfillFloorDate,
      maxEmptyDays: backfillMaxEmptyDays,
    });

    const state = getSyncState(database);
    log.log(
      `[sync] Backfill ${chunk.startDate} → ${chunk.endDate}: ${result.orderRows} orders`
      + (state.backfillDone ? ". History complete." : ""),
    );
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (Date.now() - lastIncrementalRunAt >= incrementalIntervalMs) {
        await runIncremental();
      }
      await runBackfillStep();
    } catch (error: any) {
      const message = error?.message || String(error);
      log.error(`[sync] ${activity || "sync"} failed: ${message}`);
      writeState(database, { last_error: `${new Date().toISOString()} ${message}` });
    } finally {
      running = false;
      activity = null;
      schedule(getSyncState(database).backfillDone ? incrementalIntervalMs : backfillStepDelayMs);
    }
  }

  function schedule(delayMs: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), delayMs);
  }

  return {
    start() {
      schedule(initialDelayMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    status() {
      return {
        ...getCacheBounds(database),
        ...getSyncState(database),
        running,
        activity,
      };
    },
  };
}
