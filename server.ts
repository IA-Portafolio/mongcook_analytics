import express from "express";
import { createServer as createViteServer } from "vite";
import db from "./db.ts";
import { importToteatSales, normalizeSales, PRODUCT_MAP, type ProductMapping } from "./toteat.ts";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: "connected" });
  });

  // Normalize legacy family names in the DB into the 5 canonical families:
  // Combos, Cajas, Platos Especiales, Bowl, Otros.
  // Runs once at startup and is exposed as an endpoint for manual re-run.
  function normalizeFamilies() {
    const run = db.transaction(() => {
      // Combos: any legacy singular/plural variant
      db.prepare("UPDATE sales_data SET family='Combos' WHERE family IN ('Combo','combos','combo')").run();
      // Cajas: legacy singular → plural canonical
      db.prepare("UPDATE sales_data SET family='Cajas' WHERE family IN ('Caja','cajas','caja')").run();
      // Bowl: drop the 's'
      db.prepare("UPDATE sales_data SET family='Bowl' WHERE family IN ('Bowls','bowl','bowls')").run();
      // Platos Especiales: fold Chow Fan/Suey/Mein + Arma tu Plato + Mong Express + Lo Nuevo
      db.prepare(`UPDATE sales_data SET family='Platos Especiales'
        WHERE family IN ('Chow Fan','Chow Suey','Chow Mein','Arma tu Plato','Mong Express','Lo Nuevo','platos especiales')`).run();
      // Otros: fold Entradas/Bebidas/Adicionales and the singular 'Otro'
      db.prepare("UPDATE sales_data SET family='Otros' WHERE family IN ('Otro','Entradas','Bebidas','Adicionales','otros','otro')").run();
    });
    run();
  }
  normalizeFamilies();

  app.post("/api/data/normalize-families", (_req, res) => {
    normalizeFamilies();
    const summary = db.prepare('SELECT family, COUNT(*) as rows, SUM(total_price) as sales FROM sales_data GROUP BY family ORDER BY sales DESC').all();
    res.json({ ok: true, families: summary });
  });

  // Get Summary Metrics
  app.get("/api/metrics/summary", (req, res) => {
    const { startDate, endDate, families } = req.query;

    let query = `
      SELECT
        SUM(total_price) as totalSales,
        SUM(total_cost) as totalCost,
        SUM(quantity) as totalQuantity,
        SUM(total_discount) as totalDiscount,
        (SUM(total_price) - SUM(total_cost)) as totalMargin
      FROM sales_data
      WHERE date BETWEEN ? AND ?
    `;
    const params: (string | number)[] = [
      (startDate as string) || '2000-01-01',
      (endDate as string) || '2099-12-31'
    ];

    if (families) {
      const familyList = (families as string).split(',').map(f => f.trim());
      query += ` AND family IN (${familyList.map(() => '?').join(',')})`;
      params.push(...familyList);
    }

    const result = db.prepare(query).get(...params);
    res.json(result);
  });

  // Get Comparative 1: Personal vs No Personal
  app.get("/api/metrics/comparative-type", (req, res) => {
    const { startDate, endDate, families } = req.query;

    let query = `
      SELECT
        is_personal,
        family,
        SUM(quantity) as quantity,
        SUM(total_price) as sales,
        SUM(total_cost) as cost
      FROM sales_data
      WHERE date BETWEEN ? AND ?
    `;
    const params: (string | number)[] = [
      (startDate as string) || '2000-01-01',
      (endDate as string) || '2099-12-31'
    ];

    if (families) {
      const familyList = (families as string).split(',').map(f => f.trim());
      query += ` AND family IN (${familyList.map(() => '?').join(',')})`;
      params.push(...familyList);
    }

    query += ` GROUP BY is_personal, family`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  // Get Comparative 2: By Channel
  app.get("/api/metrics/comparative-channel", (req, res) => {
    const { startDate, endDate, families } = req.query;

    let query = `
      SELECT
        channel,
        family,
        SUM(quantity) as quantity,
        SUM(total_price) as sales,
        SUM(total_cost) as cost
      FROM sales_data
      WHERE date BETWEEN ? AND ?
    `;
    const params: (string | number)[] = [
      (startDate as string) || '2000-01-01',
      (endDate as string) || '2099-12-31'
    ];

    if (families) {
      const familyList = (families as string).split(',').map(f => f.trim());
      query += ` AND family IN (${familyList.map(() => '?').join(',')})`;
      params.push(...familyList);
    }

    query += ` GROUP BY channel, family`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  // Product-level metrics
  app.get("/api/metrics/by-product", (req, res) => {
    const { startDate, endDate, families, family } = req.query;

    let query = `
      SELECT
        product_name,
        family,
        channel,
        is_personal,
        SUM(quantity) as quantity,
        SUM(total_price) as sales,
        SUM(total_cost) as cost
      FROM sales_data
      WHERE date BETWEEN ? AND ?
    `;
    const params: (string | number)[] = [
      (startDate as string) || '2000-01-01',
      (endDate as string) || '2099-12-31'
    ];

    if (family) {
      query += ` AND family = ?`;
      params.push(family as string);
    } else if (families) {
      const familyList = (families as string).split(',').map(f => f.trim());
      query += ` AND family IN (${familyList.map(() => '?').join(',')})`;
      params.push(...familyList);
    }

    query += ` GROUP BY product_name, family, channel, is_personal`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  // Mock Upload Endpoint (Simulation for MVP)
  app.post("/api/data/seed", (req, res) => {
    // Clear existing data for idempotency
    db.prepare('DELETE FROM sales_data').run();

    const insert = db.prepare(`
      INSERT INTO sales_data (date, product_name, family, channel, quantity, total_price, total_cost, is_personal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Main dish families (have personal/no-personal distinction)
    const mainFamilies = ['Bowl', 'Combos', 'Platos Especiales', 'Cajas'];
    // Complement family (is_personal = -1)
    const complementFamilies = ['Otros'];
    const channels = ['Punto de Venta', 'Delivery Propio', 'Rappi'];
    const dates = ['2024-02-17', '2024-02-18', '2024-02-19', '2024-02-20', '2024-02-21'];

    const products: Record<string, string[]> = {
      'Bowl': ['Bowl Pollo', 'Bowl Veggie', 'Bowl Teriyaki'],
      'Combos': ['Combo Familiar', 'Combo Duo', 'Combo Individual'],
      'Platos Especiales': ['Chow Fan Pollo', 'Chow Suey Especial', 'Chow Mein Camarón', 'Arroz Valenciano'],
      'Cajas': ['Caja Moong', 'Caja Sorpresa', 'Caja Premium'],
      'Otros': ['Rollito Primavera', 'Gyoza', 'Té Helado', 'Bebida Lata', 'Salsa Teriyaki'],
    };

    const unitPrices: Record<string, number> = {
      'Bowl': 6500, 'Combos': 12500, 'Platos Especiales': 9800, 'Cajas': 8200,
      'Otros': 2500,
    };

    const mockData: [string, string, string, string, number, number, number, number][] = [];

    // Main families: iterate personal/no-personal
    for (const date of dates) {
      for (const family of mainFamilies) {
        for (const channel of channels) {
          for (const isPersonal of [0, 1]) {
            const productList = products[family];
            const product = productList[Math.floor(Math.random() * productList.length)];
            const qty = Math.floor(Math.random() * 15) + 3;
            const unitPrice = unitPrices[family];
            const channelMultiplier = channel === 'Rappi' ? 1.15 : channel === 'Delivery Propio' ? 1.05 : 1.0;
            const price = Math.round(qty * unitPrice * channelMultiplier);
            const costRatio = 0.35 + Math.random() * 0.15;
            const cost = Math.round(price * costRatio);
            mockData.push([date, product, family, channel, qty, price, cost, isPersonal]);
          }
        }
      }
    }

    // Complement families: no personal distinction (is_personal = -1)
    for (const date of dates) {
      for (const family of complementFamilies) {
        for (const channel of channels) {
          const productList = products[family];
          const product = productList[Math.floor(Math.random() * productList.length)];
          const qty = Math.floor(Math.random() * 20) + 5;
          const unitPrice = unitPrices[family];
          const channelMultiplier = channel === 'Rappi' ? 1.15 : channel === 'Delivery Propio' ? 1.05 : 1.0;
          const price = Math.round(qty * unitPrice * channelMultiplier);
          const costRatio = 0.30 + Math.random() * 0.20;
          const cost = Math.round(price * costRatio);
          mockData.push([date, product, family, channel, qty, price, cost, -1]);
        }
      }
    }

    const transaction = db.transaction((data: typeof mockData) => {
      for (const row of data) insert.run(...row);
    });

    transaction(mockData);

    res.json({ message: "Data seeded successfully", rows: mockData.length });
  });

  // ── Toteat Integration ────────────────────────────────────────────

  // Build Toteat config from env vars or request body
  function getToteatConfig(body?: { useDevApi?: boolean }): import('./toteat.ts').ToteatConfig {
    return {
      baseUrl: body?.useDevApi ? 'https://apidev.toteat.com' : 'https://api.toteat.com',
      xir: process.env.TOTEAT_XIR || '4830279350616064',
      xil: process.env.TOTEAT_XIL || '1',
      xiu: process.env.TOTEAT_XIU || '1002',
      xapitoken: process.env.TOTEAT_API_TOKEN || 'JMjUI5JpDl1VMDCifkwzcscrLqa5ppBT',
    };
  }

  // Import sales from Toteat API → classify → insert into DB
  app.post("/api/toteat/import", async (req, res) => {
    const { startDate, endDate, clearExisting, useDevApi, customMapping } = req.body;

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
      return;
    }

    const config = getToteatConfig({ useDevApi });

    try {
      const sales = await importToteatSales(
        config,
        startDate,
        endDate,
        customMapping as Record<string, ProductMapping> | undefined,
      );

      // Optionally clear existing data for the period
      if (clearExisting) {
        db.prepare('DELETE FROM sales_data WHERE date BETWEEN ? AND ?').run(startDate, endDate);
      }

      // Insert into DB
      const insert = db.prepare(`
        INSERT INTO sales_data (date, product_name, family, channel, quantity, total_price, total_cost, total_discount, is_personal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = db.transaction((rows: typeof sales) => {
        for (const r of rows) {
          insert.run(r.date, r.product_name, r.family, r.channel, r.quantity, r.total_price, r.total_cost, r.total_discount, r.is_personal);
        }
      });

      transaction(sales);

      res.json({
        message: "Toteat import successful",
        rows: sales.length,
        dateRange: { startDate, endDate },
        channels: [...new Set(sales.map(s => s.channel))],
        families: [...new Set(sales.map(s => s.family))],
      });
    } catch (error: any) {
      console.error("Toteat import error:", error);
      res.status(502).json({ error: error.message || "Failed to fetch from Toteat API" });
    }
  });

  // Get current product mapping table
  app.get("/api/toteat/mapping", (req, res) => {
    res.json(PRODUCT_MAP);
  });

  // Preview: fetch from Toteat without saving to DB
  app.post("/api/toteat/preview", async (req, res) => {
    const { startDate, endDate, useDevApi } = req.body;

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
      return;
    }

    const config = getToteatConfig({ useDevApi });

    try {
      const sales = await importToteatSales(config, startDate, endDate);

      // Summary without inserting
      const summary = {
        totalRows: sales.length,
        totalSales: sales.reduce((a, s) => a + s.total_price, 0),
        totalCost: sales.reduce((a, s) => a + s.total_cost, 0),
        channels: [...new Set(sales.map(s => s.channel))],
        families: [...new Set(sales.map(s => s.family))],
        unmappedProducts: sales.filter(s => s.family === 'Otros'),
        sample: sales.slice(0, 10),
      };

      res.json(summary);
    } catch (error: any) {
      res.status(502).json({ error: error.message || "Failed to fetch from Toteat API" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  // ── Auto-sync from Toteat ─────────────────────────────────────────
  // Keeps the local DB in sync with Toteat without manual intervention.
  // Strategy: find the last date already imported, then re-import from
  // (lastDate - 2 days) up to today. The 2-day overlap covers late-arriving
  // orders that closed after a previous sync. clearExisting is scoped to
  // exactly that window so older data is never touched.
  async function autoSyncToteat() {
    try {
      const row = db.prepare('SELECT MAX(date) as lastDate FROM sales_data').get() as { lastDate: string | null };
      const today = new Date().toISOString().slice(0, 10);

      let startDate: string;
      if (row?.lastDate) {
        const d = new Date(row.lastDate);
        d.setDate(d.getDate() - 2); // re-import last 2 days to catch late orders
        startDate = d.toISOString().slice(0, 10);
      } else {
        // Empty DB: pull the last 30 days as a sensible first run
        const d = new Date();
        d.setDate(d.getDate() - 30);
        startDate = d.toISOString().slice(0, 10);
      }

      if (startDate > today) return;

      console.log(`[auto-sync] Importing Toteat ${startDate} → ${today}`);
      const config = getToteatConfig();
      const sales = await importToteatSales(config, startDate, today);

      const clearStmt = db.prepare('DELETE FROM sales_data WHERE date BETWEEN ? AND ?');
      const insert = db.prepare(`
        INSERT INTO sales_data (date, product_name, family, channel, quantity, total_price, total_cost, total_discount, is_personal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction((rows: typeof sales) => {
        clearStmt.run(startDate, today);
        for (const r of rows) {
          insert.run(r.date, r.product_name, r.family, r.channel, r.quantity, r.total_price, r.total_cost, r.total_discount, r.is_personal);
        }
      });
      tx(sales);
      console.log(`[auto-sync] Done. ${sales.length} rows imported.`);
    } catch (err: any) {
      console.error('[auto-sync] Failed:', err.message || err);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Run once on startup, then every 6 hours
    autoSyncToteat();
    setInterval(autoSyncToteat, 6 * 60 * 60 * 1000);
  });
}

startServer();
