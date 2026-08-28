import test from "node:test";
import assert from "node:assert/strict";
import { detectChannel, type ToteatOrder } from "../toteat.ts";

function order(overrides: Partial<ToteatOrder> = {}): ToteatOrder {
  return {
    orderId: 1,
    paymentId: 1,
    paymentForms: [],
    fiscalId: "",
    fiscalAmt: 0,
    fiscalType: "BE",
    dateOpen: "2026-07-15T12:00:00",
    dateClosed: "2026-07-15T12:30:00",
    registerId: 1,
    registerName: "Caja 1",
    waiterId: 1,
    waiterName: "X",
    numberClients: 1,
    tableId: 1,
    tableName: "1",
    zoneId: "ZB.010",
    zoneName: "Salón Principal",
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

test("detectChannel keeps salon tables as Punto de Venta", () => {
  assert.equal(detectChannel(order()), "Punto de Venta");
});

test("detectChannel maps Toteat telephone delivery comments to Delivery Propio", () => {
  assert.equal(
    detectChannel(order({
      tableId: "V-10105",
      tableName: "Virtual",
      zoneId: "",
      zoneName: "",
      comment: "*** DELIVERY D-105 ***\n\nCLIENTE: ANDRES FORERO\nTELEF: 3152509073",
    })),
    "Delivery Propio",
  );
});

test("detectChannel maps virtual tables without comment to Delivery Propio", () => {
  assert.equal(
    detectChannel(order({
      tableId: "V-1",
      tableName: "Virtual",
      zoneId: "",
      zoneName: "",
      comment: "",
    })),
    "Delivery Propio",
  );
});

test("detectChannel maps Rappi payment and comment to Rappi even on Virtual tables", () => {
  assert.equal(
    detectChannel(order({
      tableId: "V-90004",
      tableName: "Virtual",
      zoneId: "",
      zoneName: "",
      paymentForms: [{ name: "Rappi", id: 9100, amount: 69900, comment: "" }],
      comment: "Delivery: D-80004\n2476039037 Rappi",
    })),
    "Rappi",
  );
});
