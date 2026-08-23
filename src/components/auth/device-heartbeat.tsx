"use client";

import { useEffect } from "react";
import { tenantDeviceHeartbeatAction } from "@/server/actions/auth.actions";

const DEVICE_KEY = "bimmererp.device-id.v1";
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

function currentDeviceIdentity() {
  let deviceId = window.localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return {
    deviceId,
    deviceName: `${navigator.platform || "Browser"} ERP`.slice(0, 160),
    browserInfo: navigator.userAgent.slice(0, 240),
    os: [navigator.platform, navigator.language].filter(Boolean).join(" • ").slice(0, 120),
  };
}

/** Client-only, best-effort presence refresh; all authorization remains server-side. */
export function DeviceHeartbeat() {
  useEffect(() => {
    const heartbeat = () => {
      if (document.visibilityState === "hidden") return;
      void tenantDeviceHeartbeatAction(currentDeviceIdentity());
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, []);
  return null;
}
