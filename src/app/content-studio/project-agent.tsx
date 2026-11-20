"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Workflow } from "lucide-react";
import { decideStudioRun, listStudioRuns, startStudioRun, studioMediaUrl } from "@/lib/agent/client";
import { isStudioRunActive, isStudioRunOpen, matchesStudioSource, suggestionActions, type StartStudioRun, type StudioAlternative, type StudioRun, type StudioSuggestion } from "@/lib/studio/runs";
import { chosenFrames, parseVideoPlan, type VideoPlan, type VideoRatio, type VideoSpec } from "./production";
import { stages } from "./workflow";

const phaseLabels: Record<StudioRun["phase"], string> = {
  queued: "Queued", dispatching: "Starting", running: "Running", waiting: "Waiting for your input",
  review: "Needs approval", blocked: "Action needed", complete: "Complete", stopped: "Stopped",
};
type RunRequest = { kind: "script" } | { kind: "workflow"; stage?: number } | { kind: "suggestion"; suggestion: StudioSuggestion };

export function ProjectAgent({ spec, kit, script, plan, shot, onShot, revision, stage, onStage, activity, canStart, onPlan, onSuggestion, canCopy }: {
  spec: VideoSpec; kit: string; script: string; plan?: VideoPlan; shot: number; onShot: (index: number) => void; revision?: number;
  stage: number; onStage: (index: number) => void; activity: number; canStart: boolean; canCopy: boolean;
  onPlan: (run: StudioRun, copy: boolean) => void;
  onSuggestion: (run: StudioRun, option: StudioAlternative, copy: boolean) => void;
}) {
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [resultId, setResultId] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [direction, setDirection] = useState("");
  const [ratio, setRatio] = useState<VideoRatio>(chosenFrames(spec)[0]);
  const { id: videoId } = spec;
  const target = Math.min(shot, Math.max(0, (plan?.shots.length ?? 1) - 1));

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let interval = 9000;
      try {
        const { runs: fresh } = await listStudioRuns(videoId);
        if (!active) return;
        setRuns((prior) => {
          const merged = new Map(prior.map((run) => [run.id, run]));
          for (const run of fresh) if ((merged.get(run.id)?.version ?? 0) <= run.version) merged.set(run.id, run);
          return [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
            .filter((run, index) => index < 30 || isStudioRunOpen(run.phase));
        });
        setPollError(false);
        if (fresh.some(({ phase }) => isStudioRunActive(phase))) interval = 3500;
      } catch { if (active) setPollError(true); }
      finally { if (active) { setLoading(false); timer = setTimeout(refresh, interval); } }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [videoId, activity]);

  function remember(run: StudioRun) {
    setRuns((old) => {
      const sourceKey = run.input.sourceKey ?? old.find(({ id }) => id === run.id)?.input.sourceKey;
      return [{ ...run, input: { ...run.input, sourceKey } }, ...old.filter(({ id }) => id !== run.id)]
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
    setResultId(run.id);
  }

  async function start(input: RunRequest) {
    if (!revision || !canStart || pending) return;
    setPending(true);
    setError("");
    try {
      const request: StartStudioRun = { ...input, id: crypto.randomUUID(), videoId, revision };
      const { run } = await startStudioRun(request);
      remember(run);
      setChangeNotes("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start the run."); }
    finally { setPending(false); }
  }

  async function decide(run: StudioRun, action: "approve" | "retry" | "stop") {
    setPending(true);
    setError("");
    try {
      const { run: updated } = await decideStudioRun({ id: run.id, version: run.version, action, notes: changeNotes });
      remember(updated);
      setChangeNotes("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the decision."); }
    finally { setPending(false); }
  }

  function suggest(action: StudioSuggestion["action"]) {
    void start({ kind: "suggestion", suggestion: { action, shot: action === "hook" ? 0 : target, direction } });
  }

  const run = runs.find(({ id }) => id === resultId) ?? runs[0];
  const activeKind = (kind: StudioRun["kind"]) => runs.some((entry) => entry.kind === kind && isStudioRunOpen(entry.phase));
  const baseDisabled = loading || pending || !revision || !canStart;
  const selected = run?.input.suggestion;
  let sourcePlan: VideoPlan | undefined;
  if (selected && run.input.script) try { sourcePlan = parseVideoPlan(run.input.script); } catch { /* Angle suggestions also work without a shot plan. */ }
  const sourceShot = sourcePlan?.shots[selected?.shot ?? 0];
  const before = selected?.action === "caption" ? sourcePlan?.caption : selected?.action === "visual" ? sourceShot?.visual : sourceShot?.narration;
  const matchingDraft = run ? matchesStudioSource(run, { kit, spec, script }, revision) : false;
  const frame = chosenFrames(spec).includes(ratio) ? ratio : chosenFrames(spec)[0];
  const image = spec.media?.find(({ type }) => type.startsWith("image/"));

  return <aside className="studio-project-agent" aria-label="Project assistant">
    <section id="studio-suggestions" className="studio-assistant-card" aria-labelledby="studio-assistant-heading">
      <h3 id="studio-assistant-heading"><Sparkles size={16} aria-hidden /> AI suggestions</h3>
      <label>Shot<select value={target} disabled={!plan} onChange={(event) => onShot(Number(event.target.value))}>
        {!plan ? <option value={0}>No shot plan yet</option> : plan.shots.map((entry, index) => <option value={index} key={index}>Shot {index + 1} · {index ? plan.shots[index - 1].end : 0}–{entry.end}s</option>)}
      </select></label>
      <label>Direction <span className="production-hint">(optional)</span><textarea maxLength={500} rows={2} value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="Keep the punchline dry. Shorten the setup." /></label>
      <div className="studio-assistant-actions">
        {([ ["angles", "Suggest angles"], ["hook", "Write hooks"], ["narration", "Rewrite narration"], ["caption", "Write captions"], ["visual", "Suggest layouts"], ["review", "Review draft"] ] as const).map(([action, label]) => (
          <button type="button" key={action} disabled={baseDisabled || activeKind("suggestion") || (action !== "angles" && !plan)} onClick={() => suggest(action)}>{label}</button>
        ))}
      </div>
    </section>
    <section className="studio-assistant-card" aria-labelledby="studio-run-heading">
      <h3 id="studio-run-heading"><Workflow size={16} aria-hidden /> Workflow</h3>
      {!revision && <p className="production-hint">Save your project to enable agent runs.</p>}
      <label>Workflow stage<select value={stage} onChange={(event) => onStage(Number(event.target.value))}>
        {stages.map(({ title }, index) => <option value={index} key={title}>{title}</option>)}
      </select></label>
      <div className="studio-assistant-actions">
        <button type="button" disabled={baseDisabled || activeKind("script")} onClick={() => void start({ kind: "script" })}>Generate script</button>
        <button type="button" disabled={baseDisabled || activeKind("workflow")} onClick={() => void start({ kind: "workflow" })}>Run full workflow</button>
        <button type="button" disabled={baseDisabled || activeKind("workflow")} onClick={() => void start({ kind: "workflow", stage })}>Run selected stage</button>
      </div>
      <details><summary>Stage instructions</summary><ol>{stages[stage].instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></details>
      <p className="production-hint">Runs use agent credits.</p>
    </section>

    {(error || pollError) && <p role="alert">{error || "Could not refresh the run history. Retrying automatically."}</p>}
    {run && <section className="studio-assistant-card" aria-labelledby="studio-result-heading">
      <h3 id="studio-result-heading">Run results</h3>
      <label>History<select value={run.id} onChange={(event) => { setResultId(event.target.value); setChangeNotes(""); }}>
        {runs.map((entry) => <option key={entry.id} value={entry.id}>
          {entry.input.suggestion ? suggestionActions[entry.input.suggestion.action] : entry.kind === "script" ? "Script" : entry.input.singleStage !== undefined ? stages[entry.input.singleStage].title : "Full workflow"} · {phaseLabels[entry.phase]} · {new Date(entry.created_at).toLocaleString()}
        </option>)}
      </select></label>
      <p role="status"><strong>{phaseLabels[run.phase]}</strong> · {selected ? suggestionActions[selected.action] : stages[run.state.stage].title}</p>
      {run.kind === "workflow" && run.input.singleStage === undefined && <ol className="studio-run-progress" aria-label="Workflow stages">
        {stages.map(({ title }, index) => <li key={title} aria-current={index === run.state.stage ? "step" : undefined}>
          {title} <small>{index < run.state.stage || (index === run.state.stage && run.phase === "complete") ? "Complete" : index === run.state.stage ? phaseLabels[run.phase] : "Upcoming"}</small>
        </li>)}
      </ol>}
      {run.state.message && <p role="alert">{run.state.message}</p>}
      {run.state.taskId && run.phase !== "dispatching" && <Link href={`/app/task/${encodeURIComponent(run.state.taskId)}`}>{run.phase === "waiting" ? "Open task to respond" : "View agent task"}</Link>}
      {run.state.outputs.map(({ result }) => <details key={result.stage} open={result.stage === run.state.stage && run.phase === "review"}>
        <summary>{stages[result.stage].title}</summary><p>{result.summary}</p>
        {Object.entries(result.handoff).map(([field, value]) => <details className="studio-handoff" key={field}><summary>{field.replace(/([a-z])([A-Z])/g, "$1 $2")}</summary><pre>{value}</pre></details>)}
      </details>)}
      {run.state.plan && <div className="studio-result-option">
        <strong>{run.state.plan.title}</strong><p>{run.state.plan.shots.length} shots · {run.input.spec.duration}s</p>
        <details><summary>Read proposed script</summary><ol>{run.state.plan.shots.map((entry, index) => <li key={index}>{entry.narration || entry.visual}</li>)}</ol></details>
        {run.phase === "complete" && <div className="studio-assistant-actions">
          <button type="button" disabled={!matchingDraft} onClick={() => onPlan(run, false)}>Use script</button>
          <button type="button" disabled={!canCopy} onClick={() => onPlan(run, true)}>Open as variation</button>
        </div>}
      </div>}
      {run.state.alternatives && <>
        <p className="production-hint">Based on revision {run.input.revision}.</p>
        {before && <div className="studio-result-option"><strong>Original</strong><p>{before}</p></div>}
        {selected?.action === "visual" && <label>Preview frame<select value={frame} onChange={(event) => setRatio(event.target.value as VideoRatio)}>
          {chosenFrames(spec).map((value) => <option key={value}>{value}</option>)}
        </select></label>}
        {run.state.alternatives.map((option, index) => <div className="studio-result-option" key={index}>
          <strong>{option.label}</strong>{option.location && <small> · {option.location}</small>}
          {option.overlay && selected?.action === "visual" && <figure className="studio-layout-preview" data-ratio={frame} style={{ aspectRatio: frame.replace(":", "/") }} aria-label={`${frame} text placement preview`}>
            {image && <div className="studio-layout-picture" style={{ backgroundImage: `url(${studioMediaUrl(image.id)})` }} />}
            <div className="studio-layout-guides" aria-hidden /><figcaption data-placement={option.overlayPosition ?? "lower"}>{option.overlay}</figcaption>
          </figure>}
          <p>{option.text}</p><small>{option.reason}</small>
          {selected?.action !== "review" && <div className="studio-assistant-actions">
            {selected?.action !== "angles" && <button type="button" disabled={!matchingDraft} onClick={() => onSuggestion(run, option, false)}>Apply</button>}
            <button type="button" disabled={!canCopy} onClick={() => onSuggestion(run, option, true)}>Save as variation</button>
          </div>}
        </div>)}
        {!matchingDraft && selected?.action !== "review" && <p className="production-hint">The saved project changed. Open the result as a variation to keep both versions.</p>}
      </>}
      {(run.phase === "review" || run.phase === "blocked") && <label>Revision notes<textarea rows={2} value={changeNotes} maxLength={1200} onChange={(event) => setChangeNotes(event.target.value)} /></label>}
      <div className="studio-assistant-actions">
        {run.phase === "review" && <button type="button" disabled={pending} onClick={() => void decide(run, "approve")}>{run.state.plan ? "Approve script" : "Approve stage"}</button>}
        {(run.phase === "review" || run.phase === "blocked") && <button type="button" disabled={pending} onClick={() => void decide(run, "retry")}>Retry this step</button>}
        {!["complete", "stopped"].includes(run.phase) && <button type="button" disabled={pending} onClick={() => void decide(run, "stop")}>Stop run</button>}
      </div>
    </section>}
  </aside>;
}
