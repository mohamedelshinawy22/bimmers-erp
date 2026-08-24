import { PrismaClient } from "@prisma/client";

const categories = [
  "الفرامل", "التعليق والمقصات", "المحرك", "الكهرباء والإشعال", "التبريد والرادياتير",
  "ناقل الحركة", "العفشة والمساعدين", "الفلاتر والزيوت", "الهيكل والصدامات", "التكييف", "عام / قطع غيار متنوعة",
];

const brands = [
  ["Genuine BMW", "Germany", true], ["BMW Value Line", "Germany", true], ["Brembo", "Italy", false],
  ["Lemförder", "Germany", false], ["Bosch", "Germany", false], ["Febi Bilstein", "Germany", false],
  ["Meyle HD", "Germany", false], ["Mahle", "Germany", false], ["Sachs", "Germany", false],
  ["TRW", "Germany", false], ["Hella", "Germany", false], ["Textar", "Germany", false],
] as const;

const chassis = [
  ["E30", "3 Series", 1982, 1994], ["E36", "3 Series", 1990, 2000], ["E46", "3 Series", 1997, 2006], ["E90", "3 Series", 2004, 2013], ["F30", "3 Series", 2011, 2019], ["G20", "3 Series", 2018, 2026],
  ["E39", "5 Series", 1995, 2004], ["E60", "5 Series", 2003, 2010], ["F10", "5 Series", 2010, 2017], ["G30", "5 Series", 2016, 2024],
  ["E53", "X5 Series", 1999, 2006], ["E70", "X5 Series", 2006, 2013], ["F15", "X5 Series", 2013, 2018], ["G05", "X5 Series", 2018, 2026],
  ["E83", "X3 Series", 2003, 2010], ["F25", "X3 Series", 2010, 2017], ["G01", "X3 Series", 2017, 2026],
  ["E65", "7 Series", 2001, 2008], ["F01", "7 Series", 2008, 2015], ["G11", "7 Series", 2015, 2022],
] as const;

const engines = [
  ["M40", "1.6L / 1.8L", "Petrol"], ["M52", "2.0L / 2.8L", "Petrol"], ["M54", "2.5L / 3.0L", "Petrol"], ["N42", "1.8L / 2.0L Valvetronic", "Petrol"], ["N46", "2.0L Valvetronic", "Petrol"], ["N52", "2.5L / 3.0L", "Petrol"],
  ["N54", "3.0L TwinTurbo", "Petrol"], ["N55", "3.0L TwinPower", "Petrol"], ["N20", "2.0L TwinPower", "Petrol"], ["N63", "4.4L V8 TwinTurbo", "Petrol"], ["B38", "1.5L Modular Turbo", "Petrol"], ["B48", "2.0L Modular Turbo", "Petrol"], ["B58", "3.0L Inline-6 Turbo", "Petrol"], ["S55", "3.0L M-TwinPower", "Petrol"], ["S58", "3.0L M-TwinPower", "Petrol"], ["N47", "2.0L Diesel", "Diesel"], ["B47", "2.0L Diesel Modular", "Diesel"], ["M57", "3.0L Diesel", "Diesel"],
] as const;

