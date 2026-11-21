import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withErrorReporting } from "@/lib/observability/route";
import { saveStudioDraft, studioDraft, studioVersions } from "@/lib/db/studio-drafts";
import { researchBriefsSchema } from "@/lib/studio/research-briefs";

const revision = z.number().int().min(0).max(2_147_483_646);
const payload = z.object({
  expectedRevision: revision,
  items: z.array(z.object({
    spec: z.object({ id: z.uuid(), keyword: z.string().max(180), researchBriefs: researchBriefsSchema.optional(),
      activeResearchBriefId: z.uuid().optional() }).passthrough(),
    kit: z.enum(["custom", "second-spring"]),
    script: z.string().max(40000),
  }).passthrough()).max(12),
});
const headers = { "Cache-Control": "private, no-store" };

export const GET = withErrorReporting("studio.drafts.get", async (req) => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return Response.json({ error: "Studio autosave is unavailable." }, { status: 404 });
  const raw = req.nextUrl.searchParams.get("revision");
  if (raw !== null) {
    const selected = revision.safeParse(Number(raw));
    if (!selected.success || selected.data < 1) return Response.json({ error: "Invalid revision." }, { status: 400, headers });
    const draft = await studioDraft(userId, selected.data);
    return Response.json({ draft }, { status: draft ? 200 : 404, headers });
  }
  const [draft, versions] = await Promise.all([studioDraft(userId), studioVersions(userId)]);
  return Response.json({ draft, versions }, { headers });
});

export const PUT = withErrorReporting("studio.drafts.save", async (req) => {
  const { userId } = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara") return Response.json({ error: "Studio autosave is unavailable." }, { status: 404 });
  const body = await req.text();
  if (Buffer.byteLength(body, "utf8") > 1_500_000) return Response.json({ error: "The draft exceeds the save limit." }, { status: 413, headers });
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return Response.json({ error: "Invalid draft." }, { status: 400, headers }); }
  const input = payload.safeParse(raw);
  if (!input.success) return Response.json({ error: "Invalid draft." }, { status: 400, headers });
  const result = await saveStudioDraft(userId, input.data.expectedRevision, input.data.items);
  return Response.json(result, { status: result.conflict ? 409 : 200, headers });
});
