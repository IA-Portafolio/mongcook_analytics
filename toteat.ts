/**
 * Toteat POS API Client
 *
 * Connects to /sales endpoint, fetches order data,
 * flattens products, and classifies each using hierarchy mapping.
 *
 * Auth: query params (xir, xil, xiu, xapitoken)
 * Dates: ini/end in YYYYMMDD format, max 15 days per request
 * Rate limit: 3 requests per minute
 *
 * Docs: https://developers.toteat.com/
 */

import { PRODUCT_EMPAQUE_MAP } from "./src/product-empaque-map.ts";

// ── Types ────────────────────────────────────────────────────────────

/** Product within a Toteat order */
export interface ToteatProduct {
  id: string;
  name: string;
  netPrice: number;
  unitCost: number;
  totalCost: number;
  payed: number;
  quantity: number;
  discounts: number;
  taxes: number;
  hierarchyId: string;
  hierarchyName: string;
  externalCostAccount?: string;
  externalSalesAccount?: string;
}

/** Raw order as returned by the Toteat /sales endpoint */
export interface ToteatOrder {
  orderId: number;
  paymentId: number;
  paymentForms: { name: string; id: number; amount: number; comment: string }[];
  fiscalId: string;
  fiscalAmt: number;
  fiscalType: string;
  dateOpen: string;   // "2026-03-01T18:54:23"
  dateClosed: string;
  registerId: number;
  registerName: string;
  waiterId: number;
  waiterName: string;
  numberClients: number;
  tableId: number | string;
  tableName: string;
  zoneId: string;
  zoneName: string;
  subtotal: number;
  discounts: number;
  total: number;
  totalWithGratuity: number;
  taxes: number;
  gratuity: number;
  payed: number;
  change: number;
  products: ToteatProduct[];
  client: Record<string, unknown>;
  comment: string;
  totalCost: number;
  store?: { externalId?: string };
}

/** Toteat /sales API response envelope */
export interface ToteatSalesResponse {
  ok: boolean;
  msg?: string;
  data: ToteatOrder[];
}

/** Product classification for mapping */
export interface ProductMapping {
  family: string;
  type: 'Personal' | 'Compartir' | 'Complemento';
}

/** Transformed record ready for our sales_data table */
export interface NormalizedSale {
  order_id: string;
  date: string;
  product_name: string;
  family: string;
  channel: string;
  quantity: number;
  total_price: number;  // netPrice - discounts (bruta con IVA, después de descuentos)
  total_tax: number;    // IVA del producto (ya incluido en total_price)
  total_cost: number;
  total_discount: number;
  is_personal: number; // 1 = Personal, 0 = Compartir, -1 = Complemento (no aplica)
}

/** Aggregated order record ready for our sales_orders table */
export interface CachedOrderSale {
  order_id: string;
  date: string;
  channel: string;
  total_sales: number;
  total_tax: number;
  total_discount: number;
  total_cost: number;
  counts_as_order: number;
}

export interface ToteatImportSnapshot {
  productRows: NormalizedSale[];
  orderRows: CachedOrderSale[];
}

export interface ToteatShiftStatus {
  status: string;
  date: string;
}

interface ToteatShiftStatusResponse {
  ok: boolean;
  msg?: string;
  data?: ToteatShiftStatus;
}

// ── Hierarchy → Family Mapping ───────────────────────────────────────
// Maps Toteat hierarchyId to our analytics families.
// This is the primary classification — product-level overrides below.

