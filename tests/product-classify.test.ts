import test from "node:test";
import assert from "node:assert/strict";
import { classifyProduct } from "../toteat.ts";

test("Chow fan especial trio is Cajas, not Platos Especiales", () => {
  assert.deepEqual(
    classifyProduct({
      id: "MON101",
      name: "Chow fan especial trio",
      netPrice: 0,
      unitCost: 0,
      totalCost: 0,
      payed: 0,
      quantity: 1,
      discounts: 0,
      taxes: 0,
      hierarchyId: "AB.020",
      hierarchyName: "Platos mong",
    }),
    { family: "Cajas", type: "Compartir" },
  );
});

test("Arma tu plato is its own family, not Cajas", () => {
  assert.deepEqual(
    classifyProduct({
      id: "MON450",
      name: "Arma tu plato",
      netPrice: 0,
      unitCost: 0,
      totalCost: 0,
      payed: 0,
      quantity: 1,
      discounts: 0,
      taxes: 0,
      hierarchyId: "AB.110",
      hierarchyName: "Arma tu plato",
    }),
    { family: "Arma tu plato", type: "Personal" },
  );
});

test("SUN KEE stays in Platos Especiales", () => {
  assert.deepEqual(
    classifyProduct({
      id: "PESP04",
      name: "SUN KEE",
      netPrice: 0,
      unitCost: 0,
      totalCost: 0,
      payed: 0,
      quantity: 1,
      discounts: 0,
      taxes: 0,
      hierarchyId: "AB.140",
      hierarchyName: "Platos especiales",
    }),
    { family: "Platos Especiales", type: "Personal" },
  );
});

test("unmapped chop suey spelling variant is Cajas, not Platos Especiales", () => {
  assert.deepEqual(
    classifyProduct({
      id: "UNKNOWN-CHOP",
      name: "Chop suey especial trio",
      netPrice: 0,
      unitCost: 0,
      totalCost: 0,
      payed: 78100,
      quantity: 1,
      discounts: 0,
      taxes: 0,
      hierarchyId: "AB.140",
      hierarchyName: "Platos especiales",
    }),
    { family: "Cajas", type: "Compartir" },
  );
});

test("COMBO ARMA TU PLATO stays in Combos", () => {
  assert.deepEqual(
    classifyProduct({
      id: "COMP13",
      name: "COMBO ARMA TU PLATO",
      netPrice: 0,
      unitCost: 0,
      totalCost: 0,
      payed: 0,
      quantity: 1,
      discounts: 0,
      taxes: 0,
      hierarchyId: "AB.160",
      hierarchyName: "Combos personales",
    }),
    { family: "Combos", type: "Personal" },
  );
});
