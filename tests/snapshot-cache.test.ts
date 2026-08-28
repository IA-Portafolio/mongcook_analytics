import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initializeAnalyticsSchema } from "../db.ts";
import {
  SNAPSHOT_CLASSIFICATION_VERSION,
  loadCachedSnapshot,
  persistAnalyticsSnapshot,
} from "../toteat-cache.ts";

test("persistAnalyticsSnapshot can be read back for a closed month", () => {
  const tempDb = new Database(":memory:");
  initializeAnalyticsSchema(tempDb);

  persistAnalyticsSnapshot(
    tempDb,
    {
      productRows: [
        {
          order_id: "1",
          date: "2026-07-02",
          product_name: "SUN KEE",
          family: "Platos Especiales",
          channel: "Punto de Venta",
          quantity: 1,
          total_price: 26500,
          total_tax: 1963,
          total_cost: 8000,
          total_discount: 0,
          is_personal: 1,
        },
      ],
      orderRows: [
        {
          order_id: "1",
          date: "2026-07-02",
          channel: "Punto de Venta",
          total_sales: 26500,
          total_tax: 1963,
          total_discount: 0,
          total_cost: 8000,
          counts_as_order: 1,
        },
      ],
    },
    "2026-07-01",
    "2026-07-31",
  );

  const loaded = loadCachedSnapshot(tempDb, "2026-07-01", "2026-07-31");
  assert.ok(loaded);
  assert.equal(loaded?.productRows.length, 1);
  assert.equal(loaded?.orderRows.length, 1);
  assert.equal(loaded?.productRows[0].family, "Platos Especiales");
  assert.equal(typeof SNAPSHOT_CLASSIFICATION_VERSION, "number");
});