// Canonical families: Combos, Cajas, Platos Especiales, Bowl, Otros.
// Chow Fan / Chow Suey / Chow Mein / Arma tu Plato / Mong Express / Lo Nuevo
// are DISHES inside "Platos Especiales", not families of their own.
// Entradas / Bebidas / Adicionales fold into "Otros".
export const HIERARCHY_MAP: Record<string, ProductMapping> = {
  // Otros (entradas, bebidas, adicionales)
  'AB.010': { family: 'Otros', type: 'Complemento' },

  // Platos Especiales
  'AB.020': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030040': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030050': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030055': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030060': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030070': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030075': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030080': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030085': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030090': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030100': { family: 'Platos Especiales', type: 'Personal' },
  'AB.030210': { family: 'Platos Especiales', type: 'Personal' },
  'AB.110': { family: 'Platos Especiales', type: 'Personal' },
  'AB.140': { family: 'Platos Especiales', type: 'Personal' },
  'AB.250': { family: 'Platos Especiales', type: 'Personal' },

  // Adicionales / Bebidas → Otros
  'AB.120': { family: 'Otros', type: 'Complemento' },
  'AB.130': { family: 'Otros', type: 'Complemento' },

  // Combos
  'AB.145': { family: 'Combos', type: 'Compartir' },
  'AB.160': { family: 'Combos', type: 'Personal' },

  // Bowl
  'AB.255': { family: 'Bowl', type: 'Personal' },

  // Modifiers (extras selected within combos) → Otros
  'BA.500': { family: 'Otros', type: 'Complemento' },
  'BA.510': { family: 'Otros', type: 'Complemento' },
  'BA.550': { family: 'Otros', type: 'Complemento' },
  'BA.560': { family: 'Otros', type: 'Complemento' },
  'BA.570': { family: 'Otros', type: 'Complemento' },
  'BA.580': { family: 'Otros', type: 'Complemento' },
  'BA.590': { family: 'Otros', type: 'Complemento' },
  'BA.610': { family: 'Otros', type: 'Complemento' },
};

// ── Product-level overrides ──────────────────────────────────────────
// For products whose hierarchy doesn't reflect the correct family/type.
// e.g. trio/familiar/mega sizes are "Compartir" even if hierarchy says personal.

export const PRODUCT_MAP: Record<string, ProductMapping> = {
  // Platos especiales — trio/familiar/mega sizes → Compartir
  'MON101': { family: 'Platos Especiales', type: 'Compartir' },
  'MON102': { family: 'Platos Especiales', type: 'Compartir' },
  'MON103': { family: 'Platos Especiales', type: 'Compartir' },
  'MON111': { family: 'Platos Especiales', type: 'Compartir' },
  'MON121': { family: 'Platos Especiales', type: 'Compartir' },
  'MON131': { family: 'Platos Especiales', type: 'Compartir' },
  'MON132': { family: 'Platos Especiales', type: 'Compartir' },
  'MON133': { family: 'Platos Especiales', type: 'Compartir' },
  'MON301': { family: 'Platos Especiales', type: 'Compartir' },
  'MON302': { family: 'Platos Especiales', type: 'Compartir' },
  'MON321': { family: 'Platos Especiales', type: 'Compartir' },
  'RAPP01': { family: 'Platos Especiales', type: 'Compartir' },
  'RAPP03': { family: 'Platos Especiales', type: 'Compartir' },

  // Combos para compartir items that might land in wrong hierarchy
  'ATP01': { family: 'Combos', type: 'Compartir' },
  'ATP04': { family: 'Combos', type: 'Compartir' },
  'ATP06': { family: 'Combos', type: 'Compartir' },
  'ATP10': { family: 'Combos', type: 'Compartir' },
  'COMC02': { family: 'Combos', type: 'Compartir' },
  'COMC04': { family: 'Combos', type: 'Compartir' },
  'COMC06': { family: 'Combos', type: 'Compartir' },
  'COMC08': { family: 'Combos', type: 'Compartir' },

  // IDs presentes en Toteat pero ausentes en "Nueva Base Toteat1.xlsx".
  // Hasta que se agreguen al Excel, los clasificamos manualmente para que
  // no caigan a "Otros" por el fallback. NO afectan cálculos de $ ni costos,
  // solo a qué familia pertenece el producto en el dashboard.
  'COMB14': { family: 'Combos', type: 'Personal' },     // Deditos de pollo (combo)
  'prom102': { family: 'Combos', type: 'Compartir' },   // chow fan especial trio + papas
  'RAPP05': { family: 'Bowl', type: 'Personal' },       // BOWL KUMO
  'RAPP06': { family: 'Bowl', type: 'Personal' },       // BOWL TAO
  'BEB60': { family: 'Otros', type: 'Complemento' },    // Fuze tea durazno 1.2L (probable typo de BEB600)
};

// ── Channel Detection ────────────────────────────────────────────────
// Toteat doesn't have a direct "channel" field in sales.
// We infer from zoneName, product IDs, or comment.

function detectChannel(order: ToteatOrder): string {
  const zone = (order.zoneName || '').toUpperCase();
  const comment = (order.comment || '').toUpperCase();
  const table = (order.tableName || '').toUpperCase();

  // Rappi orders
  if (zone.includes('RAPPI') || comment.includes('RAPPI') || table.includes('RAPPI')) return 'Rappi';

  // Delivery / Domicilios
  if (zone.includes('DELIVERY') || zone.includes('DOMICILIO') || zone.includes('DESPACHO') ||
      comment.includes('DELIVERY') || comment.includes('DOMICILIO')) return 'Delivery Propio';

  // Default: Punto de Venta (in-store)
  return 'Punto de Venta';
}

