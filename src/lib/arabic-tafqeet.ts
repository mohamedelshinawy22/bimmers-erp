const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

type Scale = { singular: string; dual: string; plural: string };
const SCALES: Scale[] = [
  { singular: "", dual: "", plural: "" },
  { singular: "ألف", dual: "ألفان", plural: "آلاف" },
  { singular: "مليون", dual: "مليونان", plural: "ملايين" },
  { singular: "مليار", dual: "ملياران", plural: "مليارات" },
];

function tripletToArabic(value: number): string {
  if (value <= 0) return "";
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]!);
  if (remainder) {
    if (remainder < 10) parts.push(ONES[remainder]!);
    else if (remainder < 20) parts.push(TEENS[remainder - 10]!);
    else {
      const ones = remainder % 10;
      const tens = Math.floor(remainder / 10);
      parts.push(ones ? `${ONES[ones]} و ${TENS[tens]}` : TENS[tens]!);
    }
  }
  return parts.join(" و ");
}

function groupToArabic(value: number, scaleIndex: number): string {
  if (!value) return "";
  const scale = SCALES[scaleIndex]!;
  if (!scale.singular) return tripletToArabic(value);
  if (value === 1) return scale.singular;
  if (value === 2) return scale.dual;
  const numberWords = tripletToArabic(value);
  return `${numberWords} ${value >= 3 && value <= 10 ? scale.plural : scale.singular}`;
}

function integerToArabic(value: number): string {
  if (!value) return "صفر";
  const groups: string[] = [];
  let remaining = value;
  let scaleIndex = 0;
  while (remaining > 0 && scaleIndex < SCALES.length) {
    const group = remaining % 1000;
    if (group) groups.unshift(groupToArabic(group, scaleIndex));
    remaining = Math.floor(remaining / 1000);
    scaleIndex++;
  }
  return groups.join(" و ");
}

/** Converts a decimal amount to Arabic Egyptian-pound words for formal documents. */
export function tafqeetEgyptianPounds(amount: number): string {
  const normalized = Math.max(0, Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100);
  const pounds = Math.floor(normalized);
  const piastres = Math.round((normalized - pounds) * 100);
  const poundWord = pounds === 1 ? "جنيه" : pounds === 2 ? "جنيهان" : pounds >= 3 && pounds <= 10 ? "جنيهات" : "جنيه";
  const value = `${integerToArabic(pounds)} ${poundWord}`;
  if (!piastres) return `${value} فقط لا غير`;
  const piastreWord = piastres === 1 ? "قرش" : piastres === 2 ? "قرشان" : piastres >= 3 && piastres <= 10 ? "قروش" : "قرشاً";
  return `${value} و ${integerToArabic(piastres)} ${piastreWord} فقط لا غير`;
}
