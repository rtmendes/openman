// Production-database smoke test. Uses isolated fixture rows. Never launches an agent or publishes media.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: url, APP_DB_API_KEY: key, APP_DB_ACCESS_TOKEN: token,
  APP_DB_SECRET: secret, APP_DB_SCHEMA: schema } = process.env;
assert.ok(url && key && token && secret && schema === "mahara", "Mahara database settings are incomplete.");
const client = (header) => createClient(url, key, {
  db: { schema }, auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}`, ...(header ? { "x-om-secret": header } : {}) } },
});
const app = client(secret);
const denied = client();
const userId = "studio-workflow-smoke-" + randomUUID();
const videoId = randomUUID();
const id = randomUUID();
const table = () => app.from("studio_runs");
const state = { stage: 0, outputs: [] };
const fixture = { user_id: userId, id, video_id: videoId, kind: "workflow", phase: "review", input: {}, state };
try {
  const inserted = await table().insert(fixture);
  assert.ok(!inserted.error, `Stage insert failed (${inserted.error?.code ?? "unknown"}).`);
  const duplicate = await table().insert({ ...fixture, id: randomUUID() });
  assert.equal(duplicate.error?.code, "23505", "The project admitted two active workflow runs.");
  const unauthorized = await denied.from("studio_runs").select("id").eq("user_id", userId).eq("id", id);
  assert.ok(unauthorized.error || unauthorized.data?.length === 0, "A request without the server gate saw a private run.");
  const advance = () => table().update({ phase: "complete", version: 2 }).eq("user_id", userId).eq("id", id).eq("version", 1).select("phase,version");
  const competing = await Promise.all([advance(), advance()]);
  assert.ok(competing.every(({ error }) => !error), "A stage approval write failed.");
  assert.equal(competing.flatMap(({ data }) => data).length, 1, "Concurrent approvals both advanced the same run.");
  const result = await table().select("phase,version").eq("user_id", userId).eq("id", id).single();
  assert.equal(result.data?.phase, "complete");
  const forgedTicket = await app.rpc("studio_claim_tick", { p_ticket: randomUUID() });
  assert.equal(forgedTicket.error, null, "The worker ticket function is unavailable.");
  assert.equal(forgedTicket.data, false, "The worker accepted a fabricated ticket.");
  console.log("Studio workflow smoke test passed: private persistence, duplicate protection, one approval winner, worker ticket validation.");
} finally {
  const removed = await table().delete().eq("user_id", userId);
  assert.ok(!removed.error, `Workflow fixture cleanup failed (${removed.error?.code ?? "unknown"}).`);
}
