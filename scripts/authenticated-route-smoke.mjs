const baseUrl = (process.env.ERP_SMOKE_BASE_URL || "https://bimmers-erp.vercel.app").replace(/\/$/, "");
const baseUrl = (process.env.ERP_SMOKE_BASE_URL || "https://bimmers-erp.vercel.app").replace(/\/$/, "");
const cookie = process.env.ERP_SMOKE_COOKIE;
const routes = [
  "/",
  "/pos",
  "/catalog",
  "/inventory",
  "/invoices",
  "/returns",
  "/sales/returns",
  "/purchases/returns",
  "/accounts",
  "/cash",
  "/treasury",
  "/receipts",
  "/vouchers",
  "/reports",
  "/reports/daily-movement",
  "/dead-stock",
  "/reports/inventory-movement",
  "/audit-log",
  "/audit",
  "/users",
  "/settings",
  "/barcode",
  "/settings/barcode",
  "/settings/barcode-designer",
];

if (!cookie) {
  console.error("ERP_SMOKE_COOKIE is required. Supply an authenticated ERP session cookie through the environment; do not place credentials or cookies in source control.");
  process.exit(2);
}

const results = [];
for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { Cookie: cookie, "User-Agent": "Bimmers-ERP-route-smoke/1.0" },
    redirect: "manual",
  });
  const body = await response.text();
  const redirectedHome = response.status >= 300 && response.status < 400 && response.headers.get("location") === "/";
  const passed = response.status === 200 && !redirectedHome && !/لم يتم تأسيس سياق مستأجر|Application error: a server-side exception/i.test(body);
  results.push({ route, status: response.status, redirectedHome, passed });
}

console.table(results);
const failures = results.filter((result) => !result.passed);
if (failures.length) {
  console.error(`Authenticated route smoke failed for ${failures.length} route(s).`);
  process.exit(1);
}
console.log(`Authenticated route smoke passed for ${results.length} routes against ${baseUrl}.`);
