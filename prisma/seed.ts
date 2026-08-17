/**
 * BimmerERP — Foundational Seed Engine
 * Seeds BMW chassis/engine master data, OEM brands, warehouse bins,
 * the default treasury, the walk-in account and the bootstrap super-admin.
 *
 * Idempotent: safe to re-run. Uses upsert instead of TRUNCATE so it can be
 * executed against a live database without destroying transactional history.
 * Pass --force-reset to wipe master data first (development only).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const FORCE_RESET = process.argv.includes("--force-reset");

/**
 * `--force-reset` TRUNCATEs every table, including Invoice, TreasuryTransaction,
 * StockMovement and SystemAuditTrail — irreversible loss of all transactional and
 * audit history. A single stray CLI flag must not be able to do that, and
 * `prisma/` ships inside the production image, so this is gated three ways:
 *
 *   1. NODE_ENV must not be production
 *   2. CONFIRM_RESET must exactly equal the connected database name
 *   3. The flag itself must be present
 */
async function assertResetAllowed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to --force-reset with NODE_ENV=production.");
  }

  const [row] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const dbName = row?.db ?? "";
  const confirm = process.env.CONFIRM_RESET;

  if (!confirm || confirm !== dbName) {
    throw new Error(
      `Refusing to --force-reset database "${dbName}".\n` +
        `This destroys ALL invoices, treasury movements, stock ledger rows and audit history.\n` +
        `To proceed you must name the database explicitly:\n\n` +
        `    CONFIRM_RESET=${dbName} npm run db:seed -- --force-reset\n`,
    );
  }
  console.warn(`⚠  --force-reset confirmed for "${dbName}" — wiping ALL data.`);
}

const CHASSIS_LIST = [
  { code: "E30", series: "3 Series", productionStartYear: 1982, productionEndYear: 1994 },
  { code: "E36", series: "3 Series", productionStartYear: 1990, productionEndYear: 2000 },
  { code: "E46", series: "3 Series", productionStartYear: 1997, productionEndYear: 2006 },
  { code: "E90", series: "3 Series", productionStartYear: 2004, productionEndYear: 2013 },
  { code: "F30", series: "3 Series", productionStartYear: 2011, productionEndYear: 2019 },
  { code: "G20", series: "3 Series", productionStartYear: 2018, productionEndYear: 2026 },
  { code: "E39", series: "5 Series", productionStartYear: 1995, productionEndYear: 2004 },
  { code: "E60", series: "5 Series", productionStartYear: 2003, productionEndYear: 2010 },
  { code: "F10", series: "5 Series", productionStartYear: 2010, productionEndYear: 2017 },
  { code: "G30", series: "5 Series", productionStartYear: 2016, productionEndYear: 2024 },
  { code: "E53", series: "X5 Series", productionStartYear: 1999, productionEndYear: 2006 },
  { code: "E70", series: "X5 Series", productionStartYear: 2006, productionEndYear: 2013 },
  { code: "F15", series: "X5 Series", productionStartYear: 2013, productionEndYear: 2018 },
  { code: "G05", series: "X5 Series", productionStartYear: 2018, productionEndYear: 2026 },
  { code: "E83", series: "X3 Series", productionStartYear: 2003, productionEndYear: 2010 },
  { code: "F25", series: "X3 Series", productionStartYear: 2010, productionEndYear: 2017 },
  { code: "G01", series: "X3 Series", productionStartYear: 2017, productionEndYear: 2026 },
  { code: "E65", series: "7 Series", productionStartYear: 2001, productionEndYear: 2008 },
  { code: "F01", series: "7 Series", productionStartYear: 2008, productionEndYear: 2015 },
  { code: "G11", series: "7 Series", productionStartYear: 2015, productionEndYear: 2022 },
];

