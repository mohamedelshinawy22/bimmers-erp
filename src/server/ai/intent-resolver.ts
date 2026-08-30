type DirectTools = {
  getLiveDashboardMetrics: () => Promise<{
    date: string;
    todaySalesTotal: number;
    todayPaidTotal: number;
    todayInvoicesCount: number;
    totalActiveTreasuries?: number;
    supplierPayables: number;
    customerReceivables: number;
    criticalShortagesCount: number;
  }>;
  queryProducts: (args: { query?: string; lowStockOnly?: boolean }) => Promise<Array<{
    name: string | null;
    oem: string | null;
    stock: number;
    stockStatus: string;
    location: string | null;
    retailPrice: number;
  }>>;
  queryAccountsAndDebts: (args: { type?: "CUSTOMER" | "SUPPLIER" | "WORKSHOP_BMW"; withDebtsOnly?: boolean }) => Promise<Array<{
    name: string;
    type: string;
    balance: number;
    balanceMeaning: string;
  }>>;
};

const normalize = (value: string) => value
  .toLocaleLowerCase("ar-EG")
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/[\u064B-\u065F\u0670]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const money = (value: number) => `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const itemName = (value: string | null | undefined) => value?.trim() || "صنف غير مسمى";

export async function resolveDirectDbIntent(query: string, tools: DirectTools): Promise<string | null> {
  const normalized = normalize(query);
  if (!normalized) return null;

  const asksSales = /(مبيعات|بيع|فواتير النهارده|فواتير اليوم|ملخص|الدرج|السيوله|خزينه)/.test(normalized);
  const asksShortages = /(نواقص|ناقص|حرج|خلص|مخزون قليل|اصناف قليله)/.test(normalized);
  const asksSuppliers = /(مورد|مستحقات|علينا|حسابات الموردين|مديونيات الموردين)/.test(normalized);
  const asksCustomers = /(مديوني|عميل|عملاء|ورش|لينا|مستحق لنا)/.test(normalized);

  if (asksSales) {
    const data = await tools.getLiveDashboardMetrics();
    const treasury = data.totalActiveTreasuries === undefined ? "غير متاح لهذا الدور" : money(data.totalActiveTreasuries);
    return [
      `**ملخص مبيعات ${data.date}:**`,
      `- إجمالي المبيعات: **${money(data.todaySalesTotal)}**`,
      `- المدفوع: **${money(data.todayPaidTotal)}**`,
      `- عدد الفواتير: **${data.todayInvoicesCount} فاتورة**`,
      `- إجمالي أرصدة الخزائن: **${treasury}**`,
      `- النواقص الحرجة: **${data.criticalShortagesCount} صنف**`,
    ].join("\n");
  }

  if (asksShortages) {
    const products = await tools.queryProducts({ lowStockOnly: true });
    if (!products.length) return "**حالة المخزون:** لا توجد أصناف حرجة ضمن البيانات الحالية.";
    const lines = products.slice(0, 8).map((product) => `- **${itemName(product.name)}** — الرصيد: **${product.stock}** (${product.stockStatus}) | OEM: ${product.oem || "—"} | الرف: ${product.location || "غير محدد"}`);
    return `**النواقص الحرجة:** عرضت لك ${products.length} أصناف من النتائج الحية، والأولوية للأقل رصيداً.\n${lines.join("\n")}`;
  }

  if (asksSuppliers) {
    const [metrics, suppliers] = await Promise.all([
      tools.getLiveDashboardMetrics(),
      tools.queryAccountsAndDebts({ type: "SUPPLIER", withDebtsOnly: true }),
    ]);
    const lines = suppliers.slice(0, 5).map((supplier) => `- **${supplier.name}**: ${money(Math.abs(supplier.balance))}`);
    return [`**مستحقات الموردين الحالية:** **${money(metrics.supplierPayables)}**`, lines.length ? "**أعلى الحسابات الظاهرة:**\n" + lines.join("\n") : "لا توجد حسابات موردين مدينة ظاهرة حالياً."].join("\n\n");
  }

  if (asksCustomers) {
    const [metrics, accounts] = await Promise.all([
      tools.getLiveDashboardMetrics(),
      tools.queryAccountsAndDebts({ withDebtsOnly: true }),
    ]);
    const customerAccounts = accounts.filter((account) => account.type === "CUSTOMER" || account.type === "WORKSHOP_BMW");
    const lines = customerAccounts.slice(0, 5).map((account) => `- **${account.name}**: ${money(Math.abs(account.balance))} — ${account.balanceMeaning}`);
    return [`**مستحقات العملاء والورش الحالية:** **${money(metrics.customerReceivables)}**`, lines.length ? "**أبرز الحسابات الظاهرة:**\n" + lines.join("\n") : "لا توجد مديونيات ظاهرة حالياً."].join("\n\n");
  }

  const products = await tools.queryProducts({ query });
  if (!products.length) return null;
  return ["**نتائج البحث في الأصناف:**", ...products.slice(0, 6).map((product) => `- **${itemName(product.name)}** — OEM: ${product.oem || "—"} | الرصيد: **${product.stock}** | سعر البيع: **${money(product.retailPrice)}** | الرف: ${product.location || "غير محدد"}`)].join("\n");
}
