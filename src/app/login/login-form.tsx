"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Car, KeyRound, LogIn, UserRound } from "lucide-react";
import { loginAction } from "@/server/actions/auth.actions";
import { safeNextPath } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/modal";
import { MStripe } from "@/components/layout/m-stripe";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState<{ deviceId: string; deviceName: string; browserInfo: string; os: string } | null>(null);

  useEffect(() => {
    const key = "bimmererp.device-id.v1";
    let deviceId = window.localStorage.getItem(key);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      window.localStorage.setItem(key, deviceId);
    }
    const browserInfo = navigator.userAgent.slice(0, 240);
    const os = [navigator.platform, navigator.language].filter(Boolean).join(" • ").slice(0, 120);
    setDevice({ deviceId, deviceName: `${navigator.platform || "Browser"} ERP`, browserInfo, os });
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!device) {
      setError("جارٍ تجهيز تعريف الجهاز. أعد المحاولة بعد لحظة.");
      return;
    }
    startTransition(async () => {
      const result = await loginAction({ username, password, ...device });
      if (!result.success) {
        setError(result.error);
        setPassword("");
        return;
      }
      // The shared sanitiser (src/lib/safe-redirect.ts) is the SAME code the Edge
      // middleware runs, so a value it would refuse to emit can never be honoured
      // here either. `null` means "nothing trustworthy to honour" → go to `/`.
      const next = safeNextPath(params.get("next"));
      router.replace(next ?? "/");
      router.refresh();
    });
  };

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-bmw-cardBorder bg-bmw-card shadow-2xl">
      <MStripe />
      <div className="p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl border border-bmw-blue/30 bg-bmw-blue/10 p-3.5 text-bmw-blue">
            <Car size={30} />
          </div>
          <div>
            <h1 className="flex items-center justify-center gap-2 text-xl font-bold text-white">
              BimmerERP
              <span className="rounded-full bg-bmw-mRed px-2 py-0.5 font-mono text-[10px] font-normal">
                M-POWER OS
              </span>
            </h1>
            <p className="mt-1 text-xs text-bmw-muted">
              نظام إدارة مخازن وحسابات قطع غيار BMW الجديدة
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Field label="اسم المستخدم" htmlFor="username" required>
            <div className="relative">
              <UserRound
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted"
              />
              <Input
                id="username"
                name="username"
                autoComplete="username"
                required
                autoFocus
                dir="ltr"
                className="pl-9 text-left"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>
          </Field>

          <Field label="كلمة المرور" htmlFor="password" required>
            <div className="relative">
              <KeyRound
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted"
              />
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                dir="ltr"
                className="pl-9 text-left"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </Field>

          <Button type="submit" size="lg" loading={pending} className="w-full">
            {!pending ? <LogIn size={18} /> : null}
            دخول إلى النظام
          </Button>
        </form>

        <p className="mt-6 text-center font-mono text-[10px] leading-relaxed text-bmw-muted">
          جميع محاولات الدخول تُسجَّل في سجل التدقيق
          <br />
          ACID Serializable • Row-Level Audit • WAL Archiving
        </p>
      </div>
    </div>
  );
}
