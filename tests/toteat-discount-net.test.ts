import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderCacheRows, normalizeSales, type ToteatOrder } from "../toteat.ts";

function order(overrides: Partial<ToteatOrder> & { orderId: number }): ToteatOrder {
  return {
    paymentId: 1,
    paymentForms: [],
    fiscalId: "",
    fiscalAmt: 0,
    fiscalType: "BE",
    dateOpen: "2026-08-01T12:00:00",
    dateClosed: "2026-08-01T12:30:00",
    registerId: 1,
    registerName: "Caja 1",
    waiterId: 1,
    waiterName: "X",
    numberClients: 1,
    tableId: 1,
    tableName: "1",
    zoneId: "ZB.010",
    zoneName: "Salon Principal",
    subtotal: 0,
    discounts: 0,
    total: 0,
    totalWithGratuity: 0,
    taxes: 0,
    gratuity: 0,
    payed: 0,
    change: 0,
    products: [],
    client: {},
    comment: "",
    totalCost: 0,
    ...overrides,
  };
}

test("buildOrderCacheRows nets signed Toteat discounts instead of summing abs()", () => {
  const rows = buildOrderCacheRows([
    order({
      orderId: 10,
      discounts: -16000,
      total: 20000,
      taxes: 1481,
      payed: 4000,
    }),
    order({
      orderId: 10,
      fiscalType: "NC",
      discounts: 1000,
      total: -5000,
      taxes: 0,
      payed: -5000,
    }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_sales, 15000);
  assert.equal(rows[0].total_discount, 15000);
  assert.equal(rows[0].counts_as_order, 1);
});

test("fully credited sale+NC drops leftover tax so KPIs do not keep a cancelled ticket", () => {
  const rows = buildOrderCacheRows([
    order({
      orderId: 11,
      fiscalType: "BM",
      total: 41800,
      taxes: 3096,
      payed: 41800,
      totalCost: 12000,
      products: [
        {
          id: "COMB01",
          name: "COMBO 1",
          netPrice: 41800,
          unitCost: 12000,
          totalCost: 12000,
          payed: 41800,
          quantity: 1,
          discounts: 0,
          taxes: 3096,
          hierarchyId: "AB.160",
          hierarchyName: "Combos personales",
        },
      ],
    }),
    order({
      orderId: 11,
      fiscalType: "NC",
      total: -41800,
      taxes: 0,
      payed: -41800,
      totalCost: 0,
    }),
  ]);

  assert.deepEqual(rows[0], {
    order_id: "11",
    date: "2026-08-01",
    channel: "Punto de Venta",
    total_sales: 0,
    total_tax: 0,
    total_discount: 0,
    total_cost: 0,
    counts_as_order: 0,
  });
});

test("normalizeSales can drop products from fully credited orders", () => {
  const sale = order({
    orderId: 12,
    total: 28900,
    taxes: 2140.74,
    payed: 28900,
    products: [
      {
        id: "PESP04",
        name: "SUN KEE",
        netPrice: 28900,
        unitCost: 13638,
        totalCost: 13638,
        payed: 28900,
        quantity: 1,
        discounts: 0,
        taxes: 2140.74,
        hierarchyId: "AB.020",
        hierarchyName: "Platos Especiales",
      },
    ],
  });
  const credit = order({
    orderId: 12,
    fiscalType: "NC",
    total: -28900,
    taxes: 0,
    payed: -28900,
  });

  const included = normalizeSales([sale, credit]);
  assert.equal(included.length, 1);
  assert.equal(included[0].total_price, 28900);

  const excluded = normalizeSales([sale, credit], undefined, new Set(["12"]));
  assert.equal(excluded.length, 0);
});
