import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as dbModule from "../db.ts";

test("querySummaryMetrics uses order cache for KPIs and product rows for quantity", () => {
  assert.equal(typeof dbModule.initializeAnalyticsSchema, "function");
  assert.equal(typeof dbModule.querySummaryMetrics, "function");
  if (
    typeof dbModule.initializeAnalyticsSchema !== "function" ||
    typeof dbModule.querySummaryMetrics !== "function"
  ) {
    return;
  }

  const tempDb = new Database(":memory:");
  dbModule.initializeAnalyticsSchema(tempDb);

  tempDb
    .prepare(
      `INSERT INTO sales_data
       (order_id, date, product_name, family, channel, quantity, total_price, total_tax, total_cost, total_discount, is_personal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("", "2026-04-01", "Combo Familiar", "Combos", "Punto de Venta", 3, 47000, 0, 15000, -2000, 0);

  tempDb
    .prepare(
      `INSERT INTO sales_orders
       (order_id, date, channel, total_sales, total_tax, total_discount, total_cost, counts_as_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("ORD-1", "2026-04-01", "Punto de Venta", 45500, 3370.38, 1500, 1569, 1);

  tempDb
    .prepare(
      `INSERT INTO sales_orders
       (order_id, date, channel, total_sales, total_tax, total_discount, total_cost, counts_as_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("ORD-NC", "2026-04-01", "Punto de Venta", 0, 0, 0, 0, 0);

  const summary = dbModule.querySummaryMetrics(tempDb, {
    startDate: "2026-04-01",
    endDate: "2026-04-01",
  });

  assert.deepStrictEqual(summary, {
    totalSales: 45500,
    totalTax: 3370.38,
    totalCost: 1569,
    totalQuantity: 3,
    totalOrders: 1,
    totalDiscount: 1500,
    totalMargin: 39060.62,
  });
});
