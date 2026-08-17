import type { Metadata, Viewport } from "next";
import { Readex_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-readex",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "BimmerERP — إدارة مخازن وحسابات قطع غيار BMW",
    template: "%s | BimmerERP",
  },
  description:
    "نظام ERP متكامل لإدارة مخزون وحسابات قطع غيار BMW الجديدة: نقطة بيع فورية، مطابقة الشاسيه والمحرك، خزينة وتقارير Z.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0B0D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${readex.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-bmw-black font-arabic text-bmw-silver antialiased">{children}</body>
    </html>
  );
}
