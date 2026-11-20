// Read-only deployment smoke test. Prints a status message and never emits response bodies.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: url, APP_DB_API_KEY: key, APP_DB_ACCESS_TOKEN: token,
  APP_DB_SECRET: secret, APP_DB_SCHEMA: schema } = process.env;
assert.ok(url && key && token && secret && schema === "mahara", "Mahara database settings are incomplete.");

function client(header) {
  return createClient(url, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}`, ...(header ? { "x-om-secret": header } : {}) } },
  });
}

const app = client(secret);
const [settings, context, denied] = await Promise.all([
  app.from("settings").select("user_id").limit(1).abortSignal(AbortSignal.timeout(10_000)),
  app.rpc("second_spring_context").abortSignal(AbortSignal.timeout(10_000)),
  client().rpc("second_spring_context").abortSignal(AbortSignal.timeout(10_000)),
]);
assert.ok(!settings.error, `Mahara settings query failed (${settings.error?.code ?? "unknown"}).`);
assert.ok(!context.error, `Mahara context query failed (${context.error?.code ?? "unknown"}).`);
assert.ok(
  context.data?.registry?.name === "Second Spring" &&
  context.data?.commandCenter?.name === "Second Spring" &&
  context.data?.kits?.length > 0 && context.data?.assets?.length > 0,
  "Second Spring sources did not resolve."
);
assert.ok(!denied.error && denied.data === null, "Context was not gated by the server header.");
console.log("Mahara Supabase smoke test passed for the settings table and all four Second Spring sources.");
