import Database from "better-sqlite3";

function openDatabase(filename: string) {
  return new Database(filename);
}

export type SQLiteDatabase = ReturnType<typeof openDatabase>;

export interface SummaryFilters {
  startDate?: string;
  endDate?: string;
  families?: string[];
}

export interface SummaryMetrics {
  totalSales: number;
  totalTax: number;
  totalCost: number;
  totalQuantity: number;
  totalOrders: number;
  totalDiscount: number;
  totalMargin: number;
}

export function initializeAnalyticsSchema(database: SQLiteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER,
      order_id TEXT,
      date TEXT,
      product_name TEXT,
      family TEXT,
      channel TEXT,
      quantity INTEGER,
      total_price REAL,
      total_tax REAL DEFAULT 0,
      total_cost REAL,
      total_discount REAL DEFAULT 0,
      is_personal INTEGER DEFAULT 1,
      FOREIGN KEY (upload_id) REFERENCES uploads(id)
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      date TEXT,
      channel TEXT,
      total_sales REAL,
      total_tax REAL DEFAULT 0,
      total_discount REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      counts_as_order INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_data(date);
    CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales_data(channel);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(date);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_order_id_date ON sales_orders(order_id, date);
  `);
}

export function runAnalyticsMigrations(database: SQLiteDatabase) {
  const salesDataCols = database.prepare("PRAGMA table_info(sales_data)").all() as { name: string }[];
  if (!salesDataCols.some(c => c.name === "total_discount")) {
    database.exec("ALTER TABLE sales_data ADD COLUMN total_discount REAL DEFAULT 0");
  }
  if (!salesDataCols.some(c => c.name === "total_tax")) {
    database.exec("ALTER TABLE sales_data ADD COLUMN total_tax REAL DEFAULT 0");
  }
  if (!salesDataCols.some(c => c.name === "order_id")) {
    database.exec("ALTER TABLE sales_data ADD COLUMN order_id TEXT");
  }

  const salesOrdersExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sales_orders'")
    .get() as { name?: string } | undefined;

  if (!salesOrdersExists?.name) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        date TEXT,
        channel TEXT,
        total_sales REAL,
        total_tax REAL DEFAULT 0,
        total_discount REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        counts_as_order INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(date);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_order_id_date ON sales_orders(order_id, date);
    `);
  }

  const salesOrderCols = database.prepare("PRAGMA table_info(sales_orders)").all() as { name: string }[];
  if (!salesOrderCols.some((column) => column.name === "counts_as_order")) {
    database.exec("ALTER TABLE sales_orders ADD COLUMN counts_as_order INTEGER DEFAULT 1");
  }

  database.exec("DROP INDEX IF EXISTS idx_sales_orders_order_id");
  database.exec("CREATE INDEX IF NOT EXISTS idx_sales_orders_order_id_date ON sales_orders(order_id, date)");
}

function buildFamilyWhereClause(families?: string[]) {
  if (!families || families.length === 0) {
    return { clause: "", params: [] as string[] };
  }

  return {
    clause: ` AND family IN (${families.map(() => "?").join(",")})`,
    params: families,
  };
}

function coerceSummaryRow(row: Partial<SummaryMetrics> | undefined, totalQuantity = 0): SummaryMetrics {
  return {
    totalSales: Number(row?.totalSales || 0),
    totalTax: Number(row?.totalTax || 0),
    totalCost: Number(row?.totalCost || 0),
    totalQuantity: Number(totalQuantity || 0),
    totalOrders: Number(row?.totalOrders || 0),
    totalDiscount: Number(row?.totalDiscount || 0),
    totalMargin: Number(row?.totalMargin || 0),
  };
}

function querySummaryFromProducts(database: SQLiteDatabase, filters: SummaryFilters): SummaryMetrics {
  const startDate = filters.startDate || "2000-01-01";
  const endDate = filters.endDate || "2099-12-31";
  const familyFilter = buildFamilyWhereClause(filters.families);

  const row = database
    .prepare(
      `
        SELECT
          COALESCE(SUM(total_price), 0) + COALESCE(SUM(total_discount), 0) as totalSales,
          COALESCE(SUM(total_tax), 0) as totalTax,
          COALESCE(SUM(total_cost), 0) as totalCost,
          COALESCE(SUM(quantity), 0) as totalQuantity,
          COUNT(DISTINCT order_id) as totalOrders,
          COALESCE(SUM(total_discount), 0) as totalDiscount,
          COALESCE(SUM(total_price) - SUM(total_tax) - SUM(total_cost), 0) as totalMargin
        FROM sales_data
        WHERE date BETWEEN ? AND ?${familyFilter.clause}
      `
    )
    .get(startDate, endDate, ...familyFilter.params) as Partial<SummaryMetrics> | undefined;

  return coerceSummaryRow(row, row?.totalQuantity || 0);
}

export function querySummaryMetrics(database: SQLiteDatabase, filters: SummaryFilters = {}): SummaryMetrics {
  if (filters.families && filters.families.length > 0) {
    // Family filters require product-level granularity to scope metrics correctly.
    return querySummaryFromProducts(database, filters);
  }

  const startDate = filters.startDate || "2000-01-01";
  const endDate = filters.endDate || "2099-12-31";

  const orderRow = database
    .prepare(
      `
        SELECT
          COALESCE(SUM(total_sales), 0) as totalSales,
          COALESCE(SUM(total_tax), 0) as totalTax,
          COALESCE(SUM(total_cost), 0) as totalCost,
          COALESCE(SUM(CASE WHEN counts_as_order = 1 THEN 1 ELSE 0 END), 0) as totalOrders,
          COALESCE(SUM(total_discount), 0) as totalDiscount,
          COALESCE(SUM(total_sales) - SUM(total_discount) - SUM(total_tax) - SUM(total_cost), 0) as totalMargin
        FROM sales_orders
        WHERE date BETWEEN ? AND ?
      `
    )
    .get(startDate, endDate) as Partial<SummaryMetrics> | undefined;

  const quantityRow = database
    .prepare(
      `
        SELECT COALESCE(SUM(quantity), 0) as totalQuantity
        FROM sales_data
        WHERE date BETWEEN ? AND ?
      `
    )
    .get(startDate, endDate) as { totalQuantity?: number } | undefined;

  return coerceSummaryRow(orderRow, quantityRow?.totalQuantity || 0);
}

const db = openDatabase("moongcook.db");

initializeAnalyticsSchema(db);
runAnalyticsMigrations(db);

export default db;
