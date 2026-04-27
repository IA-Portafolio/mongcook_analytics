#!/usr/bin/env node
/**
 * Generates src/product-empaque-map.ts from "Nueva Base Toteat1.xlsx".
 *
 * Source of truth: sheet "VENTAS X UND. NEG.", columns:
 *   - ID        → Toteat product ID
 *   - EMPAQUE   → family (Caja, Combo, Bowl, Platos Especiales, Adición, Bebidas, Otro)
 *   - TIPO      → Personal | No Personal (rest → Complemento)
 *
 * Run: node scripts/generate-product-map.cjs
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const XLSX_PATH = path.resolve(__dirname, "..", "Nueva Base Toteat1.xlsx");
const OUT_PATH = path.resolve(__dirname, "..", "src", "product-empaque-map.ts");

const FAMILY_FROM_EMPAQUE = {
  Caja: "Cajas",
  Combo: "Combos",
  Bowl: "Bowl",
  "Platos Especiales": "Platos Especiales",
  "Platos especiales": "Platos Especiales",
  "Adición": "Otros",
  Bebidas: "Otros",
  Otro: "Otros",
};

const TYPE_FROM_TIPO = {
  Personal: "Personal",
  "No Personal": "Compartir",
};

const wb = XLSX.readFile(XLSX_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["VENTAS X UND. NEG."], { defval: null });

const mapping = {};
const unknownEmpaque = new Set();

for (const row of rows) {
  const id = (row[" ID "] || "").toString().trim();
  const empaque = (row[" EMPAQUE "] || "").toString().trim();
  const tipo = (row[" TIPO "] || "").toString().trim();
  if (!id || !empaque) continue;
  if (mapping[id]) continue;

  const family = FAMILY_FROM_EMPAQUE[empaque];
  if (!family) unknownEmpaque.add(empaque);

  mapping[id] = {
    family: family || "Otros",
    type: TYPE_FROM_TIPO[tipo] || "Complemento",
  };
}

if (unknownEmpaque.size) {
  console.warn("Unknown empaque values (defaulted to Otros):", [...unknownEmpaque]);
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
  "// AUTO-GENERATED from \"Nueva Base Toteat1.xlsx\" (sheet: VENTAS X UND. NEG.).\n" +
  "// Do NOT edit by hand. Regenerate with: node scripts/generate-product-map.cjs\n" +
  "//\n" +
  "// Maps every Toteat product ID to its canonical family (derived from the\n" +
  "// \"EMPAQUE\" column) and its is_personal type (derived from \"TIPO\").\n\n" +
  "import type { ProductMapping } from \"../toteat.ts\";\n\n" +
  "export const PRODUCT_EMPAQUE_MAP: Record<string, ProductMapping> = {\n";

fs.writeFileSync(OUT_PATH, header + body + "\n};\n");
console.log("Wrote", OUT_PATH);
