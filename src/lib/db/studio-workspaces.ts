import { db, fail } from "./client";
import { defaultStudioOrganization, studioOrganizationSchema, type StudioLocation, type StudioOrganization } from "@/lib/studio/organization";
import type { StudioMedia } from "@/lib/studio/media-types";

export async function studioWorkspace(userId: string) {
  const { data, error } = await db().from("studio_workspaces").select("revision,organization").eq("user_id", userId).maybeSingle();
  if (error) fail("open Studio organization", error);
  return data ? { revision: Number(data.revision), organization: studioOrganizationSchema.parse(data.organization) }
    : { revision: 0, organization: defaultStudioOrganization };
}

export async function saveStudioWorkspace(userId: string, revision: number, organization: StudioOrganization) {
  const table = db().from("studio_workspaces");
  const fields = { revision: revision + 1, organization };
  const { data, error } = revision === 0
    ? await table.insert({ user_id: userId, ...fields }).select("revision").maybeSingle()
    : await table.update(fields).eq("user_id", userId).eq("revision", revision).select("revision").maybeSingle();
  if (error?.code === "23505") return null;
  if (error) fail("save Studio organization", error);
  return data ? { revision: Number(data.revision) } : null;
}

export async function listStudioBrandAssets(userId: string, location: StudioLocation, page: number, search: string) {
  const limit = 24;
  const from = (page - 1) * limit;
  let query = db().from("studio_brand_assets").select("media_id,name,type,size").eq("user_id", userId).eq("brand_id", location.brandId);
  query = location.folderId ? query.eq("folder_id", location.folderId) : query.is("folder_id", null);
  if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).order("media_id").range(from, from + limit);
  if (error) fail("list Studio brand assets", error);
  const assets: StudioMedia[] = (data ?? []).slice(0, limit).map((row) => ({ id: row.media_id, name: row.name, type: row.type, size: Number(row.size) }));
  return { assets, hasMore: (data?.length ?? 0) > limit };
}

export async function storeStudioBrandAsset(userId: string, location: StudioLocation, asset: StudioMedia) {
  const { error } = await db().from("studio_brand_assets").upsert({
    user_id: userId, brand_id: location.brandId, folder_id: location.folderId ?? null,
    media_id: asset.id, name: asset.name, type: asset.type, size: asset.size,
  }, { onConflict: "user_id,brand_id,media_id" });
  if (error) fail("file Studio brand asset", error);
}
