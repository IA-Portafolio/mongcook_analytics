import Database from 'better-sqlite3';

const db = new Database('moongcook.db');

// Initialize schema
db.exec(`
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
    is_personal INTEGER DEFAULT 1, -- 1 for Personal, 0 for No Personal
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_data(date);
  CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales_data(channel);
`);

// Migrations: add columns for existing DBs that predate them.
const cols = db.prepare("PRAGMA table_info(sales_data)").all() as { name: string }[];
if (!cols.some(c => c.name === 'total_discount')) {
  db.exec("ALTER TABLE sales_data ADD COLUMN total_discount REAL DEFAULT 0");
}
if (!cols.some(c => c.name === 'total_tax')) {
  db.exec("ALTER TABLE sales_data ADD COLUMN total_tax REAL DEFAULT 0");
}
if (!cols.some(c => c.name === 'order_id')) {
  db.exec("ALTER TABLE sales_data ADD COLUMN order_id TEXT");
}

export default db;
