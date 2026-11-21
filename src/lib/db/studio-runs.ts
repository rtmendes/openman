import type { StartStudioRun, StudioRun, StudioRunInput, StudioRunPhase, StudioRunState } from "@/lib/studio/runs";
import { activeStudioPhases, studioSourceKey } from "@/lib/studio/runs";
import type { StageOutput } from "@/app/content-studio/pipeline";
import { db, fail } from "./client";

const columns = "id,video_id,kind,phase,version,input,state,due_at,created_at,updated_at";

export async function studioRuns(userId: string, videoId: string) {
  const scoped = () => db().from("studio_runs").select(columns).eq("user_id", userId).eq("video_id", videoId);
  const [recent, open] = await Promise.all([
    scoped().order("created_at", { ascending: false }).limit(30),
    scoped().in("phase", [...activeStudioPhases, "review", "blocked"]),
  ]);
  if (recent.error) fail("list Studio runs", recent.error);
  if (open.error) fail("list open Studio runs", open.error);
  const unique = new Map<string, StudioRun>();
  for (const run of [...(recent.data ?? []), ...(open.data ?? [])] as StudioRun[]) {
    if ((unique.get(run.id)?.version ?? 0) <= run.version) unique.set(run.id, run);
  }
  const runs = [...unique.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
  const legacy = runs.filter(({ input, state }) => input.sourceKey === undefined && (state.plan || state.alternatives));
  if (!legacy.length) return runs;
  const revisions = [...new Set(legacy.map(({ input }) => input.revision))];
  const { data, error } = await db().from("studio_draft_versions").select("revision,items").eq("user_id", userId).in("revision", revisions);
  if (error) fail("read original Studio project versions", error);
  const keys = new Map<number, string>();
  for (const revision of data ?? []) {
    const original = (revision.items as { kit: string; spec?: { id?: string } }[]).find(({ spec }) => spec?.id === videoId);
    if (original?.spec) keys.set(revision.revision, studioSourceKey({ kit: original.kit, spec: original.spec }));
  }
  return runs.map((run) => !run.input.sourceKey && keys.has(run.input.revision)
    ? { ...run, input: { ...run.input, sourceKey: keys.get(run.input.revision) } } : run);
}

export async function studioRun(userId: string, id: string) {
  const { data, error } = await db().from("studio_runs").select(columns).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) fail("read Studio run", error);
  return data as StudioRun | null;
}

export async function approvedStudioResearch(userId: string, videoId: string) {
  const { data, error } = await db().from("studio_runs").select("state").eq("user_id", userId).eq("video_id", videoId)
    .eq("kind", "workflow").eq("phase", "complete").contains("state", { outputs: [{ result: { stage: 1, status: "ready" } }] })
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) fail("find approved Studio research", error);
  return (data?.state as StudioRunState | undefined)?.outputs.find(({ result }) => result.stage === 1 && result.status === "ready");
}

export async function addStudioRun(userId: string, request: StartStudioRun, input: StudioRunInput, stage: number, outputs: StageOutput[] = []) {
  const { data, error } = await db().from("studio_runs").insert({
    user_id: userId, id: request.id, video_id: request.videoId, kind: request.kind,
    phase: "queued", input, state: { stage, outputs },
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