function orderDate(order: ToteatOrder): string {
  return order.dateOpen?.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function addDays(date: string, amount: number): string {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value.toISOString().slice(0, 10);
}

function productSignature(product: ToteatProduct): string {
  return JSON.stringify([
    product.id || "",
    product.name || "",
    product.quantity || 0,
    product.payed || 0,
    product.discounts || 0,
    product.taxes || 0,
    product.totalCost || 0,
    product.hierarchyId || "",
  ]);
}

function orderEventSignature(order: ToteatOrder): string {
  return JSON.stringify({
    dateOpen: order.dateOpen || "",
    fiscalType: order.fiscalType || "",
    subtotal: order.subtotal || 0,
    discounts: order.discounts || 0,
    total: order.total || 0,
    totalWithGratuity: order.totalWithGratuity || 0,
    taxes: order.taxes || 0,
    gratuity: order.gratuity || 0,
    products: (order.products || []).map(productSignature),
  });
}

function orderProductCost(order: ToteatOrder): number {
  if (order.products?.length) {
    return order.products.reduce((sum, product) => sum + (product.totalCost || 0), 0);
  }

  return order.totalCost || 0;
}

function scoreOrderCandidate(order: ToteatOrder): number {
  const productCount = order.products?.length || 0;
  const totalMagnitude = Math.abs(order.total || 0);
  const closeTime = Date.parse(order.dateClosed || order.dateOpen || "");
  return (productCount * 1_000_000_000_000) + (totalMagnitude * 1_000_000) + (Number.isFinite(closeTime) ? closeTime : 0);
}

function pickPreferredOrder(existing: ToteatOrder, candidate: ToteatOrder): ToteatOrder {
  return scoreOrderCandidate(candidate) >= scoreOrderCandidate(existing) ? candidate : existing;
}

export function dedupeOrderEvents(orders: ToteatOrder[]): ToteatOrder[] {
  const uniqueEvents = new Map<string, ToteatOrder>();

  for (const order of orders) {
    const key = `${order.orderId}::${orderEventSignature(order)}`;
    const existing = uniqueEvents.get(key);
    uniqueEvents.set(key, existing ? pickPreferredOrder(existing, order) : order);
  }

  return [...uniqueEvents.values()];
}

export function dedupeOrdersById(orders: ToteatOrder[]): ToteatOrder[] {
  const uniqueOrders = new Map<string, ToteatOrder>();

  for (const order of dedupeOrderEvents(orders)) {
    const orderId = String(order.orderId);
    const existing = uniqueOrders.get(orderId);
    uniqueOrders.set(orderId, existing ? pickPreferredOrder(existing, order) : order);
  }

  return [...uniqueOrders.values()];
}

export function buildOrderCacheRows(orders: ToteatOrder[]): CachedOrderSale[] {
  const groupedOrders = new Map<string, ToteatOrder[]>();

  for (const order of dedupeOrderEvents(orders)) {
    const orderId = String(order.orderId);
    const existing = groupedOrders.get(orderId) || [];
    existing.push(order);
    groupedOrders.set(orderId, existing);
  }

  return [...groupedOrders.entries()]
    .map(([orderId, events]) => {
      const primaryOrder = events.reduce((best, candidate) => pickPreferredOrder(best, candidate));
      const totalSales = events.reduce((sum, event) => sum + (event.total || 0), 0);
      const totalTax = events.reduce((sum, event) => sum + (event.taxes || 0), 0);
      const totalDiscount = events.reduce((sum, event) => sum + Math.abs(event.discounts || 0), 0);
      const totalCost = events.reduce((sum, event) => sum + orderProductCost(event), 0);
      const hasCreditNote = events.some(
        (event) => event.fiscalType === "NC" || (event.total || 0) < 0 || (event.payed || 0) < 0,
      );

      return {
        order_id: orderId,
        date: orderDate(primaryOrder),
        channel: detectChannel(primaryOrder),
        total_sales: totalSales,
        total_tax: totalTax,
        total_discount: totalDiscount,
        total_cost: totalCost,
        counts_as_order: hasCreditNote && Math.abs(totalSales) < 0.005 ? 0 : 1,
      };
    })
    .sort((left, right) => {
      if (left.date === right.date) return left.order_id.localeCompare(right.order_id);
      return left.date.localeCompare(right.date);
    });
}

// ── Classify a product ───────────────────────────────────────────────

function classifyProduct(product: ToteatProduct, customMap?: Record<string, ProductMapping>): ProductMapping {
  // 1. Request-specific override takes absolute priority.
  if (customMap?.[product.id]) return customMap[product.id];

  // 2. Excel-driven mapping ("Nueva Base Toteat1.xlsx" → EMPAQUE column).
  //    This is the source of truth maintained by operations: every known
  //    Toteat product ID is classified here. See scripts/generate-product-map.cjs.
  if (PRODUCT_EMPAQUE_MAP[product.id]) return PRODUCT_EMPAQUE_MAP[product.id];

  // 3. Legacy hand-maintained overrides (trio/familiar/mega sizes etc.).
  if (PRODUCT_MAP[product.id]) return PRODUCT_MAP[product.id];

  // 4. Hierarchy-based mapping (fallback when product ID is unknown).
  if (HIERARCHY_MAP[product.hierarchyId]) return HIERARCHY_MAP[product.hierarchyId];

  // 3. Fallback: try to guess from hierarchy name
  const hname = (product.hierarchyName || '').toLowerCase();
  const pname = (product.name || '').toLowerCase();
  if (hname.includes('caja') || pname.includes('caja')) return { family: 'Cajas', type: 'Compartir' };
  if (hname.includes('bowl') || pname.startsWith('bowl')) return { family: 'Bowl', type: 'Personal' };
  if (hname.includes('combo') && hname.includes('compartir')) return { family: 'Combos', type: 'Compartir' };
  if (hname.includes('combo') && hname.includes('personal')) return { family: 'Combos', type: 'Personal' };
  if (hname.includes('combo') || pname.startsWith('combo')) return { family: 'Combos', type: 'Personal' };
  if (hname.includes('entrada') || hname.includes('bebida') || hname.includes('adicional')) {
    return { family: 'Otros', type: 'Complemento' };
  }
  if (hname.includes('plato') || hname.includes('chow') || hname.includes('especial') ||
      hname.includes('mong') || hname.includes('arma')) {
    return { family: 'Platos Especiales', type: 'Personal' };
  }

  // 4. Default
  return { family: 'Otros', type: 'Complemento' };
}

// ── API Client ───────────────────────────────────────────────────────

export interface ToteatConfig {
  baseUrl: string;    // "https://api.toteat.com" (production) or "https://apidev.toteat.com" (dev)
  xir: string;        // Restaurant ID
  xil: string;        // Local ID
  xiu: string;        // User ID
  xapitoken: string;  // API Token
}

/** Convert YYYY-MM-DD to YYYYMMDD */
function toToteatDate(date: string): string {
  return date.replace(/-/g, '');
}

export async function fetchToteatSales(
  config: ToteatConfig,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
): Promise<ToteatOrder[]> {
  const url = new URL('/mw/or/1.0/sales', config.baseUrl);
  url.searchParams.set('xir', config.xir);
  url.searchParams.set('xil', config.xil);
  url.searchParams.set('xiu', config.xiu);
  url.searchParams.set('xapitoken', config.xapitoken);
  url.searchParams.set('ini', toToteatDate(startDate));
  url.searchParams.set('end', toToteatDate(endDate));

  let response: Response | null = null;
  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < 5) {
    try {
      response = await fetch(url.toString(), { method: 'GET' });
    } catch (error) {
      lastError = error;
      const waitMs = 5000 * (attempts + 1);
      console.warn(`[toteat] network error, retrying in ${waitMs / 1000}s (attempt ${attempts + 1}/5)`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      attempts++;
      continue;
    }

    if (response.status !== 429) break;

    const waitMs = 25000 * (attempts + 1);
    console.warn(`[toteat] 429 rate-limited, waiting ${waitMs / 1000}s (attempt ${attempts + 1}/5)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = null;
    attempts++;
  }

  if (!response) {
    if (lastError instanceof Error) throw lastError;
    throw new Error("fetch failed");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Toteat API error ${response.status}: ${response.statusText}. ${body}`);
  }

  const json = await response.json() as ToteatSalesResponse;

  if (!json.ok) {
    throw new Error(`Toteat API returned error: ${json.msg || 'Unknown error'}`);
  }

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('Unexpected Toteat API response format');
  }

  return json.data;
}

