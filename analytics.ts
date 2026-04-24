import type { SummaryMetrics } from "./db.ts";
import type { NormalizedSale, ToteatImportSnapshot } from "./toteat.ts";

export interface ComparativeTypeMetricRow {
  is_personal: number;
  family: string;
  quantity: number;
  sales: number;
  cost: number;
}

export interface ChannelMetricRow {
  channel: string;
  family: string;
  quantity: number;
  sales: number;
  cost: number;
}

export interface ProductMetricRow {
  product_name: string;
  family: string;
  channel: string;
  is_personal: number;
  quantity: number;
  sales: number;
  cost: number;
}

function familyMatches(row: NormalizedSale, families?: string[]) {
  return !families || families.length === 0 || families.includes(row.family);
}

function summarizeProducts(rows: NormalizedSale[]): SummaryMetrics {
  const orderIds = new Set<string>();
  const totals = rows.reduce(
    (acc, row) => {
      acc.totalSales += row.total_price + row.total_discount;
      acc.totalTax += row.total_tax;
      acc.totalCost += row.total_cost;
      acc.totalQuantity += row.quantity;
      acc.totalDiscount += row.total_discount;
      acc.totalMargin += row.total_price - row.total_tax - row.total_cost;
      orderIds.add(row.order_id);
      return acc;
    },
    {
      totalSales: 0,
      totalTax: 0,
      totalCost: 0,
      totalQuantity: 0,
      totalDiscount: 0,
      totalMargin: 0,
    },
  );

  return {
    ...totals,
    totalOrders: orderIds.size,
  };
}

export function summarizeSnapshot(snapshot: ToteatImportSnapshot, families?: string[]): SummaryMetrics {
  if (families && families.length > 0) {
    return summarizeProducts(snapshot.productRows.filter((row) => familyMatches(row, families)));
  }

  const orderTotals = snapshot.orderRows.reduce(
    (acc, row) => {
      acc.totalSales += row.total_sales;
      acc.totalTax += row.total_tax;
      acc.totalCost += row.total_cost;
      acc.totalOrders += row.counts_as_order;
      acc.totalDiscount += row.total_discount;
      acc.totalMargin += row.total_sales - row.total_discount - row.total_tax - row.total_cost;
      return acc;
    },
    {
      totalSales: 0,
      totalTax: 0,
      totalCost: 0,
      totalOrders: 0,
      totalDiscount: 0,
      totalMargin: 0,
    },
  );

  const totalQuantity = snapshot.productRows.reduce((sum, row) => sum + row.quantity, 0);

  return {
    ...orderTotals,
    totalQuantity,
  };
}

export function buildComparativeTypeMetrics(
  snapshot: ToteatImportSnapshot,
  families?: string[],
): ComparativeTypeMetricRow[] {
  const grouped = new Map<string, ComparativeTypeMetricRow>();

  for (const row of snapshot.productRows) {
    if (!familyMatches(row, families)) continue;
    const key = `${row.is_personal}|${row.family}`;
    const current = grouped.get(key) || {
      is_personal: row.is_personal,
      family: row.family,
      quantity: 0,
      sales: 0,
      cost: 0,
    };
    current.quantity += row.quantity;
    current.sales += row.total_price;
    current.cost += row.total_cost;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.is_personal === right.is_personal) return left.family.localeCompare(right.family);
    return left.is_personal - right.is_personal;
  });
}

export function buildChannelMetrics(snapshot: ToteatImportSnapshot, families?: string[]): ChannelMetricRow[] {
  const grouped = new Map<string, ChannelMetricRow>();

  for (const row of snapshot.productRows) {
    if (!familyMatches(row, families)) continue;
    const key = `${row.channel}|${row.family}`;
    const current = grouped.get(key) || {
      channel: row.channel,
      family: row.family,
      quantity: 0,
      sales: 0,
      cost: 0,
    };
    current.quantity += row.quantity;
    current.sales += row.total_price;
    current.cost += row.total_cost;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => {
    const channelOrder = left.channel.localeCompare(right.channel);
    return channelOrder === 0 ? left.family.localeCompare(right.family) : channelOrder;
  });
}

export function buildProductMetrics(
  snapshot: ToteatImportSnapshot,
  families?: string[],
  family?: string,
): ProductMetricRow[] {
  const grouped = new Map<string, ProductMetricRow>();

  for (const row of snapshot.productRows) {
    if (family && row.family !== family) continue;
    if (!family && !familyMatches(row, families)) continue;
    const key = `${row.product_name}|${row.family}|${row.channel}|${row.is_personal}`;
    const current = grouped.get(key) || {
      product_name: row.product_name,
      family: row.family,
      channel: row.channel,
      is_personal: row.is_personal,
      quantity: 0,
      sales: 0,
      cost: 0,
    };
    current.quantity += row.quantity;
    current.sales += row.total_price;
    current.cost += row.total_cost;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => {
    const familyOrder = left.family.localeCompare(right.family);
    if (familyOrder !== 0) return familyOrder;
    const productOrder = left.product_name.localeCompare(right.product_name);
    return productOrder === 0 ? left.channel.localeCompare(right.channel) : productOrder;
  });
}
