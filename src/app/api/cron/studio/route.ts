import { after } from "next/server";
import { z } from "zod";
import { claimStudioTick } from "@/lib/db/studio-runs";
import { withErrorReporting } from "@/lib/observability/route";
import { tickStudioRuns } from "@/lib/studio/dispatcher";

export const POST = withErrorReporting("studio.cron", async (req) => {
  const ticket = z.uuid().safeParse(req.headers.get("x-studio-ticket"));
  if (process.env.APP_DB_SCHEMA !== "mahara" || !ticket.success || !(await claimStudioTick(ticket.data))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  after(tickStudioRuns);
  return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
});
