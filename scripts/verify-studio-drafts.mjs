// Production smoke test for append-only drafts and private signed media. Uses a disposable record.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.APP_DB_API_KEY;
const token = process.env.APP_DB_ACCESS_TOKEN;
const secret = process.env.APP_DB_SECRET;
assert.ok(url && key && token && secret && process.env.APP_DB_SCHEMA === "mahara");
const db = createClient(url, key, {
  db: { schema: "mahara" },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${token}`, "x-om-secret": secret } },
});
const testId = `studio-smoke-${randomUUID()}`;
const object = `${testId}/reference.txt`;
const bucket = db.storage.from("mahara-studio-private");
const keywordObject = `${testId}/keywords-${randomUUID()}-${randomUUID()}-result.json`;
let uploaded = false;
let keywordUploaded = false;
async function save(revision, items) {
  const { data, error } = await db.rpc("studio_save_drafts", { p_user: testId, p_revision: revision, p_items: items });
  assert.ok(!error, `Draft save RPC failed (${error?.code ?? "unknown"}).`);
  return data;
}
try {
  const first = await save(0, [{ label: "original" }]);
  assert.equal(first.revision, 1);
  assert.equal((await save(1, [{ label: "variation" }])).revision, 2);
  assert.equal((await save(1, [{ label: "stale edit" }])).conflict, true);
  const original = await db.from("studio_draft_versions").select("items").eq("user_id", testId).eq("revision", 1).single();
  assert.equal(original.data?.items?.[0]?.label, "original");

  const upload = await bucket.createSignedUploadUrl(object, { upsert: false });
  assert.ok(upload.data?.signedUrl, `Studio upload signing failed (${upload.error?.status ?? "unknown"}).`);
  const file = "Private Studio storage smoke test.";
  const put = await fetch(upload.data.signedUrl, { method: "PUT", body: file, headers: { "Content-Type": "text/plain", "x-upsert": "false" } });
  assert.ok(put.ok, `Signed upload failed (${put.status}).`);
  uploaded = true;
  const signed = await bucket.createSignedUrl(object, 60);
  assert.ok(signed.data?.signedUrl, `Studio playback signing failed (${signed.error?.status ?? "unknown"}).`);
  assert.equal(await (await fetch(signed.data.signedUrl)).text(), file);
  const publicResponse = await fetch(`${url}/storage/v1/object/public/mahara-studio-private/${object}`);
  assert.ok(!publicResponse.ok, "The private object was readable without a signature.");

  const sampleReport = { result: { rows: [{ term: "Private synthetic keyword" }], cost: 0 } };
  const stored = await bucket.upload(keywordObject, Buffer.from(JSON.stringify(sampleReport)), { contentType: "application/json", upsert: false });
  assert.ok(!stored.error, "The server cannot save an immutable keyword report.");
  keywordUploaded = true;
  const listed = await bucket.list(testId, { search: "keywords-", sortBy: { column: "created_at", order: "desc" }, limit: 20 });
  assert.ok(!listed.error && listed.data.some(({ name }) => `${testId}/${name}` === keywordObject), "The saved keyword report is missing from private storage.");
  const recovered = await bucket.download(keywordObject);
  assert.ok(!recovered.error && recovered.data);
  assert.deepEqual(JSON.parse(await recovered.data.text()), sampleReport);
  console.log("Studio smoke test passed: draft history, private signed media, and server-side keyword report recovery.");
} finally {
  const objects = [...(uploaded ? [object] : []), ...(keywordUploaded ? [keywordObject] : [])];
  if (objects.length) {
    const removed = await bucket.remove(objects);
    assert.ok(!removed.error, "Could not remove the Studio smoke-test objects.");
  }
  const removed = await db.from("studio_draft_versions").delete().eq("user_id", testId);
  assert.ok(!removed.error, "Could not remove the Studio smoke-test revisions.");
}
