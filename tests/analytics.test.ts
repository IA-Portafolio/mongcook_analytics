import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelMetrics,
  buildComparativeTypeMetrics,
  buildProductMetrics,
  summarizeSnapshot,
} from "../analytics.ts";

const baseSnapshot = {
  productRows: [
    {
      order_id: "A",
      date: "2026-04-01",
      product_name: "Combo 1",
      family: "Combos",
      channel: "Punto de Venta",
      quantity: 2,
      total_price: 9000,
      total_tax: 684,
      total_cost: 3000,
      total_discount: 1000,
      is_personal: 1,
    },
    {
      order_id: "B",
      date: "2026-04-01",
      product_name: "Lumpia",
      family: "Otros",
      channel: "Rappi",
      quantity: 1,
      total_price: 2000,
      total_tax: 152,
      total_cost: 500,
      total_discount: 0,
      is_personal: -1,
    },
  ],
  orderRows: [
    {
      order_id: "A",
      date: "2026-04-01",
      channel: "Punto de Venta",
      total_sales: 10000,
      total_tax: 684,
      total_discount: 1000,
      total_cost: 3000,
      counts_as_order: 1,
    },
    {
      order_id: "VOID",
      date: "2026-04-01",
      channel: "Punto de Venta",
      total_sales: 0,
      total_tax: 0,
      total_discount: 0,
      total_cost: 0,
      counts_as_order: 0,
    },
  ],
};

test("summarizeSnapshot matches Toteat-style KPI semantics without family filters", () => {
  assert.deepStrictEqual(summarizeSnapshot(baseSnapshot), {
    totalSales: 10000,
    totalTax: 684,
    totalCost: 3000,
    totalQuantity: 3,
    totalOrders: 1,
    totalDiscount: 1000,
    totalMargin: 5316,
  });
});

test("summarizeSnapshot uses product rows when filtering families", () => {
  assert.deepStrictEqual(summarizeSnapshot(baseSnapshot, ["Combos"]), {
    totalSales: 10000,
    totalTax: 684,
    totalCost: 3000,
    totalQuantity: 2,
    totalOrders: 1,
    totalDiscount: 1000,
    totalMargin: 5316,
  });
});

test("product aggregations stay at post-discount sales level", () => {
  assert.deepStrictEqual(buildComparativeTypeMetrics(baseSnapshot), [
    { is_personal: -1, family: "Otros", quantity: 1, sales: 2000, cost: 500 },
    { is_personal: 1, family: "Combos", quantity: 2, sales: 9000, cost: 3000 },
  ]);

  assert.deepStrictEqual(buildChannelMetrics(baseSnapshot), [
    { channel: "Punto de Venta", family: "Combos", quantity: 2, sales: 9000, cost: 3000 },
    { channel: "Rappi", family: "Otros", quantity: 1, sales: 2000, cost: 500 },
  ]);

  assert.deepStrictEqual(buildProductMetrics(baseSnapshot), [
    {
      product_name: "Combo 1",
      family: "Combos",
      channel: "Punto de Venta",
      is_personal: 1,
      quantity: 2,
      sales: 9000,
      cost: 3000,
    },
    {
      product_name: "Lumpia",
      family: "Otros",
      channel: "Rappi",
      is_personal: -1,
      quantity: 1,
      sales: 2000,
      cost: 500,
    },
  ]);
});
