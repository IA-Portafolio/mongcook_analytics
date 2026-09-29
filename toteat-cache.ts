import type { SQLiteDatabase } from "./db.ts";
import type { CachedOrderSale, NormalizedSale, ProductMapping, ToteatConfig, ToteatImportSnapshot } from "./toteat.ts";
import { importToteatSnapshot } from "./toteat.ts";

/** Bump when product-family classification rules change so stale SQLite rows are not reused. */
export const SNAPSHOT_CLASSIFICATION_VERSION = 4;

export interface SyncRangeOptions {
  startDate: string;
  endDate: string;
  clearExisting?: boolean;
  /**
   * Let an empty Toteat response wipe the cached window. Off by default: upstream
   * answers `ok: true` with zero orders both when a day really had no sales and when
   * the POS simply has not reported yet, so a blank must never delete good rows on
   * its own. Only a manual re-import that intends to remove orders should set this.
   */
  allowEmptyClear?: boolean;
  customMapping?: Record<string, ProductMapping>;
}

export interface ToteatSyncResult {
  startDate: string;
  endDate: string;
  productRows: number;
  orderRows: number;
  channels: string[];
  families: string[];
  /** True when an empty upstream response was ignored to protect cached rows. */
  emptyResponseIgnored: boolean;
  /** Cached rows in the window that the ignored empty response would have deleted. */
  preservedRows: number;
  /** Latest sale date held in the cache after the sync, or null when it is empty. */
  maxCachedDate: string | null;
}