const settings = [
  ["COMPANY_NAME", "بيمرز لقطع غيار BMW", "GENERAL", "اسم الشركة / المنشأة"], ["COMMERCIAL_NAME", "قطع غيار BMW", "GENERAL", "الاسم التجاري / النشاط"], ["COMPANY_PHONE", "", "GENERAL", "الهاتف الرئيسي"], ["COMPANY_PHONE_SECONDARY", "", "GENERAL", "الهاتف الثانوي"], ["COMPANY_ADDRESS", "", "GENERAL", "عنوان الشركة"], ["COMMERCIAL_REGISTER", "", "GENERAL", "السجل التجاري"], ["TAX_NUMBER", "", "TAX", "الرقم الضريبي"], ["TAX_RATE_PERCENT", "0", "TAX", "نسبة ضريبة القيمة المضافة %"], ["COMPANY_LOGO_URL", "", "PRINTING", "رابط الشعار"], ["INVOICE_FOOTER", "شكراً لتعاملكم معنا", "PRINTING", "تذييل الفاتورة وشروط الضمان"], ["ALLOW_NEGATIVE_STOCK", "false", "INVENTORY", "السماح بالبيع بالسالب"], ["ENFORCE_MIN_SELL_PRICE", "true", "PRICING", "إجبار حد السعر الأدنى"], ["ENFORCE_CREDIT_LIMIT", "true", "PRICING", "إجبار حد الائتمان"], ["MAX_INVOICE_DISCOUNT_PERCENT", "20", "PRICING", "أقصى نسبة خصم على الفاتورة %"],
] as const;

const normalized = (value: string) => value.trim().toLocaleLowerCase("ar-EG");

export async function bootstrapTenantDatabase(db: PrismaClient) {
  const [mainTreasury, cashDrawer] = await Promise.all([
    db.treasury.upsert({ where: { name: "الخزينة الرئيسية" }, update: { isActive: true, isDefault: true }, create: { name: "الخزينة الرئيسية", type: "CASH_DRAWER", currentBalance: 0, isActive: true, isDefault: true, notes: "خزينة النظام الأساسية" } }),
    db.treasury.upsert({ where: { name: "درج النقدية" }, update: { isActive: true }, create: { name: "درج النقدية", type: "CASH_DRAWER", currentBalance: 0, isActive: true, isDefault: false, notes: "درج الكاشير الافتراضي" } }),
    db.warehouseBin.upsert({ where: { fullCode: "MAIN-A0-00-A-00" }, update: {}, create: { warehouseName: "المخزن الرئيسي", aisle: "A0", rack: "00", shelf: "A", boxBin: "00", fullCode: "MAIN-A0-00-A-00" } }),
    db.account.upsert({ where: { accountNumber: "ACC-0001" }, update: { isActive: true }, create: { accountNumber: "ACC-0001", name: "عميل نقدي افتراضي (Walk-in)", type: "CUSTOMER", defaultPriceTier: "RETAIL", currentBalance: 0, creditLimit: 0, isActive: true, status: "ACTIVE", category: "WALK_IN_CASH" } }),
    db.barcodeConfig.upsert({ where: { scopeKey: "COMPANY" }, update: {}, create: { scopeKey: "COMPANY" } }),
  ]);

  await Promise.all([
    db.category.createMany({ data: categories.map((name) => ({ name, normalizedName: normalized(name) })), skipDuplicates: true }),
    db.brand.createMany({ data: brands.map(([name, originCountry, isOem]) => ({ name, normalizedName: normalized(name), originCountry, isOem })), skipDuplicates: true }),
    db.bmwChassis.createMany({ data: chassis.map(([code, series, productionStartYear, productionEndYear]) => ({ code, series, productionStartYear, productionEndYear })), skipDuplicates: true }),
    db.bmwEngine.createMany({ data: engines.map(([code, displacement, fuelType]) => ({ code, displacement, fuelType })), skipDuplicates: true }),
    db.systemSetting.createMany({ data: settings.map(([key, value, group, label]) => ({ key, value, group, label })), skipDuplicates: true }),
    db.documentCounter.createMany({ data: ["TRX", "SHIFT", "ACCOUNT-ACC"].map((scope) => ({ scope, lastValue: 0 })), skipDuplicates: true }),
  ]);

  const genericCategory = await db.category.findUnique({ where: { normalizedName: normalized("عام / قطع غيار متنوعة") }, select: { id: true } });
  if (genericCategory) await db.partItem.updateMany({ where: { categoryId: null }, data: { categoryId: genericCategory.id } });

  return { mainTreasuryId: mainTreasury.id, cashDrawerId: cashDrawer.id };
}
