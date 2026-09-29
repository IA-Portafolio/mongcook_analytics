import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as cache from "../toteat-cache.ts";
import type { ToteatConfig, ToteatImportSnapshot } from "../toteat.ts";

// The real request gate spaces Toteat calls 21s apart; tests use a mocked fetch.
process.env.TOTEAT_MIN_REQUEST_GAP_MS = "0";

const CONFIG: ToteatConfig = {
  baseUrl: "https://api.toteat.test",
  xir: "1",
  xil: "1",
  xiu: "1",
  xapitoken: "token",
};

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sales_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER,
      order_id TEXT,
      date TEXT,
      product_name TEXT,
      family TEXT,
      channel TEXT,
      quantity INTEGER,
      total_price REAL,
      total_tax REAL DEFAULT 0,
      total_cost REAL,
      total_discount REAL DEFAULT 0,
      is_personal INTEGER DEFAULT 1
    );
    CREATE TABLE sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      date TEXT,
      channel TEXT,
      total_sales REAL,
      total_tax REAL DEFAULT 0,
      total_discount REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      counts_as_order INTEGER DEFAULT 1
    );
  `);
  return db as unknown as import("../db.ts").SQLiteDatabase;
}

function productRow(orderId: string, date: string) {
  return {
    order_id: orderId,
    date,
    product_name: "BOWL TAO",
    family: "Bowl",
    channel: "Punto de Venta",
    quantity: 1,
    total_price: 10000,
    total_tax: 1000,
    total_cost: 3000,
    total_discount: 0,
    is_personal: 1,
  };
}

function orderRow(orderId: string, date: string) {
  return {
    order_id: orderId,
    date,
    channel: "Punto de Venta",
    total_sales: 10000,
    total_tax: 1000,
    total_discount: 0,
    total_cost: 3000,
    counts_as_order: 1,
  };
}

function seed(db: import("../db.ts").SQLiteDatabase, dates: string[]) {
  const snapshot: ToteatImportSnapshot = {
    productRows: dates.map((date, index) => productRow(`SEED-${index}`, date)),
    orderRows: dates.map((date, index) => orderRow(`SEED-${index}`, date)),
  };
  cache.replaceSalesCacheRange(db, snapshot, {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    clearExisting: false,
  });
}

function countRows(db: import("../db.ts").SQLiteDatabase, startDate: string, endDate: string) {
  const products = db
    .prepare("SELECT COUNT(*) as n FROM sales_data WHERE date BETWEEN ? AND ?")
    .get(startDate, endDate) as { n: number };
  const orders = db
    .prepare("SELECT COUNT(*) as n FROM sales_orders WHERE date BETWEEN ? AND ?")
    .get(startDate, endDate) as { n: number };
  return { products: products.n, orders: orders.n };
}

/** Replace global fetch with a Toteat-shaped response for the duration of `run`. */
async function withToteatResponse<T>(body: unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const EMPTY_OK = { ok: true, msg: { texto: "SALES SENT", tipo: 0 }, data: [] };

test("an empty Toteat response never deletes rows already cached in the window", async () => {
  const db = makeDb();
  seed(db, ["2026-08-08", "2026-08-09", "2026-08-10"]);

  const result = await withToteatResponse(EMPTY_OK, () =>
    cache.syncToteatRange(db, CONFIG, {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      clearExisting: true,
    }),
  );

  assert.deepEqual(countRows(db, "2026-08-08", "2026-08-20"), { products: 3, orders: 3 });
  assert.equal(result.emptyResponseIgnored, true);
  assert.equal(result.preservedRows, 6);
  assert.equal(result.maxCachedDate, "2026-08-10");
});

test("an empty Toteat response still clears the window when the caller explicitly allows it", async () => {
  const db = makeDb();
  seed(db, ["2026-08-08", "2026-08-09", "2026-08-10"]);

  const result = await withToteatResponse(EMPTY_OK, () =>
    cache.syncToteatRange(db, CONFIG, {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      clearExisting: true,
      allowEmptyClear: true,
    }),
  );

  assert.deepEqual(countRows(db, "2026-08-08", "2026-08-20"), { products: 0, orders: 0 });
  assert.equal(result.emptyResponseIgnored, false);
  assert.equal(result.maxCachedDate, null);
});

test("a non-empty Toteat response still replaces the window", async () => {
  const db = makeDb();
  seed(db, ["2026-08-08", "2026-08-09"]);

  const response = {
    ok: true,
    msg: { texto: "SALES SENT", tipo: 0 },
    data: [
      {
        orderId: 900,
        paymentId: 1,
        paymentForms: [{ name: "Efectivo", id: 1, amount: 20000, comment: "" }],
        fiscalId: "F-900",
        fiscalAmt: 20000,
        fiscalType: "BE",
        dateOpen: "2026-08-12T19:00:00",
        dateClosed: "2026-08-12T19:30:00",
        registerId: 1,
        registerName: "Caja 1",
        waiterId: 1,
        waiterName: "TEST",
        numberClients: 1,
        tableId: 1,
        tableName: "1",
        zoneId: "ZB.010",
        zoneName: "Salon Principal",
        subtotal: 18000,
        discounts: 0,
        total: 20000,
        totalWithGratuity: 20000,
        taxes: 2000,
        gratuity: 0,
        payed: 20000,
        change: 0,
        products: [
          {
            id: "MON450",
            name: "Arma tu plato",
            netPrice: 20000,
            unitCost: 5000,
            totalCost: 5000,
            payed: 20000,
            quantity: 1,
            discounts: 0,
            taxes: 2000,
            hierarchyId: "AB.110",
            hierarchyName: "Arma tu plato",
          },
        ],
      },
    ],
  };

  const result = await withToteatResponse(response, () =>
    cache.syncToteatRange(db, CONFIG, {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      clearExisting: true,
    }),
  );

  assert.equal(result.emptyResponseIgnored, false);
  assert.equal(result.maxCachedDate, "2026-08-12");
  assert.deepEqual(countRows(db, "2026-08-08", "2026-08-09"), { products: 0, orders: 0 });
  assert.equal(countRows(db, "2026-08-12", "2026-08-12").orders, 1);
});

test("buildAutoSyncReport warns instead of claiming success when nothing new arrived", () => {
  const report = cache.buildAutoSyncReport(
    {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      productRows: 418,
      orderRows: 153,
      channels: [],
      families: [],
      emptyResponseIgnored: false,
      preservedRows: 0,
      maxCachedDate: "2026-08-10",
    },
    "2026-08-10",
    "2026-08-20",
  );

  assert.equal(report.level, "warn");
  assert.match(report.message, /No new data/);
  assert.match(report.message, /2026-08-10/);
  assert.match(report.message, /10 days/);
});

test("buildAutoSyncReport reports the preserved rows when Toteat came back empty", () => {
  const report = cache.buildAutoSyncReport(
    {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      productRows: 0,
      orderRows: 0,
      channels: [],
      families: [],
      emptyResponseIgnored: true,
      preservedRows: 571,
      maxCachedDate: "2026-08-10",
    },
    "2026-08-10",
    "2026-08-20",
  );

  assert.equal(report.level, "warn");
  assert.match(report.message, /no orders/);
  assert.match(report.message, /571/);
});

test("buildAutoSyncReport confirms success when the cache actually moved forward", () => {
  const report = cache.buildAutoSyncReport(
    {
      startDate: "2026-08-08",
      endDate: "2026-08-20",
      productRows: 640,
      orderRows: 240,
      channels: [],
      families: [],
      emptyResponseIgnored: false,
      preservedRows: 0,
      maxCachedDate: "2026-08-20",
    },
    "2026-08-10",
    "2026-08-20",
  );

  assert.equal(report.level, "info");
  assert.match(report.message, /640 product rows/);
  assert.match(report.message, /2026-08-20/);
});
