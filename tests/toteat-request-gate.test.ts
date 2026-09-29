import test from "node:test";
import assert from "node:assert/strict";
import { fetchToteatSales, type ToteatConfig } from "../toteat.ts";

const CONFIG: ToteatConfig = {
  baseUrl: "https://api.toteat.test",
  xir: "1",
  xil: "1",
  xiu: "1",
  xapitoken: "token",
};

test("concurrent Toteat calls are spaced by the global request gate", async () => {
  process.env.TOTEAT_MIN_REQUEST_GAP_MS = "150";
  const startedAt: number[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    startedAt.push(Date.now());
    return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await Promise.all([
      fetchToteatSales(CONFIG, "2026-08-01", "2026-08-01"),
      fetchToteatSales(CONFIG, "2026-08-02", "2026-08-02"),
      fetchToteatSales(CONFIG, "2026-08-03", "2026-08-03"),
    ]);
  } finally {
    globalThis.fetch = original;
    delete process.env.TOTEAT_MIN_REQUEST_GAP_MS;
  }

  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1] - startedAt[0] >= 140, `gap was ${startedAt[1] - startedAt[0]}ms`);
  assert.ok(startedAt[2] - startedAt[1] >= 140, `gap was ${startedAt[2] - startedAt[1]}ms`);
});
