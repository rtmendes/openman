import { createHash, randomUUID } from "node:crypto";
import { db, fail } from "./client";

const bucket = () => db().storage.from("mahara-studio-private");
const folder = (userId: string) => createHash("sha256").update(userId).digest("hex");

export async function studioVersions(userId: string) {
  const { data, error } = await db().from("studio_draft_versions").select("revision, created_at")
    .eq("user_id", userId).order("revision", { ascending: false }).limit(100);
  if (error) fail("list Studio versions", error);
  return data ?? [];
}

export async function studioDraft(userId: string, revision?: number) {
  const query = db().from("studio_draft_versions").select("revision, items, created_at").eq("user_id", userId);
  const { data, error } = await (revision === undefined ? query.order("revision", { ascending: false }).limit(1) : query.eq("revision", revision)).maybeSingle();
  if (error) fail("open Studio drafts", error);
  return data;
}

export async function saveStudioDraft(userId: string, revision: number, items: unknown[]) {
  const { data, error } = await db().rpc("studio_save_drafts", { p_user: userId, p_revision: revision, p_items: items });
  if (error) fail("save Studio drafts", error);
  return data as { revision: number; savedAt?: string; conflict?: boolean };
}

export async function prepareStudioUpload(userId: string, extension: string) {
  const id = `${randomUUID()}.${extension}`;
  const { data, error } = await bucket().createSignedUploadUrl(`${folder(userId)}/${id}`, { upsert: false });
  if (error) fail("prepare private Studio upload", error);
  return { id, signedUrl: data.signedUrl };
}

export async function signStudioMedia(userId: string, id: string, download: boolean) {
  const { data, error } = await bucket().createSignedUrl(`${folder(userId)}/${id}`, 900, { download });
  if (error) return null;
  return data.signedUrl;
}

export async function deleteStudioMedia(userId: string) {
  if (process.env.APP_DB_SCHEMA !== "mahara") return;
  const path = folder(userId);
  for (;;) {
    const { data, error } = await bucket().list(path, { limit: 100 });
    if (error) fail("list private Studio media", error);
    if (!data.length) return;
    const removed = await bucket().remove(data.map(({ name }) => `${path}/${name}`));
    if (removed.error) fail("delete private Studio media", removed.error);
    if (!removed.data?.length) throw new Error("Private Studio media could not be removed.");
  }
}
