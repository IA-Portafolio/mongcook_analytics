import db from "../db.ts";
import { backfillToteatCache } from "../toteat-cache.ts";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main() {
  const useDevApi = process.argv.includes("--useDevApi");
  const startDate = readArg("startDate");
  const endDate = readArg("endDate");

  const config = {
    baseUrl: useDevApi ? "https://apidev.toteat.com" : "https://api.toteat.com",
    xir: process.env.TOTEAT_XIR || "4830279350616064",
    xil: process.env.TOTEAT_XIL || "1",
    xiu: process.env.TOTEAT_XIU || "1002",
    xapitoken: process.env.TOTEAT_API_TOKEN || "JMjUI5JpDl1VMDCifkwzcscrLqa5ppBT",
  };

  const result = await backfillToteatCache(db, config, {
    startDate,
    endDate,
    clearExisting: true,
  });

  console.log(JSON.stringify({
    message: "Toteat backfill successful",
    dateRange: { startDate: result.startDate, endDate: result.endDate },
    productRows: result.productRows,
    orderRows: result.orderRows,
    channels: result.channels,
    families: result.families,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