const ENGINE_LIST = [
  { code: "M40", displacement: "1.6L / 1.8L", fuelType: "Petrol" },
  { code: "M52", displacement: "2.0L / 2.8L", fuelType: "Petrol" },
  { code: "M54", displacement: "2.5L / 3.0L", fuelType: "Petrol" },
  { code: "N42", displacement: "1.8L / 2.0L Valvetronic", fuelType: "Petrol" },
  { code: "N46", displacement: "2.0L Valvetronic", fuelType: "Petrol" },
  { code: "N52", displacement: "2.5L / 3.0L", fuelType: "Petrol" },
  { code: "N54", displacement: "3.0L TwinTurbo", fuelType: "Petrol" },
  { code: "N55", displacement: "3.0L TwinPower", fuelType: "Petrol" },
  { code: "N20", displacement: "2.0L TwinPower", fuelType: "Petrol" },
  { code: "N63", displacement: "4.4L V8 TwinTurbo", fuelType: "Petrol" },
  { code: "B38", displacement: "1.5L Modular Turbo", fuelType: "Petrol" },
  { code: "B48", displacement: "2.0L Modular Turbo", fuelType: "Petrol" },
  { code: "B58", displacement: "3.0L Inline-6 Turbo", fuelType: "Petrol" },
  { code: "S55", displacement: "3.0L M-TwinPower", fuelType: "Petrol" },
  { code: "S58", displacement: "3.0L M-TwinPower", fuelType: "Petrol" },
  { code: "N47", displacement: "2.0L Diesel", fuelType: "Diesel" },
  { code: "B47", displacement: "2.0L Diesel Modular", fuelType: "Diesel" },
  { code: "M57", displacement: "3.0L Diesel", fuelType: "Diesel" },
];

const BRANDS = [
  { name: "Genuine BMW", originCountry: "Germany", isOem: true },
  { name: "BMW Value Line", originCountry: "Germany", isOem: true },
  { name: "Brembo", originCountry: "Italy", isOem: false },
  { name: "Lemförder", originCountry: "Germany", isOem: false },
  { name: "Bosch", originCountry: "Germany", isOem: false },
  { name: "Febi Bilstein", originCountry: "Germany", isOem: false },
  { name: "Meyle HD", originCountry: "Germany", isOem: false },
  { name: "Mahle", originCountry: "Germany", isOem: false },
  { name: "Sachs", originCountry: "Germany", isOem: false },
  { name: "TRW", originCountry: "Germany", isOem: false },
  { name: "Hella", originCountry: "Germany", isOem: false },
  { name: "Textar", originCountry: "Germany", isOem: false },
];

const CATEGORIES = [
  "الفرامل",
  "التعليق والمقصات",
  "المحرك",
  "الكهرباء والإشعال",
  "التبريد والرادياتير",
  "ناقل الحركة",
  "العفشة والمساعدين",
  "الفلاتر والزيوت",
  "الهيكل والصدامات",
  "التكييف",
];

const SETTINGS = [
  { key: "COMPANY_NAME", value: "بيمرز لقطع غيار BMW", group: "GENERAL", label: "اسم الشركة" },
  { key: "COMPANY_PHONE", value: "+20 100 000 0000", group: "GENERAL", label: "تليفون الشركة" },
  { key: "COMPANY_ADDRESS", value: "القاهرة - مصر", group: "GENERAL", label: "عنوان الشركة" },
  { key: "TAX_NUMBER", value: "", group: "TAX", label: "الرقم الضريبي" },
  { key: "TAX_RATE_PERCENT", value: "0", group: "TAX", label: "نسبة ضريبة القيمة المضافة %" },
  { key: "INVOICE_FOOTER", value: "قطع غيار BMW أصلية بضمان المصنع", group: "PRINTING", label: "تذييل الفاتورة" },
  { key: "ALLOW_NEGATIVE_STOCK", value: "false", group: "INVENTORY", label: "السماح بالبيع بالسالب" },
  { key: "ENFORCE_MIN_SELL_PRICE", value: "true", group: "PRICING", label: "إجبار حد السعر الأدنى" },
  { key: "ENFORCE_CREDIT_LIMIT", value: "true", group: "PRICING", label: "إجبار حد الائتمان" },
  {
    key: "MAX_INVOICE_DISCOUNT_PERCENT",
    value: "20",
    group: "PRICING",
    label: "أقصى نسبة خصم على الفاتورة % (يتجاوزها المدير فقط)",
  },
];

function buildBins() {
  const bins: Prisma.WarehouseBinCreateManyInput[] = [];
  const warehouseName = "المستودع الرئيسي";
  for (const aisle of ["A1", "A2", "B1", "B2"]) {
    for (const rack of ["01", "02", "03"]) {
      for (const shelf of ["A", "B", "C"]) {
        for (const boxBin of ["01", "02"]) {
          bins.push({
            warehouseName,
            aisle,
            rack,
            shelf,
            boxBin,
            fullCode: `${aisle}-${rack}-${shelf}-${boxBin}`,
          });
        }
      }
    }
  }
  return bins;
}

