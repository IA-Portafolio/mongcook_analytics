import type { SQLiteDatabase } from "./db.ts";
import type { ProductMapping, ToteatConfig, ToteatImportSnapshot } from "./toteat.ts";
import { importToteatSnapshot } from "./toteat.ts";

export interface SyncRangeOptions {
  startDate: string;
  endDate: string;
  clearExisting?: boolean;
  customMapping?: Record<string, ProductMapping>;
}

export interface ToteatSyncResult {
  startDate: string;
  endDate: string;
  productRows: number;
  orderRows: number;
  channels: string[];
  families: string[];
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

  replaceSalesCacheRange(database, snapshot, options);

  return {
    startDate: options.startDate,
    endDate: options.endDate,
    productRows: snapshot.productRows.length,
    orderRows: snapshot.orderRows.length,
    channels: [...new Set(snapshot.productRows.map((row) => row.channel))],
    families: [...new Set(snapshot.productRows.map((row) => row.family))],
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
