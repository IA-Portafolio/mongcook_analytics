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
    date TEXT,
    product_name TEXT,
    family TEXT,
    channel TEXT,
    quantity INTEGER,
    total_price REAL,
    total_cost REAL,
    total_discount REAL DEFAULT 0,
    is_personal INTEGER DEFAULT 1, -- 1 for Personal, 0 for No Personal
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_data(date);
  CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales_data(channel);
`);

// Migration: add total_discount column for existing DBs that predate it.
const cols = db.prepare("PRAGMA table_info(sales_data)").all() as { name: string }[];
if (!cols.some(c => c.name === 'total_discount')) {
  db.exec("ALTER TABLE sales_data ADD COLUMN total_discount REAL DEFAULT 0");
}

export default db;
