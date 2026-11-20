import { after } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/agent/server/http";
import { addStudioRun, changeStudioRun, studioRun, studioRuns } from "@/lib/db/studio-runs";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";
import { driveStudioRun, stopStudioTask } from "@/lib/studio/dispatcher";
import { runInput } from "@/lib/studio/run-input";
import { finalStudioStage, studioDecision } from "@/lib/studio/run-output";
import { changeStudioRunSchema, startStudioRunSchema, type StudioRun } from "@/lib/studio/runs";

const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const available = () => process.env.APP_DB_SCHEMA === "mahara";

export const GET = withErrorReporting("studio.runs.list", async (req) => {
  const { userId } = await requireSession();
  if (!available()) return reply({ error: "Saved Studio runs are unavailable." }, 404);
  const video = z.uuid().safeParse(req.nextUrl.searchParams.get("videoId"));
  if (!video.success) return reply({ error: "Choose a project." }, 400);
  return reply({ runs: await studioRuns(userId, video.data) });
});

export const POST = withErrorReporting("studio.runs.start", async (req) => {
  const session = await requireSession();
  if (!available()) return reply({ error: "Saved Studio runs are unavailable." }, 404);
  const body = await readBody(req, startStudioRunSchema, 12_000);
  if ("error" in body) return body.error;
  const input = body.data;
  const replay = await studioRun(session.userId, input.id);
  if (replay) return replay.video_id === input.videoId && replay.kind === input.kind
    ? reply({ run: replay }) : reply({ error: "This request was already used." }, 409);
  let snapshot;
  try { snapshot = await runInput(session, input); }
  catch (error) {
    if (error instanceof Response) return reply({ error: await error.text() }, error.status);
    throw error;
  }
  const stage = input.kind === "workflow" ? input.stage ?? 0 : finalStudioStage;
  const run = await addStudioRun(session.userId, input, snapshot, stage);
  if (!run) {
    const duplicate = await studioRun(session.userId, input.id);
    if (duplicate?.video_id === input.videoId && duplicate.kind === input.kind) return reply({ run: duplicate });
    return reply({ error: "A run of this type is already open for this project." }, 409);
  }
  after(() => driveStudioRun(session.userId, run.id));
  return reply({ run }, 201);
});

export const PATCH = withErrorReporting("studio.runs.decide", async (req) => {
  const { userId } = await requireSession();
  if (!available()) return reply({ error: "Saved Studio runs are unavailable." }, 404);
  const body = await readBody(req, changeStudioRunSchema, 12_000);
  if ("error" in body) return body.error;
  const { id, version, action, notes } = body.data;
  const run = await studioRun(userId, id);
  if (!run) return reply({ error: "Run not found." }, 404);
  const next = studioDecision(run, action, notes);
  if (run.version !== version || !next) return reply({ error: "This run changed. Refresh its status and try again." }, 409);
  const updated: StudioRun | null = await changeStudioRun(userId, run, next.phase, next.state);
  if (!updated) return reply({ error: "This run changed. Refresh its status and try again." }, 409);
  if (updated.phase === "queued") after(() => driveStudioRun(userId, id));
  if (updated.phase === "stopped" && run.state.taskId) {
    const taskId = run.state.taskId;
    after(() => stopStudioTask(userId, taskId));
  }
  return reply({ run: updated });
});
