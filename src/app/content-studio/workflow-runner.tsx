// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, Workflow } from "lucide-react";
import { createTask, getTask, stopTask } from "@/lib/agent/client";
import { checkStageResult, stagePrompt, stageRules, type StageOutput } from "./pipeline";
import { stages, type Brief } from "./workflow";

type Phase = "queued" | "dispatching" | "running" | "waiting" | "review" | "failed" | "complete" | "stopped";
type Run = {
  brief: Brief;
  outputs: StageOutput[];
  stage: number;
  taskId?: string;
  phase: Phase;
  message?: string;
  revision?: string;
};
const checkpoint = "mahara:content-pipeline:v1";

function restore(): Run | null {
  try {
    const saved = window.sessionStorage.getItem(checkpoint);
    if (!saved) return null;
    const run = JSON.parse(saved) as Run;
    if (run.phase === "dispatching") {
      return { ...run, phase: "failed", message: "The browser was interrupted while starting this task. Check your tasks for an existing run before retrying." };
    }
    return run;
  } catch {
    return null;
  }
}

function advance(run: Run): Run {
  if (run.stage === stages.length - 1) return { ...run, phase: "complete" };
  return { brief: run.brief, outputs: run.outputs, stage: run.stage + 1, phase: "queued" };
}

const labels: Record<Phase, string> = {
  queued: "Starting",
  dispatching: "Starting",
  running: "Running",
  waiting: "Agent needs input",
  review: "Needs approval",
  failed: "Action needed",
  complete: "Complete",
  stopped: "Stopped",
};

