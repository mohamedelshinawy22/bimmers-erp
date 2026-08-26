"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { createPartAction, updatePartAction } from "@/server/actions/parts.actions";
import { formatOemNumber } from "@/lib/utils";
import type { PartRow } from "@/server/services/parts.service";
import { BinLocator, type BinOption } from "./bin-locator";
import { FitmentMatrix, type ChassisOption, type EngineOption } from "./fitment-matrix";

interface AddPartModalProps {
  open: boolean;
  onClose: () => void;
  brands: Array<{ id: string; name: string; isOem: boolean }>;
  chassis: ChassisOption[];
  engines: EngineOption[];
  bins: BinOption[];
  categories: string[];
  canManageBins: boolean;
  canEditCost: boolean;
  /** When provided the modal switches to edit mode. */
  part?: PartRow | null;
}

const emptyForm = {
  oemNumber: "",
  nameAr: "",
  nameEn: "",
  brandId: "",
  brandName: "",
  brandPartNumber: "",
  barcode: "",
  category: "",
  sidePosition: "",
  buyPriceLast: "",
  sellPriceRetail: "",
  sellPriceWholesale: "",
  sellPriceMin: "",
  openingQuantity: "0",
  minReorderLevel: "2",
  costPrice: "",
};

const SIDE_POSITIONS = [
  "أمامي يمين",
  "أمامي شمال",
  "خلفي يمين",
  "خلفي شمال",
  "أمامي",
  "خلفي",
  "علوي",
  "سفلي",
];

