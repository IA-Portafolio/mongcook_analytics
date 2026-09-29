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
  total_price: number;  // product.payed: cobrado, con impuesto, después de descuentos
  total_tax: number;    // impuesto embebido en total_price (INC 8% en Colombia)
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

// Canonical families: Combos, Cajas, Arma tu plato, Platos Especiales, Bowl, Otros.
// Platos mong (Chow Fan / Chow Suey / Chow Mein) live in Cajas.
// Arma tu plato is its own family — it is not Cajas and not Platos Especiales.
// Entradas / Bebidas / Adicionales fold into "Otros".
export const HIERARCHY_MAP: Record<string, ProductMapping> = {
  // Otros (entradas, bebidas, adicionales)
  'AB.010': { family: 'Otros', type: 'Complemento' },

  // Platos mong / cajas (fallback when product ID is unknown)
  'AB.020': { family: 'Cajas', type: 'Personal' },
  'AB.030040': { family: 'Cajas', type: 'Personal' },
  'AB.030050': { family: 'Cajas', type: 'Personal' },
  'AB.030055': { family: 'Cajas', type: 'Personal' },
  'AB.030060': { family: 'Cajas', type: 'Personal' },
  'AB.030070': { family: 'Cajas', type: 'Personal' },
  'AB.030075': { family: 'Cajas', type: 'Personal' },
  'AB.030080': { family: 'Cajas', type: 'Personal' },
  'AB.030085': { family: 'Cajas', type: 'Personal' },
  'AB.030090': { family: 'Cajas', type: 'Personal' },
  'AB.030100': { family: 'Cajas', type: 'Personal' },
  'AB.030210': { family: 'Cajas', type: 'Personal' },
  'AB.110': { family: 'Arma tu plato', type: 'Personal' },
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
  // IDs presentes en Toteat pero ausentes en "Nueva Base Toteat1.xlsx".
  // Hasta que se agreguen al Excel, los clasificamos manualmente para que
  // no caigan a "Otros" por el fallback. NO afectan cálculos de $ ni costos,
  // solo a qué familia pertenece el producto en el dashboard.
  'COMB14': { family: 'Combos', type: 'Personal' },     // Deditos de pollo (combo)
  'prom102': { family: 'Cajas', type: 'Compartir' },    // chow fan especial trio + papas
  'RAPP05': { family: 'Bowl', type: 'Personal' },       // BOWL KUMO
  'RAPP06': { family: 'Bowl', type: 'Personal' },       // BOWL TAO
  'BEB60': { family: 'Otros', type: 'Complemento' },    // Fuze tea durazno 1.2L (probable typo de BEB600)
};

// ── Channel Detection ────────────────────────────────────────────────
// Toteat doesn't have a direct "channel" field in sales.
// We infer from zoneName, product IDs, or comment.

export function detectChannel(order: ToteatOrder): string {
  const zone = (order.zoneName || '').toUpperCase();
  const comment = (order.comment || '').toUpperCase();
  const table = String(order.tableName || '').toUpperCase();
  const tableId = String(order.tableId ?? '').toUpperCase();
  const payments = (order.paymentForms || []).map((form) => String(form.name || '').toUpperCase()).join(' ');
  const haystack = `${zone} ${comment} ${table} ${tableId} ${payments}`;

  // Rappi: payment form, comment ("2476039037 Rappi"), table, or zone.
  if (haystack.includes('RAPPI')) return 'Rappi';

  // Own delivery / Toteat "Origen de Reserva = Telefono":
  // comments look like "*** DELIVERY D-105 ***" and sit on Virtual tables (V-101xx).
  if (
    haystack.includes('DELIVERY') ||
    haystack.includes('DOMICILIO') ||
    haystack.includes('DESPACHO') ||
    haystack.includes('TELEFON') ||
    haystack.includes('TELÉFON') ||
    table === 'VIRTUAL' ||
    tableId.startsWith('V-')
  ) {
    return 'Delivery Propio';
  }

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
      // Toteat sends discounts as a signed number (negative on sales, positive when an NC reverses one).
      // Net first, then take the absolute value so a sale+NC pair does not double-count.
      const netDiscount = events.reduce((sum, event) => sum + (event.discounts || 0), 0);
      const totalCost = events.reduce((sum, event) => sum + orderProductCost(event), 0);
      const hasCreditNote = events.some(
        (event) => event.fiscalType === "NC" || (event.total || 0) < 0 || (event.payed || 0) < 0,
      );
      const fullyCredited = hasCreditNote && Math.abs(totalSales) < 0.005;

      return {
        order_id: orderId,
        date: orderDate(primaryOrder),
        channel: detectChannel(primaryOrder),
        total_sales: totalSales,
        total_tax: fullyCredited ? 0 : totalTax,
        total_discount: fullyCredited ? 0 : Math.abs(netDiscount),
        total_cost: fullyCredited ? 0 : totalCost,
        counts_as_order: fullyCredited ? 0 : 1,
      };
    })
    .sort((left, right) => {
      if (left.date === right.date) return left.order_id.localeCompare(right.order_id);
      return left.date.localeCompare(right.date);
    });
}

// ── Classify a product ───────────────────────────────────────────────

