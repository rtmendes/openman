import { db, fail } from "@/lib/db/client";
import { NotOperator, requireOperator } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";

export const GET = withErrorReporting("admin.second-spring.video", async () => {
  try {
    const operator = await requireOperator();
    if (!operator.owner || process.env.APP_DB_SCHEMA !== "mahara") return new Response(null, { status: 404 });
  } catch (error) {
    if (error instanceof NotOperator) return new Response(null, { status: 404 });
    throw error;
  }

  const client = db();
  const { data: remastered } = await client.storage.from("mahara-studio-private").createSignedUrl("hostage-talks-neutral.mp4", 900);
  if (remastered?.signedUrl) {
    return new Response(null, { status: 302, headers: {
      Location: remastered.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    } });
  }
  const { data, error } = await client.rpc("second_spring_preview");
  if (error) fail("load Second Spring video", error);
  if (typeof data !== "string") return new Response(null, { status: 404 });
  const video = Buffer.from(data, "base64");
  return new Response(new Uint8Array(video), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
});
