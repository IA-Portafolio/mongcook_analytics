#!/usr/bin/env node
/**
 * Generates src/product-empaque-map.ts from "Nueva Base Toteat1.xlsx".
 *
 * Source of truth: sheet "Jer-Tip-Emp" (catalogo de familias), with
 * hierarchy-aware corrections requested by operations:
 *   - Jerarquia "Arma tu plato" → family "Arma tu plato" (not Cajas)
 *   - Jerarquia "Platos mong"   → family "Cajas" (Chow Fan trio is NOT a plato especial)
 *   - Jerarquia "Platos especiales" → family "Platos Especiales"
 *   - Familia Caja/Combo/Bowl/Adición/Bebidas/Otro otherwise
 *
 * Run: node scripts/generate-product-map.cjs
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const XLSX_PATH = path.resolve(__dirname, "..", "Nueva Base Toteat1.xlsx");
const OUT_PATH = path.resolve(__dirname, "..", "src", "product-empaque-map.ts");

const FAMILY_FROM_FAMILIA = {
  Caja: "Cajas",
  Combo: "Combos",
  Bowl: "Bowl",
  "Platos Especiales": "Platos Especiales",
  "Platos especiales": "Platos Especiales",
  Adición: "Otros",
  Adicion: "Otros",
  Bebidas: "Otros",
  Otro: "Otros",
};

const TYPE_FROM_TIPO = {
  Personal: "Personal",
  "No Personal": "Compartir",
};

function canonicalFamily(familia, jerarquia) {
  const jer = String(jerarquia || "").trim().toLowerCase();
  if (jer === "arma tu plato") return "Arma tu plato";
  if (jer === "platos mong") return "Cajas";
  if (jer === "platos especiales") return "Platos Especiales";

  const family = FAMILY_FROM_FAMILIA[String(familia || "").trim()];
  return family || "Otros";
}

function canonicalType(tipo) {
  return TYPE_FROM_TIPO[String(tipo || "").trim()] || "Complemento";
}

const wb = XLSX.readFile(XLSX_PATH);
const jerRows = XLSX.utils.sheet_to_json(wb.Sheets["Jer-Tip-Emp"], { defval: null });
const ventasRows = XLSX.utils.sheet_to_json(wb.Sheets["VENTAS X UND. NEG."], { defval: null });

const mapping = {};
const unknownFamilia = new Set();

for (const row of jerRows) {
  const id = String(row["ID Producto **"] || "").trim();
  if (!id || mapping[id]) continue;
  const familia = String(row["Familia"] || "").trim();
  const jerarquia = String(row["Jerarquia"] || "").trim();
  const tipo = String(row["Tipo_1"] || row["Tipo"] || "").trim();
  if (familia && !FAMILY_FROM_FAMILIA[familia] && !/arma tu plato|platos mong|platos especiales/i.test(jerarquia)) {
    unknownFamilia.add(familia);
  }
  mapping[id] = {
    family: canonicalFamily(familia, jerarquia),
    type: canonicalType(tipo),
  };
}

// Fill any IDs that only appear in the sales sheet.
for (const row of ventasRows) {
  const id = String(row[" ID "] || "").trim();
  if (!id || mapping[id]) continue;
  const empaque = String(row[" EMPAQUE "] || "").trim();
  const jerarquia = String(row[" JERARQUIA "] || "").trim();
  const tipo = String(row[" TIPO "] || "").trim();
  mapping[id] = {
    family: canonicalFamily(empaque, jerarquia),
    type: canonicalType(tipo),
  };
}

if (unknownFamilia.size) {
  console.warn("Unknown familia values (defaulted to Otros):", [...unknownFamilia]);
}

const familyCounts = {};
for (const entry of Object.values(mapping)) {
  familyCounts[entry.family] = (familyCounts[entry.family] || 0) + 1;
}
console.log("Product IDs mapped:", Object.keys(mapping).length);
console.log("Family counts:", familyCounts);

const sortedEntries = Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b));
const body = sortedEntries
  .map(([id, entry]) => `  ${JSON.stringify(id)}: ${JSON.stringify(entry)},`)
  .join("\n");

const header =
  "// AUTO-GENERATED from \"Nueva Base Toteat1.xlsx\" (sheet: Jer-Tip-Emp).\n" +
  "// Do NOT edit by hand. Regenerate with: node scripts/generate-product-map.cjs\n" +
  "//\n" +
  "// Maps every Toteat product ID to its canonical family (Jerarquia-aware:\n" +
  "// Arma tu plato, Platos mong → Cajas, Platos especiales) and is_personal type.\n\n" +
  "import type { ProductMapping } from \"../toteat.ts\";\n\n" +
  "export const PRODUCT_EMPAQUE_MAP: Record<string, ProductMapping> = {\n";

fs.writeFileSync(OUT_PATH, header + body + "\n};\n");
console.log("Wrote", OUT_PATH);
