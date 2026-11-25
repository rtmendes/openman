import { z } from "zod";
import { DbError } from "@/lib/db/client";
import { studioDraft } from "@/lib/db/studio-drafts";
import { saveStudioWorkspace, studioFoldersHaveAssets, studioWorkspace } from "@/lib/db/studio-workspaces";
import { readJsonLimited } from "@/lib/net/body";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";
import { studioOrganizationSchema } from "@/lib/studio/organization";

const headers = { "Cache-Control": "private, no-store" };
const payload = z.object({ revision: z.number().int().min(0).max(2_147_483_646), organization: studioOrganizationSchema });

export const GET = withErrorReporting("studio.workspace.open", async () => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return Response.json({ error: "Cloud organization is unavailable." }, { status: 404, headers });
  try { return Response.json(await studioWorkspace(userId), { headers }); }
  catch (error) {
    if (error instanceof DbError && (error.code === "PGRST205" || error.code === "42P01")) {
      return Response.json({ error: "Studio organization needs the Mahara database migration." }, { status: 503, headers });
    }
    throw error;
  }
});

export const PUT = withErrorReporting("studio.workspace.save", async (req) => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return Response.json({ error: "Cloud organization is unavailable." }, { status: 404, headers });
  const input = payload.safeParse(await readJsonLimited(req, 900_000).catch(() => null));
  if (!input.success) return Response.json({ error: input.error.issues[0]?.message ?? "Invalid workspace organization." }, { status: 400, headers });
  const current = await studioWorkspace(userId);
  if (current.revision !== input.data.revision) return Response.json({ error: "Organization changed in another tab. Reload the latest workspace." }, { status: 409, headers });
  const next = new Set(input.data.organization.folders.map(({ id }) => id));
  const removed = current.organization.folders.filter(({ id }) => !next.has(id)).map(({ id }) => id);
  if (removed.length) {
    const [draft, hasAssets] = await Promise.all([studioDraft(userId), studioFoldersHaveAssets(userId, removed)]);
    const items = (draft?.items ?? []) as { organization?: { folderId?: string } }[];
    if (items.some(({ organization }) => organization?.folderId && removed.includes(organization.folderId))) {
      return Response.json({ error: "Move the projects and wait for their drafts to save before deleting this folder." }, { status: 409, headers });
    }
    if (hasAssets) return Response.json({ error: "Move the stored assets before deleting this folder." }, { status: 409, headers });
  }
  const result = await saveStudioWorkspace(userId, input.data.revision, input.data.organization);
  return result ? Response.json(result, { headers })
    : Response.json({ error: "Organization changed in another tab. Reload the latest workspace." }, { status: 409, headers });
});