async function main() {
  console.log("→ BimmerERP seed starting…");

  // pg_trgm is required by the GIN search indexes.
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

  if (FORCE_RESET) {
    await assertResetAllowed();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "SystemAuditTrail", "StockMovement", "TreasuryTransaction",
        "InvoiceItem", "Invoice", "TreasuryShift", "CustomerVehicle", "PartChassis",
        "PartEngine", "PartItem", "WarehouseBin", "Account", "Treasury",
        "BmwChassis", "BmwEngine", "Brand", "User", "DocumentCounter", "SystemSetting"
      RESTART IDENTITY CASCADE;
    `);
  }

  // ── 1. Bootstrap super-admin ───────────────────────────────────────────────
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("SEED_ADMIN_PASSWORD is not set. Refusing to seed a default password.");
  }
  if (adminPassword.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: { role: "SUPER_ADMIN", isActive: true },
    create: {
      username: adminUsername,
      fullName: "مدير النظام التنفيذي",
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });
  console.log(`  ✓ super-admin ready: ${admin.username}`);

  // ── 2. BMW chassis master data ─────────────────────────────────────────────
  for (const c of CHASSIS_LIST) {
    await prisma.bmwChassis.upsert({ where: { code: c.code }, update: c, create: c });
  }
  console.log(`  ✓ ${CHASSIS_LIST.length} chassis codes`);

  // ── 3. BMW engine codes ────────────────────────────────────────────────────
  for (const e of ENGINE_LIST) {
    await prisma.bmwEngine.upsert({ where: { code: e.code }, update: e, create: e });
  }
  console.log(`  ✓ ${ENGINE_LIST.length} engine codes`);

  // ── 4. Premium / OEM brands ────────────────────────────────────────────────
  for (const b of BRANDS) {
    await prisma.brand.upsert({ where: { name: b.name }, update: b, create: b });
  }
  console.log(`  ✓ ${BRANDS.length} brands`);

  // ── 5. Warehouse bin grid ──────────────────────────────────────────────────
  const bins = buildBins();
  await prisma.warehouseBin.createMany({ data: bins, skipDuplicates: true });
  console.log(`  ✓ ${bins.length} warehouse bins`);

  // ── 6. Default treasuries ──────────────────────────────────────────────────
  const treasuries = [
    { name: "درج نقدية الكاشير الرئيسي", type: "CASH_DRAWER" as const },
    { name: "ماكينة الدفع الإلكتروني (POS)", type: "POS_TERMINAL" as const },
    { name: "الحساب البنكي الرئيسي", type: "BANK_ACCOUNT" as const },
  ];
  for (const t of treasuries) {
    const existing = await prisma.treasury.findFirst({ where: { name: t.name } });
    if (!existing) await prisma.treasury.create({ data: t });
  }
  console.log(`  ✓ ${treasuries.length} treasuries`);

  // ── 7. Walk-in customer + expense account ──────────────────────────────────
  await prisma.account.upsert({
    where: { accountNumber: "ACC-0001" },
    update: {},
    create: {
      accountNumber: "ACC-0001",
      name: "عميل نقدي افتراضي (Walk-in)",
      type: "CUSTOMER",
      defaultPriceTier: "RETAIL",
    },
  });
  await prisma.account.upsert({
    where: { accountNumber: "EXP-0001" },
    update: {},
    create: {
      accountNumber: "EXP-0001",
      name: "مصروفات تشغيلية عامة",
      type: "EXPENSE",
    },
  });
  console.log("  ✓ default accounts");

  // ── 8. System settings + category registry ────────────────────────────────
  for (const s of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { label: s.label, group: s.group },
      create: s,
    });
  }
  await prisma.systemSetting.upsert({
    where: { key: "PART_CATEGORIES" },
    update: {},
    create: {
      key: "PART_CATEGORIES",
      value: JSON.stringify(CATEGORIES),
      group: "INVENTORY",
      label: "تصنيفات قطع الغيار",
    },
  });
  console.log(`  ✓ ${SETTINGS.length + 1} system settings`);

  console.log("✅ BimmerERP database seeded successfully with BMW master datasets.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
