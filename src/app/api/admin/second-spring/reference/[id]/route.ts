import { db, fail } from "@/lib/db/client";
import { NotOperator, requireOperator } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";

const ids = new Set(["setup", "outliers", "packaging", "source", "episode", "vertical", "script", "batch"]);

export const GET = withErrorReporting("admin.second-spring.reference", async (_req, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const operator = await requireOperator();
    if (!operator.owner || process.env.APP_DB_SCHEMA !== "mahara") return new Response(null, { status: 404 });
  } catch (error) {
    if (error instanceof NotOperator) return new Response(null, { status: 404 });
    throw error;
  }
  const { id } = await params;
  if (!ids.has(id)) return new Response(null, { status: 404 });
  const { data, error } = await db().rpc("studio_reference_video", { asset_id: id });
  if (error) fail("load studio example", error);
  if (typeof data !== "string") return new Response(null, { status: 404 });
  const bytes = Buffer.from(data, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store" },
  });
});
