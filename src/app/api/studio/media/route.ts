import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withErrorReporting } from "@/lib/observability/route";
import { prepareStudioUpload, signStudioMedia } from "@/lib/db/studio-drafts";
import { mediaExtension, studioMediaId, studioMediaLimit, studioMediaTypes } from "@/lib/studio/media-types";

const upload = z.object({ name: z.string().min(1).max(250), size: z.number().int().positive().max(studioMediaLimit) });
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export const POST = withErrorReporting("studio.media.upload", async (req) => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return new Response(null, { status: 404, headers });
  const body = await req.json().catch(() => null);
  const file = upload.safeParse(body);
  if (!file.success) return Response.json({ error: "Select a file up to 50 MB." }, { status: 400, headers });
  const ext = mediaExtension(file.data.name);
  if (!Object.hasOwn(studioMediaTypes, ext)) return Response.json({ error: "Unsupported file type." }, { status: 400, headers });
  const target = await prepareStudioUpload(userId, ext);
  return Response.json({ ...target, type: studioMediaTypes[ext as keyof typeof studioMediaTypes] }, { headers });
});

export const GET = withErrorReporting("studio.media.read", async (req) => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return new Response(null, { status: 404, headers });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!studioMediaId.test(id)) return new Response(null, { status: 404, headers });
  const signed = await signStudioMedia(userId, id, req.nextUrl.searchParams.get("download") === "1");
  if (!signed) return new Response(null, { status: 404, headers });
  return new Response(null, { status: 302, headers: { ...headers, Location: signed } });
});
