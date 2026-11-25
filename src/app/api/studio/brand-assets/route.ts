import { z } from "zod";
import { saveStudioImage, studioMediaInfo } from "@/lib/db/studio-drafts";
import { listStudioBrandAssets, storeStudioBrandAsset, studioWorkspace } from "@/lib/db/studio-workspaces";
import { readJsonLimited } from "@/lib/net/body";
import { safeFetch } from "@/lib/net/safe-fetch";
import { operatorFor } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession, type Session } from "@/lib/session";
import { studioMediaId } from "@/lib/studio/media-types";
import { brandIdSchema, studioSecondSpring, studioUnassigned, type StudioLocation } from "@/lib/studio/organization";

const headers = { "Cache-Control": "private, no-store" };
const location = z.object({ brandId: brandIdSchema, folderId: z.uuid().optional() });
const listing = location.extend({ page: z.coerce.number().int().min(1).max(5000).default(1), search: z.string().trim().max(90).default("") });
const filing = z.discriminatedUnion("action", [
  location.extend({ action: z.literal("file"), id: z.string().regex(studioMediaId), name: z.string().trim().min(1).max(250) }),
  location.extend({ action: z.literal("import-image"), url: z.url().max(1500), name: z.string().trim().max(230).optional() }),
]);
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

async function checkLocation(session: Session, input: StudioLocation) {
  if (process.env.APP_DB_SCHEMA !== "mahara") return false;
  if (input.brandId === studioSecondSpring && !(await operatorFor(session))?.owner) return false;
  const { organization } = await studioWorkspace(session.userId);
  if (input.brandId !== studioUnassigned && input.brandId !== studioSecondSpring &&
      !organization.brands.some(({ id }) => id === input.brandId)) return false;
  return !input.folderId || organization.folders.some((folder) => folder.id === input.folderId && folder.brandId === input.brandId);
}

function imageExtension(bytes: Buffer) {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export const GET = withErrorReporting("studio.brandAssets.list", async (req) => {
  const session = await requireSession();
  const input = listing.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!input.success) return error("Choose a brand and folder.", 400);
  if (!(await checkLocation(session, input.data))) return error("This brand folder is unavailable.", 404);
  return Response.json(await listStudioBrandAssets(session.userId, input.data, input.data.page, input.data.search), { headers });
});

export const POST = withErrorReporting("studio.brandAssets.save", async (req) => {
  const session = await requireSession();
  const input = filing.safeParse(await readJsonLimited(req, 10_000).catch(() => null));
  if (!input.success) return error("Choose a valid asset and brand folder.", 400);
  if (!(await checkLocation(session, input.data))) return error("This brand folder is unavailable.", 404);
  const { userId } = session;
  const request = input.data;
  if (request.action === "file") {
    const asset = await studioMediaInfo(userId, request.id, request.name);
    if (!asset) return error("The uploaded file could not be found. Reattach it before filing.", 404);
    await storeStudioBrandAsset(userId, request, asset);
    return Response.json({ asset }, { headers });
  }
  const image = await safeFetch(request.url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 10_000, maxRedirects: 3 }).catch(() => null);
  const extension = image?.ok ? imageExtension(image.body) : null;
  if (!image || !extension) return error("Use a direct PNG, JPEG, WebP, or GIF link under 12 MB, or upload the exported file.", 422);
  const name = request.name || `Imported image.${extension}`;
  const asset = await saveStudioImage(userId, name, extension, image.body);
  await storeStudioBrandAsset(userId, request, asset);
  return Response.json({ asset }, { headers });
});