export function WorkflowRunner({ brief, ready }: { brief: Brief; ready: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [revision, setRevision] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [pollError, setPollError] = useState("");
  const current = useRef<Run | null>(null);
  const visibility = useRef(false);

  function commit(next: Run | null) {
    current.current = next;
    try {
      if (next) window.sessionStorage.setItem(checkpoint, JSON.stringify(next));
      else window.sessionStorage.removeItem(checkpoint);
    } catch {
      setStorageError(true);
    }
    setRun(next);
  }

  useEffect(() => {
    if (visibility.current) return;
    visibility.current = true;
    const restored = restore();
    current.current = restored;
    // Reconcile the browser-only checkpoint after hydration.
    const frame = requestAnimationFrame(() => setRun(restored));
    return () => {
      cancelAnimationFrame(frame);
      visibility.current = false;
    };
  }, []);

  useEffect(() => {
    if (!run || run.phase !== "queued" || current.current !== run) return;
    const starting = { ...run, phase: "dispatching" as const };
    commit(starting);
    void createTask({
      mode: "standard",
      interaction: run.stage === stages.length - 1 ? "chat" : "agent",
      prompt: stagePrompt(run.brief, run.stage, run.outputs, run.revision ?? ""),
      references: run.outputs.map(({ taskId }) => taskId),
    }).then(({ task }) => {
      if (current.current === starting) commit({ ...starting, taskId: task.id, phase: "running" });
    }).catch((error: unknown) => {
      if (current.current !== starting) return;
      const unauthorized = error instanceof Error && /^401\b/.test(error.message);
      commit({ ...starting, phase: "failed", message: unauthorized
        ? "Sign in to Mahara, then retry this stage."
        : "Task start was not confirmed. Check your task list before retrying." });
    });
  }, [run]);

  useEffect(() => {
    if (!run?.taskId || !["running", "waiting"].includes(run.phase)) return;
    const taskId = run.taskId;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { task, events } = await getTask(taskId);
        const latest = current.current;
        if (disposed || !latest || latest.taskId !== taskId || !["running", "waiting"].includes(latest.phase)) return;
        setPollError("");
        if (task.status === "completed") {
          try {
            const final = events.findLast((event) => event.type === "message.completed");
            const result = checkStageResult(final?.text ?? "", latest.stage);
            if (result.status === "blocked") {
              commit({ ...latest, phase: "failed", message: result.summary });
              return;
            }
            const checked = { ...latest, outputs: [...latest.outputs, { taskId, result }] };
            commit(stageRules[latest.stage].review ? { ...checked, phase: "review" } : advance(checked));
          } catch (error) {
            commit({ ...latest, phase: "failed", message: error instanceof Error ? error.message : "The stage output could not be checked." });
          }
          return;
        }
        if (task.status === "error" || task.status === "stopped") {
          commit({ ...latest, phase: "failed", message: "The agent task ended before it delivered a checked result." });
          return;
        }
        const phase = task.status === "waiting" ? "waiting" : "running";
        if (phase !== latest.phase) commit({ ...latest, phase });
      } catch {
        if (!disposed) setPollError("Could not check the agent task. Retrying automatically.");
      }
      if (!disposed) timer = setTimeout(poll, 4500);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [run]);

  function retry() {
    if (!run || !["review", "failed"].includes(run.phase) || current.current !== run) return;
    setRevision("");
    setStopError("");
    commit({
      brief: run.brief,
      stage: run.stage,
      phase: "queued",
      revision: revision.trim(),
      outputs: run.outputs.filter(({ result }) => result.stage < run.stage),
    });
  }

  async function stop() {
    if (!run || current.current !== run) return;
    setStopping(true);
    setStopError("");
    const suspended = { ...run, phase: "stopped" as const };
    commit(suspended);
    try {
      if (run.taskId && ["running", "waiting"].includes(run.phase)) await stopTask(run.taskId);
    } catch {
      setStopError("Dispatch is stopped. Open the agent task to check whether it is still running.");
    } finally {
      setStopping(false);
    }
  }

  const review = run?.phase === "review";
  const failure = run?.phase === "failed";
  const terminal = run?.phase === "complete" || run?.phase === "stopped";
  const latestOutput = run?.outputs.at(-1);

  return (
    <section className="content-studio-pipeline" aria-labelledby="studio-pipeline">
      <div className="content-studio-pipelineHeader">
        <div>
          <h2 id="studio-pipeline"><Workflow size={18} aria-hidden /> Run the full workflow</h2>
          <p>Run all seven stages with your current brief. Keep this tab open for automatic handoffs.</p>
        </div>
        {(!run || terminal) && ready && (
          <button type="button" className="content-studio-runButton" disabled={stopping} onClick={() => {
            if (current.current && !["complete", "stopped"].includes(current.current.phase)) return;
            setStopError("");
            setPollError("");
            setRevision("");
            commit({ brief, outputs: [], stage: 0, phase: "queued" });
          }}><Play size={15} aria-hidden /> {run ? "Start new run" : "Start workflow"}</button>
        )}
      </div>
      {storageError && <p role="status">Checkpoints are unavailable in this browser. Keep this page open.</p>}
      {run && (
        <div className="content-studio-runState">
          <p role="status"><strong>{labels[run.phase]}</strong> · {run.brief.topic}{!terminal && " · " + stages[run.stage].title}</p>
          <ol className="content-studio-runStages">
            {stages.map((stage, index) => {
              const output = run.outputs.find(({ result }) => result.stage === index);
              const status = run.phase === "complete" || index < run.stage ? "Done"
                : index === run.stage ? labels[run.phase] : "Pending";
              return <li key={stage.title}><span>{stage.title}</span><span>{status}</span>{output && <Link href={"/app/task/" + encodeURIComponent(output.taskId)}>Output</Link>}</li>;
            })}
          </ol>
          {pollError && ["running", "waiting"].includes(run.phase) && <p role="status">{pollError}</p>}
          {run.message && <p role="alert">{run.message}</p>}
          {stopError && <p role="alert">{stopError}</p>}
          {run.taskId && !terminal && <Link href={"/app/task/" + encodeURIComponent(run.taskId)} target="_blank" rel="noopener noreferrer">Open current task</Link>}
          {stopError && run.taskId && <Link href={"/app/task/" + encodeURIComponent(run.taskId)}>Open agent task</Link>}
          {failure && run.message?.startsWith("Sign in") && <Link href="/signin?next=%2Fcontent-studio">Sign in</Link>}
          {review && latestOutput && (
            <div className="content-studio-stageReview">
              <strong>Review before continuing</strong>
              <p>{latestOutput.result.summary}</p>
              <details><summary>Review the checked handoff</summary>
                <dl>{Object.entries(latestOutput.result.handoff).map(([key, value]) => (
                  <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{value}</dd></div>
                ))}</dl>
              </details>
            </div>
          )}
          {(review || failure) && <label className="content-studio-revision">Revision notes
            <textarea value={revision} onChange={(event) => setRevision(event.target.value)} rows={2} maxLength={1500} placeholder="What should the agent change?" />
          </label>}
          <div className="content-studio-runActions">
            {review && <button type="button" className="content-studio-runButton" onClick={() => {
              if (current.current === run) commit(advance(run));
            }}>{run.stage === stages.length - 1 ? "Approve and finish" : "Approve and continue"}</button>}
            {(review || failure) && <button type="button" onClick={retry}>{review ? "Request revision" : "Retry stage"}</button>}
            {!terminal && run.phase !== "dispatching" && <button type="button" onClick={stop}>Stop workflow</button>}
          </div>
        </div>
      )}
    </section>
  );
}