export function AddPartModal({
  open,
  onClose,
  brands,
  chassis,
  engines,
  bins,
  categories,
  canManageBins,
  canEditCost,
  part = null,
}: AddPartModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!part;

  const [form, setForm] = useState(() =>
    part
      ? {
          oemNumber: part.oemNumber,
          nameAr: part.nameAr,
          nameEn: part.nameEn ?? "",
          brandId: part.brandId,
          brandName: part.brandName,
          brandPartNumber: part.brandPartNumber ?? "",
          barcode: part.barcode ?? "",
          category: part.category,
          sidePosition: part.sidePosition ?? "",
          buyPriceLast: String(part.buyPriceAvg),
          costPrice: String(part.buyPriceAvg),
          sellPriceRetail: String(part.sellPriceRetail),
          sellPriceWholesale: String(part.sellPriceWholesale),
          sellPriceMin: String(part.sellPriceMin),
          openingQuantity: "0",
          minReorderLevel: String(part.minReorderLevel),
        }
      : emptyForm,
  );
  // Edit mode must round-trip the existing relations, otherwise saving would
  // silently wipe the part's bin location and fitment matrix.
  const [binId, setBinId] = useState(part?.binLocationId ?? "");
  const [chassisIds, setChassisIds] = useState<string[]>(part?.chassisIds ?? []);
  const [engineIds, setEngineIds] = useState<string[]>(part?.engineIds ?? []);
  const [chassisCodes, setChassisCodes] = useState<string[]>([]);
  const [engineCodes, setEngineCodes] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(part?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: event.target.value }));

  const numeric = (v: string) => (v.trim() === "" ? 0 : Number(v));

  const reset = () => {
    setForm(emptyForm);
    setBinId("");
    setChassisIds([]);
    setEngineIds([]);
    setChassisCodes([]);
    setEngineCodes([]);
    setIsActive(true);
    setError(null);
    setFieldErrors({});
  };

  const submit = () => {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const shared = {
        nameAr: form.nameAr,
        nameEn: form.nameEn,
        brandId: form.brandName ? "" : form.brandId,
        brandName: form.brandName,
        brandPartNumber: form.brandPartNumber,
        barcode: form.barcode,
        category: form.category,
        categoryId: "",
        categoryName: "",
        sidePosition: form.sidePosition,
        binLocationId: binId,
        sellPriceRetail: numeric(form.sellPriceRetail),
        sellPriceWholesale: numeric(form.sellPriceWholesale),
        sellPriceMin: numeric(form.sellPriceMin),
        minReorderLevel: Math.trunc(numeric(form.minReorderLevel)),
        chassisIds,
        engineIds,
        chassisCodes,
        engineCodes,
        imageKey: "",
        imageUrl: "",
        ...(isEdit && canEditCost ? { costPrice: numeric(form.costPrice) } : {}),
      };

      const result = isEdit
        ? await updatePartAction({ id: part!.id, ...shared, isActive })
        : await createPartAction({
            ...shared,
            oemNumber: form.oemNumber,
            buyPriceLast: numeric(form.buyPriceLast),
            openingQuantity: Math.trunc(numeric(form.openingQuantity)),
            isActive,
          });

      if (!result.success) {
        setError(result.error);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      if (!isEdit) reset();
      onClose();
      router.refresh();
    });
  };

  const err = (key: string) => fieldErrors[key]?.[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `تعديل الصنف: ${part!.nameAr}` : "إدخال صنف جديد"}
      description="اربط الصنف بأكواد الشاسيه والمحرك المتوافقة وموقع التخزين لضمان سرعة الاستدعاء في نقطة البيع."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} loading={pending}>
            {isEdit ? <Save size={16} /> : <PackagePlus size={16} />}
            {isEdit ? "حفظ التعديلات" : "حفظ الصنف"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ── Identity ── */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-bmw-blue">بيانات التعريف</h3>

            <Field
              label="رقم القطعة الأصلي OEM"
              required
              error={err("oemNumber")}
              hint={
                form.oemNumber.replace(/\D/g, "").length === 11
                  ? formatOemNumber(form.oemNumber)
                  : "١١ رقم — مثال: 34116859066"
              }
            >
              <Input
                value={form.oemNumber}
                onChange={set("oemNumber")}
                disabled={isEdit}
                dir="ltr"
                className="text-left font-mono"
                placeholder="34116859066"
                maxLength={30}
              />
            </Field>

            <Field label="اسم الصنف بالعربية" required error={err("nameAr")}>
              <Input value={form.nameAr} onChange={set("nameAr")} placeholder="طقم تيل فرامل أمامي" />
            </Field>

            <Field label="الاسم بالإنجليزية" error={err("nameEn")}>
              <Input value={form.nameEn} onChange={set("nameEn")} dir="ltr" className="text-left" placeholder="Front Brake Pad Set" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="الماركة" required error={err("brandId")} hint="اكتب ماركة جديدة أو اختر من الاقتراحات">
                <Input list="part-brand-options" value={form.brandName} onChange={set("brandName")} placeholder="مثال: Valeo أو Febi" />
                <datalist id="part-brand-options">{brands.map((b) => <option key={b.id} value={b.name}>{b.isOem ? "OEM" : ""}</option>)}</datalist>
              </Field>
              <Field label="رقم القطعة عند الماركة" error={err("brandPartNumber")}>
                <Input
                  value={form.brandPartNumber}
                  onChange={set("brandPartNumber")}
                  dir="ltr"
                  className="text-left font-mono"
                  placeholder="P06088"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="التصنيف" required error={err("category")}>
                <Select value={form.category} onChange={set("category")}>
                  <option value="">— اختر —</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الموضع على السيارة" error={err("sidePosition")}>
                <Select value={form.sidePosition} onChange={set("sidePosition")}>
                  <option value="">— غير محدد —</option>
                  {SIDE_POSITIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="الباركود" error={err("barcode")} hint="اتركه فارغاً إن لم يوجد">
              <Input value={form.barcode} onChange={set("barcode")} dir="ltr" className="text-left font-mono" />
            </Field>

            <Checkbox label="الصنف نشط ومتاح للبيع" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          </div>

          {/* ── Pricing + location ── */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-bmw-blue">الأسعار والمخزون</h3>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={isEdit ? "سعر الشراء / التكلفة (ج.م)" : "سعر الشراء"}
                required
                error={err(isEdit ? "costPrice" : "buyPriceLast")}
                hint={isEdit ? (canEditCost ? "يمكن لمدير النظام تعديل سعر الشراء الأساسي مباشرة." : "تعديل سعر التكلفة متاح لمدير النظام والمدير فقط.") : undefined}
              >
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  value={isEdit ? form.costPrice : form.buyPriceLast}
                  onChange={isEdit ? set("costPrice") : set("buyPriceLast")}
                  disabled={isEdit && !canEditCost}
                />
              </Field>
              <Field label="سعر القطاعي" required error={err("sellPriceRetail")}>
                <Input type="number" step="0.01" min={0} value={form.sellPriceRetail} onChange={set("sellPriceRetail")} />
              </Field>
              <Field label="سعر الجملة" required error={err("sellPriceWholesale")}>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.sellPriceWholesale}
                  onChange={set("sellPriceWholesale")}
                />
              </Field>
              <Field
                label="الحد الأدنى للبيع"
                required
                error={err("sellPriceMin")}
                hint="لا يمكن للكاشير البيع تحته"
              >
                <Input type="number" step="0.01" min={0} value={form.sellPriceMin} onChange={set("sellPriceMin")} />
              </Field>
              {!isEdit ? (
                <Field label="الرصيد الافتتاحي" error={err("openingQuantity")}>
                  <Input type="number" min={0} value={form.openingQuantity} onChange={set("openingQuantity")} />
                </Field>
              ) : null}
              <Field label="حد إعادة الطلب" error={err("minReorderLevel")} hint="ينبّه في لوحة القيادة">
                <Input type="number" min={0} value={form.minReorderLevel} onChange={set("minReorderLevel")} />
              </Field>
            </div>

            <div className="border-t border-bmw-cardBorder pt-3">
              <BinLocator bins={bins} value={binId} onChange={setBinId} canCreate={canManageBins} />
            </div>
          </div>
        </div>

        {/* ── Fitment ── */}
        <div className="border-t border-bmw-cardBorder pt-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-bmw-blue">
            مصفوفة التوافق (Fitment Matrix)
          </h3>
          <FitmentMatrix
            chassis={chassis}
            engines={engines}
            selectedChassisIds={chassisIds}
            selectedEngineIds={engineIds}
            onChangeChassis={setChassisIds}
            onChangeEngines={setEngineIds}
            selectedChassisCodes={chassisCodes}
            selectedEngineCodes={engineCodes}
            onChangeChassisCodes={setChassisCodes}
            onChangeEngineCodes={setEngineCodes}
          />
        </div>
      </div>
    </Modal>
  );
}
