import type { StartStudioRun, StudioRun, StudioRunInput, StudioRunPhase, StudioRunState } from "@/lib/studio/runs";
import { activeStudioPhases } from "@/lib/studio/runs";
import { db, fail } from "./client";

const columns = "id,video_id,kind,phase,version,input,state,due_at,created_at,updated_at";

export async function studioRuns(userId: string, videoId: string) {
  const { data, error } = await db().from("studio_runs").select(columns).eq("user_id", userId).eq("video_id", videoId)
    .order("created_at", { ascending: false }).limit(30);
  if (error) fail("list Studio runs", error);
  return (data ?? []) as StudioRun[];
}

export async function studioRun(userId: string, id: string) {
  const { data, error } = await db().from("studio_runs").select(columns).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) fail("read Studio run", error);
  return data as StudioRun | null;
}

export async function addStudioRun(userId: string, request: StartStudioRun, input: StudioRunInput, stage: number) {
  const { data, error } = await db().from("studio_runs").insert({
    user_id: userId, id: request.id, video_id: request.videoId, kind: request.kind,
    phase: "queued", input, state: { stage, outputs: [] },
  }).select(columns).single();
  if (error && error.code !== "23505") fail("queue Studio run", error);
  return data as StudioRun | null;
}

export async function changeStudioRun(userId: string, run: StudioRun, phase: StudioRunPhase, state: StudioRunState, delay = 0) {
  const now = Date.now();
  const { data, error } = await db().from("studio_runs").update({
    phase, state, version: run.version + 1, due_at: new Date(now + delay).toISOString(), updated_at: new Date(now).toISOString(),
  }).eq("user_id", userId).eq("id", run.id).eq("version", run.version).select(columns).maybeSingle();
  if (error) fail("update Studio run", error);
  return data as StudioRun | null;
}

/** Called only by the authenticated background scheduler. All mutations still require the owner. */
export async function dueStudioRuns() {
  const { data, error } = await db().from("studio_runs").select("id,user_id").in("phase", activeStudioPhases)
    .lte("due_at", new Date().toISOString()).order("due_at").limit(12);
  if (error) fail("find due Studio runs", error);
  return (data ?? []) as { user_id: string; id: string }[];
}

export async function claimStudioTick(ticket: string) {
  const { data, error } = await db().rpc("studio_claim_tick", { p_ticket: ticket });
  if (error) fail("check Studio scheduler ticket", error);
  return data === true;
}
