import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function main() {
  const source = readFileSync(resolve(process.cwd(), "src/components/auth/device-heartbeat.tsx"), "utf8");
  assert.ok(source.includes('"bimmererp.device-id.v1"'), "heartbeat must reuse the same persisted identity key as login");
  assert.ok(source.includes("window.localStorage.getItem"), "heartbeat must retrieve the persistent browser device ID");
  assert.ok(source.includes("tenantDeviceHeartbeatAction(currentDeviceIdentity())"), "heartbeat must submit the stored device identity through the protected server action");
  assert.ok(source.includes("2 * 60_000"), "heartbeat cadence must run every two minutes");
  const actionSource = readFileSync(resolve(process.cwd(), "src/server/actions/auth.actions.ts"), "utf8");
  assert.ok(actionSource.includes("await establishTenantContext(user.username, user.tenantId)"), "heartbeat must explicitly restore tenant context after session validation");
  console.log("Device heartbeat wiring probe passed.");
}

main();