export interface AutoSyncReport {
  level: "info" | "warn";
  message: string;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function filterSnapshotToDateRange(
  snapshot: ToteatImportSnapshot,
  startDate: string,
  endDate: string,
): ToteatImportSnapshot {
  return {
    productRows: snapshot.productRows.filter((row) => row.date >= startDate && row.date <= endDate),
    orderRows: snapshot.orderRows.filter((row) => row.date >= startDate && row.date <= endDate),
  };
}

export function getCacheBounds(database: SQLiteDatabase) {
  const row = database
    .prepare(
      `
        SELECT MIN(date) as minDate, MAX(date) as maxDate
        FROM (
          SELECT date FROM sales_data
          UNION ALL
          SELECT date FROM sales_orders
        )
      `
    )
    .get() as { minDate: string | null; maxDate: string | null };

  return {
    minDate: row?.minDate || null,
    maxDate: row?.maxDate || null,
  };
}

export function countCachedRowsInRange(
  database: SQLiteDatabase,
  startDate: string,
  endDate: string,
) {
  const row = database
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM sales_data WHERE date BETWEEN ? AND ?) as products,
          (SELECT COUNT(*) FROM sales_orders WHERE date BETWEEN ? AND ?) as orders
      `
    )
    .get(startDate, endDate, startDate, endDate) as { products: number; orders: number };

  return {
    products: row?.products || 0,
    orders: row?.orders || 0,
    total: (row?.products || 0) + (row?.orders || 0),
  };
}

export function getBackfillRange(database: SQLiteDatabase, endDate = todayDate()) {
  const bounds = getCacheBounds(database);
  return {
    startDate: bounds.minDate || endDate,
    endDate,
  };
}

export function getAutoSyncRange(database: SQLiteDatabase, endDate = todayDate(), overlapDays = 2) {
  const bounds = getCacheBounds(database);

  if (!bounds.maxDate) {
    const start = new Date(endDate);
    start.setDate(start.getDate() - 30);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate,
    };
  }

  const start = new Date(bounds.maxDate);
  start.setDate(start.getDate() - overlapDays);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  };
}

export function replaceSalesCacheRange(
  database: SQLiteDatabase,
  snapshot: ToteatImportSnapshot,
  { startDate, endDate, clearExisting = true }: { startDate: string; endDate: string; clearExisting?: boolean },
) {
  const insertProduct = database.prepare(`
    INSERT INTO sales_data (order_id, date, product_name, family, channel, quantity, total_price, total_tax, total_cost, total_discount, is_personal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOrder = database.prepare(`
    INSERT INTO sales_orders (order_id, date, channel, total_sales, total_tax, total_discount, total_cost, counts_as_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteProducts = database.prepare("DELETE FROM sales_data WHERE date BETWEEN ? AND ?");
  const deleteOrders = database.prepare("DELETE FROM sales_orders WHERE date BETWEEN ? AND ?");

  const tx = database.transaction(() => {
    if (clearExisting) {
      deleteProducts.run(startDate, endDate);
      deleteOrders.run(startDate, endDate);
    }

    for (const row of snapshot.productRows) {
      insertProduct.run(
        row.order_id,
        row.date,
        row.product_name,
        row.family,
        row.channel,
        row.quantity,
        row.total_price,
        row.total_tax,
        row.total_cost,
        row.total_discount,
        row.is_personal,
      );
    }

    for (const row of snapshot.orderRows) {
      insertOrder.run(
        row.order_id,
        row.date,
        row.channel,
        row.total_sales,
        row.total_tax,
        row.total_discount,
        row.total_cost,
        row.counts_as_order,
      );
    }
  });

  tx();
}

export function snapshotRangeKey(startDate: string, endDate: string, version = SNAPSHOT_CLASSIFICATION_VERSION) {
  return `${startDate}:${endDate}:v${version}`;
}

export function rememberSnapshotRange(
  database: SQLiteDatabase,
  startDate: string,
  endDate: string,
  version = SNAPSHOT_CLASSIFICATION_VERSION,
) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS snapshot_cache_meta (
      range_key TEXT PRIMARY KEY,
      classification_version INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `);
  database.prepare(`
    INSERT INTO snapshot_cache_meta (range_key, classification_version, start_date, end_date, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(range_key) DO UPDATE SET
      classification_version = excluded.classification_version,
      fetched_at = excluded.fetched_at
  `).run(snapshotRangeKey(startDate, endDate, version), version, startDate, endDate, new Date().toISOString());
}

/** Read every cached row for a date window, shaped exactly like a live Toteat snapshot. */
export function readSnapshotFromDb(
  database: SQLiteDatabase,
  startDate: string,
  endDate: string,
): ToteatImportSnapshot {
  const productRows = database.prepare(
    `
      SELECT
        COALESCE(order_id, '') as order_id,
        date,
        product_name,
        family,
        channel,
        quantity,
        total_price,
        COALESCE(total_tax, 0) as total_tax,
        total_cost,
        COALESCE(total_discount, 0) as total_discount,
        is_personal
      FROM sales_data
      WHERE date BETWEEN ? AND ?
    `,
  ).all(startDate, endDate) as NormalizedSale[];

  const orderRows = database.prepare(
    `
      SELECT
        order_id,
        date,
        channel,
        total_sales,
        COALESCE(total_tax, 0) as total_tax,
        COALESCE(total_discount, 0) as total_discount,
        COALESCE(total_cost, 0) as total_cost,
        COALESCE(counts_as_order, 1) as counts_as_order
      FROM sales_orders
      WHERE date BETWEEN ? AND ?
    `,
  ).all(startDate, endDate) as CachedOrderSale[];


  return { productRows, orderRows };
}

export function loadCachedSnapshot(
  database: SQLiteDatabase,
  startDate: string,
  endDate: string,
  options: { allowStaleCurrentMonth?: boolean } = {},
): ToteatImportSnapshot | null {
  database.exec(`
    CREATE TABLE IF NOT EXISTS snapshot_cache_meta (
      range_key TEXT PRIMARY KEY,
      classification_version INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `);

  const meta = database.prepare(
    `SELECT classification_version, fetched_at FROM snapshot_cache_meta WHERE range_key = ?`,
  ).get(snapshotRangeKey(startDate, endDate)) as { classification_version: number; fetched_at: string } | undefined;

  if (!meta || meta.classification_version !== SNAPSHOT_CLASSIFICATION_VERSION) {
    return null;
  }

  const isClosedRange = endDate < todayDate();
  if (!isClosedRange && !options.allowStaleCurrentMonth) {
    const ageMs = Date.now() - Date.parse(meta.fetched_at);
    if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) return null;
  }

