import { createHash, randomUUID } from "node:crypto";
import { db, fail } from "./client";
import type { KeywordLookup } from "@/lib/studio/keyword-research";
import { mediaExtension, studioMediaLimit, studioMediaTypes, type StudioMedia } from "@/lib/studio/media-types";

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

export async function studioMediaInfo(userId: string, id: string, name: string): Promise<StudioMedia | null> {
  const { data, error } = await bucket().info(`${folder(userId)}/${id}`);
  if (error || !data) return null;
  const type = studioMediaTypes[mediaExtension(id) as keyof typeof studioMediaTypes];
  const size = Number(data.size ?? data.metadata?.size);
  if (!type || !Number.isSafeInteger(size) || size <= 0 || size > studioMediaLimit) return null;
  return { id, name, type, size };
}

export async function saveStudioImage(userId: string, name: string, extension: "png" | "jpg" | "webp" | "gif", image: Uint8Array): Promise<StudioMedia> {
  const id = `${randomUUID()}.${extension}`;
  const type = studioMediaTypes[extension];
  const { error } = await bucket().upload(`${folder(userId)}/${id}`, image, { contentType: type, upsert: false });
  if (error) fail("store private Studio image", error);
  return { id, name, type, size: image.byteLength };
}

const keywordFile = (videoId: string, id: string, part: "start" | "result") => `keywords-${videoId}-${id}-${part}.json`;

async function readKeywordFile(userId: string, name: string): Promise<KeywordLookup | null> {
  const { data, error } = await bucket().download(`${folder(userId)}/${name}`);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as KeywordLookup;
}

export async function recentStudioKeywordLookup(userId: string, videoId: string, id?: string) {
  let name = id ? keywordFile(videoId, id, "start") : undefined;
  if (!name) {
    const { data, error } = await bucket().list(folder(userId), { search: `keywords-${videoId}-`,
      limit: 20, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error("Could not list Studio keyword reports.");
    name = data?.find((file) => file.name.startsWith(`keywords-${videoId}-`) && file.name.endsWith("-start.json"))?.name;
  }
  if (!name) return null;
  const lookup = await readKeywordFile(userId, name);
  if (!lookup) return null;
  const finished = await readKeywordFile(userId, keywordFile(videoId, lookup.id, "result"));
  if (finished) return finished;
  if (Date.now() - lookup.requestedAt > 240_000) {
    return { ...lookup, result: { error: "This lookup could not be confirmed. Check DataForSEO activity before retrying." } };
  }
  return lookup;
}

export async function saveStudioKeywordLookup(userId: string, videoId: string, lookup: KeywordLookup) {
  const name = keywordFile(videoId, lookup.id, lookup.result ? "result" : "start");
  const { error } = await bucket().upload(`${folder(userId)}/${name}`, Buffer.from(JSON.stringify(lookup)),
    { contentType: "application/json", upsert: false });
  if (!error) return true;
  if (await readKeywordFile(userId, name)) return false;
  throw new Error("Could not save the private keyword lookup.");
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
