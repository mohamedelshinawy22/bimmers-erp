import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function main() {
  const source = readFileSync(resolve(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
  const dashboardStart = source.indexOf("export default async function DashboardCockpit() {");
  const requireContext = source.indexOf("withAuthenticatedTenant(() => Promise.all", dashboardStart);
  const firstTenantQuery = source.indexOf('dashboardFallback("metrics"', dashboardStart);
  assert.ok(dashboardStart >= 0 && requireContext > dashboardStart, "the protected dashboard must establish its own tenant context");
  assert.ok(requireContext < firstTenantQuery, "tenant context must be ready before any dashboard Prisma service runs");
  for (const loader of ["metrics", "recent-invoices", "sales-trend", "top-selling-parts", "company-profile"]) {
    assert.ok(source.includes(`dashboardFallback(\"${loader}\"`), `the ${loader} dashboard loader must have a safe fallback`);
  }
  console.log("Dashboard tenant-context contract probe passed.");
}

main();