  const snapshot = readSnapshotFromDb(database, startDate, endDate);
  if (snapshot.productRows.length === 0 && snapshot.orderRows.length === 0) return null;

  return snapshot;
}

export function persistAnalyticsSnapshot(
  database: SQLiteDatabase,
  snapshot: ToteatImportSnapshot,
  startDate: string,
  endDate: string,
) {
  replaceSalesCacheRange(database, snapshot, { startDate, endDate, clearExisting: true });
  rememberSnapshotRange(database, startDate, endDate);
}

export async function syncToteatRange(
  database: SQLiteDatabase,
  config: ToteatConfig,
  options: SyncRangeOptions,
): Promise<ToteatSyncResult> {
  // Toteat queries are keyed by shift date, but we cache by the order's real open date.
  // To keep overnight-shift orders from being dropped at chunk boundaries, fetch the whole
  // requested range first and then replace the cache in one shot for that order-date window.
  const rawSnapshot = await importToteatSnapshot(
    config,
    addDays(options.startDate, -2),
    options.endDate,
    options.customMapping,
  );
  const snapshot = filterSnapshotToDateRange(rawSnapshot, options.startDate, options.endDate);

  const isEmpty = snapshot.productRows.length === 0 && snapshot.orderRows.length === 0;
  const cached = countCachedRowsInRange(database, options.startDate, options.endDate);

  // Toteat answers `ok: true` with zero orders when the POS has not reported a shift
  // yet, so clearing on a blank would silently delete real sales. Keep what we have
  // and let the caller surface it instead.
  const emptyResponseIgnored = isEmpty && options.clearExisting !== false
    && !options.allowEmptyClear && cached.total > 0;

  if (!emptyResponseIgnored) {
    replaceSalesCacheRange(database, snapshot, options);
  }

  return {
    startDate: options.startDate,
    endDate: options.endDate,
    productRows: snapshot.productRows.length,
    orderRows: snapshot.orderRows.length,
    channels: [...new Set(snapshot.productRows.map((row) => row.channel))],
    families: [...new Set(snapshot.productRows.map((row) => row.family))],
    emptyResponseIgnored,
    preservedRows: emptyResponseIgnored ? cached.total : 0,
    maxCachedDate: getCacheBounds(database).maxDate,
  };
}

function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

/**
 * Turn a sync result into a log line that tells the truth. The old "Done. N rows
 * imported" was printed even when the window had not moved in days, which is how a
 * ten-day upstream outage went unnoticed.
 */
export function buildAutoSyncReport(
  result: ToteatSyncResult,
  previousMaxDate: string | null,
  today = todayDate(),
): AutoSyncReport {
  const window = `${result.startDate} \u2192 ${result.endDate}`;
  const freshness = result.maxCachedDate
    ? `${result.maxCachedDate} (${daysBetween(result.maxCachedDate, today)} days old)`
    : "none (cache is empty)";

  if (result.emptyResponseIgnored) {
    return {
      level: "warn",
      message:
        `Toteat returned no orders for ${window}. Kept ${result.preservedRows} cached rows `
        + `instead of clearing the window. Latest cached sale is still ${freshness}.`,
    };
  }

  if (result.maxCachedDate && result.maxCachedDate === previousMaxDate) {
    return {
      level: "warn",
      message:
        `No new data. Latest cached sale is still ${freshness}. Re-imported `
        + `${result.productRows} product rows / ${result.orderRows} orders for ${window}.`,
    };
  }

  return {
    level: "info",
    message:
      `Done. ${result.productRows} product rows / ${result.orderRows} orders imported `
      + `for ${window}. Latest cached sale now ${freshness}.`,
  };
}

export async function backfillToteatCache(
  database: SQLiteDatabase,
  config: ToteatConfig,
  options: Omit<SyncRangeOptions, "startDate" | "endDate"> & { startDate?: string; endDate?: string } = {},
) {
  const range = getBackfillRange(database, options.endDate || todayDate());

  return syncToteatRange(database, config, {
    startDate: options.startDate || range.startDate,
    endDate: options.endDate || range.endDate,
    clearExisting: options.clearExisting ?? true,
    customMapping: options.customMapping,
  });
}
