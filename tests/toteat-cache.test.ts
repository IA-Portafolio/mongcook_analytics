import test from "node:test";
import assert from "node:assert/strict";
import * as cache from "../toteat-cache.ts";

test("filterSnapshotToDateRange keeps only rows within the requested real-date window", () => {
  assert.equal(typeof cache.filterSnapshotToDateRange, "function");
  if (typeof cache.filterSnapshotToDateRange !== "function") return;

  const snapshot = cache.filterSnapshotToDateRange(
    {
      productRows: [
        {
          order_id: "A",
          date: "2026-04-20",
          product_name: "Foo",
          family: "Combos",
          channel: "Punto de Venta",
          quantity: 1,
          total_price: 100,
          total_tax: 10,
          total_cost: 30,
          total_discount: 0,
          is_personal: 1,
        },
        {
          order_id: "B",
          date: "2026-04-21",
          product_name: "Bar",
          family: "Combos",
          channel: "Punto de Venta",
          quantity: 1,
          total_price: 200,
          total_tax: 20,
          total_cost: 50,
          total_discount: 0,
          is_personal: 1,
        },
        {
          order_id: "C",
          date: "2026-04-24",
          product_name: "Baz",
          family: "Otros",
          channel: "Rappi",
          quantity: 1,
          total_price: 300,
          total_tax: 30,
          total_cost: 0,
          total_discount: 0,
          is_personal: -1,
        },
      ],
      orderRows: [
        {
          order_id: "A",
          date: "2026-04-20",
          channel: "Punto de Venta",
          total_sales: 100,
          total_tax: 10,
          total_discount: 0,
          total_cost: 30,
          counts_as_order: 1,
        },
        {
          order_id: "B",
          date: "2026-04-21",
          channel: "Punto de Venta",
          total_sales: 200,
          total_tax: 20,
          total_discount: 0,
          total_cost: 50,
          counts_as_order: 1,
        },
        {
          order_id: "C",
          date: "2026-04-24",
          channel: "Rappi",
          total_sales: 300,
          total_tax: 30,
          total_discount: 0,
          total_cost: 0,
          counts_as_order: 1,
        },
      ],
    },
    "2026-04-21",
    "2026-04-23",
  );

  assert.deepStrictEqual(snapshot, {
    productRows: [
      {
        order_id: "B",
        date: "2026-04-21",
        product_name: "Bar",
        family: "Combos",
        channel: "Punto de Venta",
        quantity: 1,
        total_price: 200,
        total_tax: 20,
        total_cost: 50,
        total_discount: 0,
        is_personal: 1,
      },
    ],
    orderRows: [
      {
        order_id: "B",
        date: "2026-04-21",
        channel: "Punto de Venta",
        total_sales: 200,
        total_tax: 20,
        total_discount: 0,
        total_cost: 50,
        counts_as_order: 1,
      },
    ],
  });
});