export async function fetchToteatShiftStatus(config: ToteatConfig): Promise<ToteatShiftStatus | null> {
  const url = new URL('/mw/or/1.0/shiftstatus', config.baseUrl);
  url.searchParams.set('xir', config.xir);
  url.searchParams.set('xil', config.xil);
  url.searchParams.set('xiu', config.xiu);
  url.searchParams.set('xapitoken', config.xapitoken);

  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Toteat shiftstatus error ${response.status}: ${response.statusText}. ${body}`);
  }

  const json = (await response.json()) as ToteatShiftStatusResponse;
  if (!json.ok) {
    throw new Error(`Toteat shiftstatus returned error: ${json.msg || "Unknown error"}`);
  }

  return json.data || null;
}

export function clampEndDateToLastClosedShift(
  endDate: string,
  shiftStatus?: ToteatShiftStatus | null,
): string {
  if (!shiftStatus || shiftStatus.status !== "open" || !shiftStatus.date) {
    return endDate;
  }

  const openShiftDate = shiftStatus.date.slice(0, 10);
  const lastClosedDate = addDays(openShiftDate, -1);

  return endDate < lastClosedDate ? endDate : lastClosedDate;
}

/** Fetch sales across a period longer than 15 days by splitting into chunks */
export async function fetchToteatSalesChunked(
  config: ToteatConfig,
  startDate: string,
  endDate: string,
): Promise<ToteatOrder[]> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const allOrders: ToteatOrder[] = [];
  let windowStartedAt = Date.now();
  let requestsInWindow = 0;

  let chunkStart = new Date(start);
  while (chunkStart <= end) {
    if (requestsInWindow >= 3) {
      const elapsedMs = Date.now() - windowStartedAt;
      if (elapsedMs < 60_000) {
        await new Promise((resolve) => setTimeout(resolve, 60_000 - elapsedMs));
      }
      windowStartedAt = Date.now();
      requestsInWindow = 0;
    }

    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 14); // 15 days max
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const startStr = chunkStart.toISOString().slice(0, 10);
    const endStr = chunkEnd.toISOString().slice(0, 10);

    const orders = await fetchToteatSales(config, startStr, endStr);
    allOrders.push(...orders);
    requestsInWindow += 1;

    // Move to next chunk
    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  return allOrders;
}

// ── Transform & Classify ─────────────────────────────────────────────

export function normalizeSales(
  orders: ToteatOrder[],
  customMap?: Record<string, ProductMapping>,
): NormalizedSale[] {
  const results: NormalizedSale[] = [];

  for (const order of dedupeOrderEvents(orders)) {
    const channel = detectChannel(order);
    const date = orderDate(order);

    for (const product of order.products) {
      // Skip zero-quantity and zero-revenue items (pure modifiers with no price or cost impact)
      if (product.quantity === 0 && product.netPrice === 0) continue;

      const mapping = classifyProduct(product, customMap);

      const discount = product.discounts || 0;
      // product.payed = amount customer paid for this product (post-discount, with IVA).
      // sum(product.payed) = order.total + order.discounts = "Total Venta Bruta" del dashboard Toteat.
      // product.taxes = IVA embebido en payed (para calcular Venta Neta = payed - taxes).
      results.push({
        order_id: String(order.orderId),
        date,
        product_name: product.name,
        family: mapping.family,
        channel,
        quantity: product.quantity,
        total_price: product.payed || 0,
        total_tax: product.taxes || 0,
        total_cost: product.totalCost,
        total_discount: Math.abs(discount),
        is_personal: mapping.type === 'Personal' ? 1 : mapping.type === 'Compartir' ? 0 : -1,
      });
    }
  }

  return results;
}

// ── Full Pipeline: Fetch → Classify → Return ─────────────────────────

export async function importToteatSales(
  config: ToteatConfig,
  startDate: string,
  endDate: string,
  customMap?: Record<string, ProductMapping>,
): Promise<NormalizedSale[]> {
  const snapshot = await importToteatSnapshot(config, startDate, endDate, customMap);
  return snapshot.productRows;
}

export async function importToteatSnapshot(
  config: ToteatConfig,
  startDate: string,
  endDate: string,
  customMap?: Record<string, ProductMapping>,
): Promise<ToteatImportSnapshot> {
  const orders = await fetchToteatSalesChunked(config, startDate, endDate);

  return {
    productRows: normalizeSales(orders, customMap),
    orderRows: buildOrderCacheRows(orders),
  };
}
