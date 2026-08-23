import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function main() {
  const source = readFileSync(resolve(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
  const dashboardStart = source.indexOf("export default async function DashboardCockpit() {");
  const requireContext = source.indexOf("await requireUser();", dashboardStart);
  const firstTenantQuery = source.indexOf("getDashboardMetrics()", dashboardStart);
  assert.ok(dashboardStart >= 0 && requireContext > dashboardStart, "the protected dashboard must establish its own tenant context");
  assert.ok(requireContext < firstTenantQuery, "tenant context must be ready before any dashboard Prisma service runs");
  console.log("Dashboard tenant-context contract probe passed.");
}

main();
