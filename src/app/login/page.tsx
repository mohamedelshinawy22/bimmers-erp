import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-bmw-black p-4"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(0,102,177,0.10), transparent 45%), radial-gradient(circle at 80% 80%, rgba(226,35,26,0.07), transparent 45%)",
      }}
    >
      <Suspense
        fallback={
          <div className="h-[520px] w-full max-w-md animate-pulse rounded-2xl border border-bmw-cardBorder bg-bmw-card" />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
