export interface SaleData {
  id: number;
  date: string;
  product_name: string;
  family: string;
  channel: string;
  quantity: number;
  total_price: number;
  total_cost: number;
  is_personal: number;
}

export interface KpiSummary {
  totalSales: number;
  totalCost: number;
  totalQuantity: number;
  totalMargin: number;
  totalDiscount: number;
}

export interface ComparativeData {
  is_personal: number;
  family: string;
  quantity: number;
  sales: number;
  cost: number;
}

export interface ChannelData {
  channel: string;
  family: string;
  quantity: number;
  sales: number;
  cost: number;
}

export interface FilterState {
  startDate: string;
  endDate: string;
  families: string[];
}
