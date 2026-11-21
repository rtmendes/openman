import { hermesTarget, primeConnection } from "@/lib/agent/server/connection";
import { createTask, getTask, newTaskId, runtimeFor } from "@/lib/agent/server/tasks";
import { sessionFor } from "@/lib/automations/engine";
import { changeStudioRun, dueStudioRuns, studioRun } from "@/lib/db/studio-runs";
import { logEvent } from "@/lib/observability/log";
import { DbStore } from "@/lib/store/db-store";
import { stages } from "@/app/content-studio/workflow";
import { checkedStudioOutput, finalStudioStage, promptForStudioRun } from "./run-output";
import { isStudioRunActive, suggestionActions, type StudioRun } from "./runs";

const leaseMs = 120_000;
const pollMs = 45_000;
const runTimeoutMs = 2 * 60 * 60 * 1000;

async function block(userId: string, run: StudioRun, message: string) {
  return changeStudioRun(userId, run, "blocked", { ...run.state, message });
}

async function step(userId: string, run: StudioRun) {
  if (!isStudioRunActive(run.phase) || Date.parse(run.due_at) > Date.now()) return null;
  const taskId = run.state.taskId ?? newTaskId();
  const dispatching = run.phase === "queued" || run.phase === "dispatching";
  let claimed = await changeStudioRun(userId, run, dispatching ? "dispatching" : run.phase, {
    ...run.state, taskId, startedAt: run.state.startedAt ?? new Date().toISOString(),
  }, leaseMs);
  if (!claimed) return null;

  await primeConnection(sessionFor(userId));
  const store = new DbStore(userId);
  if (dispatching) {
    const alreadyCreated = await store.getTask(taskId);
    if (!alreadyCreated) {
      const target = hermesTarget(userId);
      if (target.kind === "missing") return block(userId, claimed, "Set up your agent computer before retrying this stage.");
      let prompt: string;
      try { prompt = promptForStudioRun(claimed); }
      catch { return block(userId, claimed, "The saved inputs could not be read. Start a new run from the corrected project."); }
      try {
        await createTask(store, {
          mode: "standard",
          interaction: claimed.kind === "suggestion" || claimed.state.stage === finalStudioStage || claimed.state.stage === 2 ? "chat" : "agent",
          prompt,
          references: claimed.kind === "suggestion" || claimed.state.stage === 2 || claimed.state.stage === finalStudioStage
            ? [] : claimed.state.outputs.map(({ taskId: id }) => id),
        }, { id: taskId, title: claimed.input.suggestion ? suggestionActions[claimed.input.suggestion.action] : stages[claimed.state.stage].title });
      } catch (error) {
        // Keep the reserved task ID when the write might have completed before the response failed.
        if (!(await store.getTask(taskId))) {
          await logEvent("warn", "studio.dispatch_failed", { userId, error });
          return block(userId, claimed, "The agent task could not start. Check your agent connection and retry this stage.");
        }
      }
    }
    const running = await changeStudioRun(userId, claimed, "running", claimed.state, leaseMs);
    if (!running) {
      const latest = await studioRun(userId, run.id);
      if (latest?.phase === "stopped") await (await runtimeFor(store, taskId))?.stop();
      return null;
    }
    claimed = running;
  }

  const stored = await store.getTask(taskId);
  if (!stored) return block(userId, claimed, "The linked task could not be found. Retry this stage to create a new one.");
  if (["waking", "running", "queued"].includes(stored.status)) {
    const runtime = await runtimeFor(store, taskId);
    if (Date.now() - Date.parse(claimed.state.startedAt ?? "") >= runTimeoutMs) {
      await runtime?.stop();
      return block(userId, claimed, "The agent task timed out. Check the linked task and retry this stage.");
    }
    await runtime?.waitForActiveRun();
  }
  const result = await getTask(store, taskId);
  if (!result) return block(userId, claimed, "The linked agent task is unavailable.");
  if (result.task.status === "completed") {
    const message = result.events.findLast((event) => event.type === "message.completed");
    try {
      const checked = checkedStudioOutput(claimed, message?.text ?? "");
      return changeStudioRun(userId, claimed, checked.phase, checked.state);
    } catch (error) {
      const detail = error instanceof Error && !["ZodError", "SyntaxError"].includes(error.name) ? error.message : "The output did not match the required format.";
      return block(userId, claimed, detail);
    }
  }
  if (["error", "stopped"].includes(result.task.status)) return block(userId, claimed, "The agent task ended without a usable result. Review the linked task before retrying.");
  return changeStudioRun(userId, claimed, result.task.status === "waiting" ? "waiting" : "running", claimed.state, pollMs);
}

/** The route starts the first step immediately. The existing scheduler recovers interrupted dispatches and runs. */
export async function driveStudioRun(userId: string, id: string) {
  try {
    let run = await studioRun(userId, id);
    while (run && isStudioRunActive(run.phase)) {
      run = await step(userId, run);
      if (run?.phase !== "queued") break;
    }
  } catch (error) {
    await logEvent("error", "studio.dispatch_error", { userId, error });
  }
}

export async function tickStudioRuns() {
  if (process.env.APP_DB_SCHEMA !== "mahara") return;
  try {
    const rows = await dueStudioRuns();
    // Keep the work per request bounded while giving each due project a chance to progress.
    await Promise.all(rows.map(({ user_id, id }) => driveStudioRun(user_id, id)));
  } catch (error) { await logEvent("error", "studio.tick_error", { error }); }
}

export async function stopStudioTask(userId: string, taskId: string) {
  try {
    await primeConnection(sessionFor(userId));
    const store = new DbStore(userId);
    const task = await store.getTask(taskId);
    if (task && ["queued", "waking", "running", "waiting"].includes(task.status)) {
      await (await runtimeFor(store, taskId))?.stop();
    }
  } catch (error) { await logEvent("warn", "studio.stop_error", { userId, error }); }
}
