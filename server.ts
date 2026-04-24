import express from "express";
import { createServer as createViteServer } from "vite";
import { buildChannelMetrics, buildComparativeTypeMetrics, buildProductMetrics, summarizeSnapshot } from "./analytics.ts";
import db from "./db.ts";
import { resolveDashboardDateRange, todayDate } from "./src/lib/dashboard-range.ts";
import { backfillToteatCache, getAutoSyncRange, syncToteatRange } from "./toteat-cache.ts";
import {
  clampEndDateToLastClosedShift,
  fetchToteatShiftStatus,
  importToteatSnapshot,
  PRODUCT_MAP,
  type ProductMapping,
  type ToteatImportSnapshot,
  type ToteatShiftStatus,
} from "./toteat.ts";

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

  function parseFamiliesParam(families: unknown) {
    if (!families || typeof families !== "string") return undefined;
    const familyList = families
      .split(",")
      .map((family) => family.trim())
      .filter(Boolean);
    return familyList.length > 0 ? familyList : undefined;
  }

  let shiftStatusCache: { value: ToteatShiftStatus | null; expiresAt: number; inFlight: Promise<ToteatShiftStatus | null> | null } =
    { value: null, expiresAt: 0, inFlight: null };

  async function getCachedShiftStatus() {
    const now = Date.now();
    if (shiftStatusCache.value && now < shiftStatusCache.expiresAt) {
      return shiftStatusCache.value;
    }

    if (shiftStatusCache.inFlight) {
      return shiftStatusCache.inFlight;
    }

    shiftStatusCache.inFlight = fetchToteatShiftStatus(getToteatConfig())
      .then((value) => {
        shiftStatusCache.value = value;
        shiftStatusCache.expiresAt = Date.now() + 5 * 60 * 1000;
        shiftStatusCache.inFlight = null;
        return value;
      })
      .catch((error) => {
        console.warn("[shiftstatus] Failed to refresh Toteat shift status:", error?.message || error);
        shiftStatusCache.inFlight = null;
        return shiftStatusCache.value;
      });

    return shiftStatusCache.inFlight;
  }

  async function resolveEffectiveDateRange(startDate?: string, endDate?: string) {
    const requestedRange = resolveDashboardDateRange(
      { startDate, endDate },
      todayDate(),
    );
    const requestedStartDate = requestedRange.startDate;
    const requestedEndDate = requestedRange.endDate;

    if (requestedEndDate < todayDate()) {
      return { startDate: requestedStartDate, endDate: requestedEndDate };
    }

    const shiftStatus = await getCachedShiftStatus();
    return {
      startDate: requestedStartDate,
      endDate: clampEndDateToLastClosedShift(requestedEndDate, shiftStatus),
    };
  }

  const analyticsSnapshotCache = new Map<
    string,
    { value: ToteatImportSnapshot | null; expiresAt: number; inFlight: Promise<ToteatImportSnapshot> | null }
  >();

  async function getAnalyticsSnapshot(startDate: string, endDate: string) {
    const key = `${startDate}:${endDate}`;
    const existing = analyticsSnapshotCache.get(key);
    const now = Date.now();

    if (existing?.value && now < existing.expiresAt) {
      return existing.value;
    }

    if (existing?.inFlight) {
      return existing.inFlight;
    }

    const inFlight = importToteatSnapshot(getToteatConfig(), startDate, endDate)
      .then((snapshot) => {
        analyticsSnapshotCache.set(key, {
          value: snapshot,
          expiresAt: Date.now() + 5 * 60 * 1000,
          inFlight: null,
        });
        return snapshot;
      })
      .catch((error) => {
        analyticsSnapshotCache.delete(key);
        throw error;
      });

    analyticsSnapshotCache.set(key, {
      value: existing?.value || null,
      expiresAt: existing?.expiresAt || 0,
      inFlight,
    });

    return inFlight;
  }

  // Get Summary Metrics
  app.get("/api/metrics/summary", async (req, res) => {
    const { startDate, endDate, families } = req.query;
    const range = await resolveEffectiveDateRange(startDate as string | undefined, endDate as string | undefined);
    const snapshot = await getAnalyticsSnapshot(range.startDate, range.endDate);
    res.json(summarizeSnapshot(snapshot, parseFamiliesParam(families)));
  });

  // Get Comparative 1: Personal vs No Personal
  app.get("/api/metrics/comparative-type", async (req, res) => {
    const { startDate, endDate, families } = req.query;
    const range = await resolveEffectiveDateRange(startDate as string | undefined, endDate as string | undefined);
    const snapshot = await getAnalyticsSnapshot(range.startDate, range.endDate);
    res.json(buildComparativeTypeMetrics(snapshot, parseFamiliesParam(families)));
  });

  // Get Comparative 2: By Channel
  app.get("/api/metrics/comparative-channel", async (req, res) => {
    const { startDate, endDate, families } = req.query;
    const range = await resolveEffectiveDateRange(startDate as string | undefined, endDate as string | undefined);
    const snapshot = await getAnalyticsSnapshot(range.startDate, range.endDate);
    res.json(buildChannelMetrics(snapshot, parseFamiliesParam(families)));
  });

  // Product-level metrics
  app.get("/api/metrics/by-product", async (req, res) => {
    const { startDate, endDate, families, family } = req.query;
    const range = await resolveEffectiveDateRange(startDate as string | undefined, endDate as string | undefined);
    const snapshot = await getAnalyticsSnapshot(range.startDate, range.endDate);
    res.json(buildProductMetrics(snapshot, parseFamiliesParam(families), family as string | undefined));
  });

  // Mock Upload Endpoint (Simulation for MVP)
  app.post("/api/data/seed", (req, res) => {
    // Clear existing data for idempotency
    db.prepare('DELETE FROM sales_data').run();
    db.prepare('DELETE FROM sales_orders').run();

    const insert = db.prepare(`
      INSERT INTO sales_data (date, product_name, family, channel, quantity, total_price, total_cost, is_personal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO sales_orders (order_id, date, channel, total_sales, total_tax, total_discount, total_cost, counts_as_order)
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
      let orderCounter = 0;
      for (const row of data) {
        insert.run(...row);
        orderCounter += 1;
        const [date, _product, _family, channel, _quantity, price, cost] = row;
        insertOrder.run(`seed-${orderCounter}`, date, channel, price, 0, 0, cost, 1);
      }
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
      const result = await syncToteatRange(db, config, {
        startDate,
        endDate,
        clearExisting: clearExisting ?? true,
        customMapping: customMapping as Record<string, ProductMapping> | undefined,
      });

      res.json({
        message: "Toteat import successful",
        rows: result.productRows,
        orders: result.orderRows,
        dateRange: { startDate, endDate },
        channels: result.channels,
        families: result.families,
      });
    } catch (error: any) {
      console.error("Toteat import error:", error);
      res.status(502).json({ error: error.message || "Failed to fetch from Toteat API" });
    }
  });

  app.post("/api/toteat/backfill", async (req, res) => {
    const { startDate, endDate, useDevApi, customMapping } = req.body;
    const config = getToteatConfig({ useDevApi });

    try {
      const result = await backfillToteatCache(db, config, {
        startDate,
        endDate,
        clearExisting: true,
        customMapping: customMapping as Record<string, ProductMapping> | undefined,
      });

      res.json({
        message: "Toteat backfill successful",
        rows: result.productRows,
        orders: result.orderRows,
        dateRange: { startDate: result.startDate, endDate: result.endDate },
        channels: result.channels,
        families: result.families,
      });
    } catch (error: any) {
      console.error("Toteat backfill error:", error);
      res.status(502).json({ error: error.message || "Failed to backfill Toteat cache" });
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
      const snapshot = await importToteatSnapshot(config, startDate, endDate);

      // Summary without inserting
      const summary = {
        totalRows: snapshot.productRows.length,
        totalOrders: snapshot.orderRows.reduce((sum, row) => sum + row.counts_as_order, 0),
        totalSales: snapshot.orderRows.reduce((sum, row) => sum + row.total_sales, 0),
        totalTax: snapshot.orderRows.reduce((sum, row) => sum + row.total_tax, 0),
        totalDiscount: snapshot.orderRows.reduce((sum, row) => sum + row.total_discount, 0),
        totalCost: snapshot.orderRows.reduce((sum, row) => sum + row.total_cost, 0),
        channels: [...new Set(snapshot.productRows.map(row => row.channel))],
        families: [...new Set(snapshot.productRows.map(row => row.family))],
        unmappedProducts: snapshot.productRows.filter(row => row.family === 'Otros'),
        sample: snapshot.productRows.slice(0, 10),
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
      const { startDate, endDate } = getAutoSyncRange(db);

      if (startDate > endDate) return;

      console.log(`[auto-sync] Importing Toteat ${startDate} → ${endDate}`);
      const config = getToteatConfig();
      const result = await syncToteatRange(db, config, {
        startDate,
        endDate,
        clearExisting: true,
      });
      console.log(`[auto-sync] Done. ${result.productRows} product rows / ${result.orderRows} orders imported.`);
    } catch (err: any) {
      console.error('[auto-sync] Failed:', err.message || err);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Let the first interactive dashboard requests go through before background sync competes for rate limit.
    setTimeout(autoSyncToteat, 5 * 60 * 1000);
    setInterval(autoSyncToteat, 6 * 60 * 60 * 1000);
  });
}

startServer();