export function classifyProduct(product: ToteatProduct, customMap?: Record<string, ProductMapping>): ProductMapping {
  // 1. Request-specific override takes absolute priority.
  if (customMap?.[product.id]) return customMap[product.id];

  // 2. Excel-driven mapping ("Nueva Base Toteat1.xlsx" → EMPAQUE column).
  //    This is the source of truth maintained by operations: every known
  //    Toteat product ID is classified here. See scripts/generate-product-map.cjs.
  if (PRODUCT_EMPAQUE_MAP[product.id]) return PRODUCT_EMPAQUE_MAP[product.id];

  // 3. Legacy hand-maintained overrides (IDs missing from the Excel catalog).
  if (PRODUCT_MAP[product.id]) return PRODUCT_MAP[product.id];

  // 4. Name-based detection for unmapped IDs (Toteat sometimes sends
  //    spelling/casing variants that are not in the catalog).
  const hname = (product.hierarchyName || '').toLowerCase();
  const pname = (product.name || '').toLowerCase();
  const isComboName = hname.includes('combo') || pname.startsWith('combo') || pname.includes('combo ');
  if (!isComboName && (pname.includes('chow fan') || pname.includes('chow mein') || pname.includes('chop suey') || pname.includes('valenciano'))) {
    const compartir = /trio|familiar|mega/.test(pname);
    return { family: 'Cajas', type: compartir ? 'Compartir' : 'Personal' };
  }
  if (!isComboName && (pname === 'arma tu plato' || hname.includes('arma tu plato'))) {
    return { family: 'Arma tu plato', type: 'Personal' };
  }

  // 5. Hierarchy-based mapping (fallback when product ID is unknown).
  if (HIERARCHY_MAP[product.hierarchyId]) return HIERARCHY_MAP[product.hierarchyId];

  // 6. Fallback: try to guess from hierarchy name
  if (hname.includes('arma tu plato') || (hname.includes('arma') && !hname.includes('combo'))) {
    return { family: 'Arma tu plato', type: 'Personal' };
  }
  if (hname.includes('caja') || pname.includes('caja') || hname.includes('platos mong') || hname.includes('chow')) {
    return { family: 'Cajas', type: 'Compartir' };
  }
  if (hname.includes('bowl') || pname.startsWith('bowl')) return { family: 'Bowl', type: 'Personal' };
  if (hname.includes('combo') && hname.includes('compartir')) return { family: 'Combos', type: 'Compartir' };
  if (hname.includes('combo') && hname.includes('personal')) return { family: 'Combos', type: 'Personal' };
  if (hname.includes('combo') || pname.startsWith('combo')) return { family: 'Combos', type: 'Personal' };
  if (hname.includes('entrada') || hname.includes('bebida') || hname.includes('adicional')) {
    return { family: 'Otros', type: 'Complemento' };
  }
  if (hname.includes('plato especial')) {
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

// ── Global request gate ──────────────────────────────────────────────
// Toteat allows 3 requests/minute per token, shared by every caller in this
// process (dashboard, background sync, diagnostics). Serializing all calls
// through one gate keeps us under the limit instead of retrying 429s until
// the request gives up.
const DEFAULT_REQUEST_GAP_MS = 21_000;
let requestGate: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function requestGapMs() {
  const configured = Number(process.env.TOTEAT_MIN_REQUEST_GAP_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_REQUEST_GAP_MS;
}

function toteatFetch(url: string): Promise<Response> {
  const turn = requestGate.then(async () => {
    const waitMs = lastRequestAt + requestGapMs() - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
  });
  requestGate = turn;
  return turn.then(() => fetch(url, { method: 'GET' }));
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
      response = await toteatFetch(url.toString());
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

  const response = await toteatFetch(url.toString());
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

  // Pacing is handled by the global request gate in toteatFetch.
  let chunkStart = new Date(start);
  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 14); // 15 days max
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const startStr = chunkStart.toISOString().slice(0, 10);
    const endStr = chunkEnd.toISOString().slice(0, 10);

    const orders = await fetchToteatSales(config, startStr, endStr);
    allOrders.push(...orders);

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
  excludedOrderIds?: Set<string>,
): NormalizedSale[] {
  const results: NormalizedSale[] = [];

  for (const order of dedupeOrderEvents(orders)) {
    if (excludedOrderIds?.has(String(order.orderId))) continue;
    const channel = detectChannel(order);
    const date = orderDate(order);

    for (const product of order.products) {
      // Skip zero-quantity and zero-revenue items (pure modifiers with no price or cost impact)
      if (product.quantity === 0 && product.netPrice === 0) continue;

      const mapping = classifyProduct(product, customMap);

      const discount = product.discounts || 0;
      // Toteat field mapping (Colombia, INC 8% incluido en el precio):
      //   order.total            = 1.ª "Total Venta Bruta" (antes de descuentos, con impuesto)
      //   order.discounts        = negativo en ventas; 1.ª línea menos esta = 2.ª "Total Venta Bruta"
      //   product.payed          = cobrado por el producto (después de descuentos, con impuesto)
      //   sum(product.payed)     = 2.ª "Total Venta Bruta" del resumen Toteat
      //   product.taxes          = impuesto embebido en payed
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
  const orderRows = buildOrderCacheRows(orders);
  const excludedOrderIds = new Set(
    orderRows.filter((row) => row.counts_as_order === 0).map((row) => row.order_id),
  );

  return {
    productRows: normalizeSales(orders, customMap, excludedOrderIds),
    orderRows,
  };
}
