"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clapperboard, CopyPlus, Download, Plus, X } from "lucide-react";
import { createTask, getSecondSpringContext, getTask, startStudioRun, studioMediaUrl, uploadStudioMedia } from "@/lib/agent/client";
import type { StudioMedia } from "@/lib/studio/media-types";
import type { StudioAlternative, StudioRun } from "@/lib/studio/runs";
import { brandBrief, chosenFrames, frameOptions, overlayPositions, parseVideoPlan, planningPrompt, productionTools, readVideoPlan, videoTypes, type VideoPlan, type VideoRatio, type VideoSpec } from "./production";
import { productionFiles, productionZip, videoDimensions, type ApprovedVideo } from "./production-package";
import { NarrationOptions, ReferenceInputs } from "./production-inputs";
import { ProjectAgent } from "./project-agent";
import { useStudioDrafts } from "./use-studio-drafts";
import { platforms } from "./workflow";

type Item = {
  spec: VideoSpec;
  kit: "custom" | "second-spring";
  script: string;
  approved?: ApprovedVideo;
  taskId?: string;
  pending?: boolean;
  error?: string;
  context?: string;
  stale?: boolean;
  variationOf?: string;
  variationLabel?: string;
  renders?: StudioMedia[];
};

const storageKey = "mahara:video-production:v1";
const limit = 12;

function blank(): Item {
  return { spec: { id: crypto.randomUUID(), keyword: "", brand: "", customContext: "", type: "skit", duration: 30, ratio: "9:16", reference: "" }, kit: "custom", script: "" };
}

const sampleShape = '{"title":"My video","caption":"Social caption","shots":[{"end":5,"narration":"Opening line","visual":"Describe the shot","overlay":"Opening text","sound":"Sound cue","asset":"Footage to record"}]}';

export function ProductionBatch({ canLoadBrand, signedIn, draftKey, onExample, stage, onStage }: {
  canLoadBrand: boolean; signedIn: boolean; draftKey?: string; onExample?: () => void; stage: number; onStage: (stage: number) => void;
}) {
  const drafts = useStudioDrafts<Item>(draftKey, storageKey + (canLoadBrand ? ":owner" : ":personal"), blank);
  const { items, setItems, hydrated } = drafts;
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState<{ name: string; context: string } | null>(null);
  const [brandStatus, setBrandStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [version, setVersion] = useState("");
  const [versionPending, setVersionPending] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [selectedShot, setSelectedShot] = useState(0);
  const [activity, setActivity] = useState(0);
  const previewUrls = useRef(new Map<string, string>());
  const dispatchLock = useRef(false);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!canLoadBrand) return;
    let active = true;
    void getSecondSpringContext().then((source) => {
      if (!active || !source.registry?.name || !source.kits.length) {
        if (active) setBrandStatus("unavailable");
        return;
      }
      setConnected({ name: source.registry.name, context: brandBrief(source) });
      setBrandStatus("ready");
    }).catch(() => { if (active) setBrandStatus("unavailable"); });
    return () => { active = false; };
  }, [canLoadBrand]);

  const pendingTasks = items.filter((item) => item.pending && item.taskId)
    .map(({ spec, taskId }) => [spec.id, taskId!] as const);
  const pendingKey = JSON.stringify(pendingTasks);
  useEffect(() => {
    const tasks = JSON.parse(pendingKey) as [string, string][];
    if (!tasks.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await Promise.all(tasks.map(async ([id, taskId]) => {
        try {
          const { task, events } = await getTask(taskId);
          if (stopped || !["completed", "error", "stopped"].includes(task.status)) return;
          const result = events.findLast((event) => event.type === "message.completed");
          setItems((current) => current.map((item) => item.spec.id === id && item.taskId === taskId && item.pending
            ? { ...item, pending: false, stale: task.status !== "completed" && item.stale, script: task.status === "completed" ? result?.text ?? "" : item.script,
                error: task.status === "completed" ? undefined : "Open the script task to review its status before retrying." }
            : item));
        } catch { /* A transient poll failure should not submit another task. */ }
      }));
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pendingKey, setItems]);

  function patch(id: string, change: (item: Item) => Item) {
    setItems((rows) => rows.map((item) => item.spec.id === id ? change(item) : item));
  }

  function clearPreview(id: string) {
    const url = previewUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(id);
    setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  }

  function edit(id: string, change: Partial<VideoSpec> | ((spec: VideoSpec) => Partial<VideoSpec>)) {
    clearPreview(id);
    patch(id, (item) => ({ ...item, spec: { ...item.spec, ...(typeof change === "function" ? change(item.spec) : change) },
      approved: undefined, stale: Boolean(item.script.trim()), context: undefined, error: undefined }));
  }

  async function contextFor(item: Item, cached?: string) {
    if (item.kit !== "second-spring") return item.spec.customContext.trim();
    if (!canLoadBrand) throw new Error("Sign in as owner to use the connected Second Spring kit.");
    return cached ?? connected?.context ?? brandBrief(await getSecondSpringContext());
  }

  async function generateScripts() {
    if (dispatchLock.current) return;
    const selected = items.filter(({ spec, script, pending, approved, stale }) => spec.keyword.trim() && (!script.trim() || stale) && !pending && !approved);
    if (!selected.length) return;
    dispatchLock.current = true;
    setDispatching(true);
    setNotice("");
    try {
      if (draftKey) {
        if (!drafts.savedRevision) { setNotice("Wait for the projects to save before queuing scripts."); return; }
        const revision = drafts.savedRevision;
        const results = await Promise.allSettled(selected.map(({ spec }) => startStudioRun({
          kind: "script", id: crypto.randomUUID(), videoId: spec.id, revision,
        })));
        const queued = results.filter(({ status }) => status === "fulfilled").length;
        setNotice(`${queued} of ${results.length} scripts queued. Open each project to review its run.${queued < results.length ? " Check projects with an existing run or unsaved changes." : ""}`);
        setActivity((count) => count + 1);
        return;
      }
      let connected: string | undefined;
      for (const item of selected) {
        const id = item.spec.id;
        try {
          const context = await contextFor(item, connected);
          if (item.kit === "second-spring") connected = context;
          const { task } = await createTask({ mode: "standard", interaction: "chat", prompt: planningPrompt(item.spec, context) });
          patch(id, (row) => ({ ...row, pending: true, taskId: task.id, context, error: undefined }));
        } catch {
          patch(id, (row) => ({ ...row, error: "The script task was not confirmed. Check your tasks before retrying." }));
          setNotice("Dispatch paused. Review the task status before submitting another batch.");
          break;
        }
      }
    } finally {
      dispatchLock.current = false;
      setDispatching(false);
    }
  }

  async function approve(item: Item) {
    try {
      const plan = readVideoPlan(item.script, item.spec.duration);
      const context = item.context ?? await contextFor(item);
      patch(item.spec.id, (row) => row.script === item.script && row.spec === item.spec && row.kit === item.kit
        ? { ...row, approved: { spec: row.spec, plan, brandContext: context }, error: undefined } : row);
    } catch (error) {
      patch(item.spec.id, (row) => ({ ...row, error: error instanceof Error ? error.message : "The script could not be approved." }));
    }
  }

  async function previewFile(item: Item, file: File) {
    const id = item.spec.id;
    clearPreview(id);
    const url = URL.createObjectURL(file);
    previewUrls.current.set(id, url);
    setPreviews((current) => ({ ...current, [id]: url }));
    patch(id, (row) => ({ ...row, error: undefined }));
    if (!draftKey) return;
    setUploading((current) => ({ ...current, [id]: true }));
    try {
      const media = await uploadStudioMedia(file);
      patch(id, (row) => ({ ...row, renders: [...(row.renders ?? []), media] }));
    } catch {
      patch(id, (row) => ({ ...row, error: "The preview is available in this tab. Private upload failed, so the file was not saved." }));
    } finally { setUploading((current) => ({ ...current, [id]: false })); }
  }

  function writeScript(id: string, script: string) {
    clearPreview(id);
    patch(id, (row) => ({ ...row, script, approved: undefined, stale: false, error: undefined }));
  }

  function copyDraft(item: Item, keepRender: boolean): Item {
    const { spec, kit, script, stale, variationLabel } = item;
    return { spec: { ...spec, id: crypto.randomUUID() }, kit, script, stale, variationOf: item.variationOf ?? spec.id, variationLabel,
      ...(keepRender ? { renders: item.renders } : {}) };
  }

  function addCopies(source: Item[], keepRender: boolean) {
    if (!source.length || items.length + source.length > limit) {
      setNotice("There is room for 12 videos in the active batch. Free space before opening these copies.");
      return false;
    }
    const copies = source.map((item) => copyDraft(item, keepRender));
    setItems((current) => current.length + copies.length > limit ? current : [...current, ...copies]);
    setProjectId(copies[0].spec.id);
    setSelectedShot(0);
    setNotice(keepRender ? "Saved revision opened as editable copies." : "Variation added. The original is still in your batch.");
    return true;
  }

  function addVideo() {
    const item = blank();
    setItems((rows) => [...rows, item]);
    setProjectId(item.spec.id);
    setSelectedShot(0);
  }

  function loadRunPlan(item: Item, run: StudioRun, copy: boolean) {
    if (!run.state.plan || run.phase !== "complete") return;
    const script = JSON.stringify(run.state.plan, null, 2);
    if (copy) {
      addCopies([{ spec: run.input.spec, kit: run.input.kit, script, variationLabel: run.state.plan.title }], false);
      return;
    }
    if (run.input.revision !== drafts.savedRevision || item.script !== run.input.script) return;
    patch(item.spec.id, (row) => ({ ...row, script, stale: false, error: undefined,
      approved: { spec: row.spec, plan: run.state.plan!, brandContext: run.input.brief.brandContext ?? "" } }));
  }

  function applySuggestion(item: Item, run: StudioRun, option: StudioAlternative, copy: boolean) {
    const selection = run.input.suggestion;
    if (!selection || selection.action === "review") return;
    if (selection.action === "angles") {
      if (copy) addCopies([{ spec: { ...run.input.spec, reference: [run.input.spec.reference, "Creative direction: " + option.text].filter(Boolean).join("\n\n").slice(0, 6000) },
        kit: run.input.kit, script: "", variationLabel: option.label }], false);
      return;
    }
    if (!copy && (run.input.revision !== drafts.savedRevision || item.script !== run.input.script)) return;
    try {
      const original = parseVideoPlan(run.input.script);
      const plan = selection.action === "caption" ? { ...original, caption: option.text } : {
        ...original, shots: original.shots.map((entry, index) => index !== selection.shot ? entry : selection.action === "visual"
          ? { ...entry, visual: option.text, overlay: option.overlay ?? entry.overlay, overlayPosition: option.overlayPosition ?? entry.overlayPosition }
          : { ...entry, narration: option.text }),
      };
      const script = JSON.stringify(plan, null, 2);
      readVideoPlan(script, run.input.spec.duration);
      if (copy) addCopies([{ spec: run.input.spec, kit: run.input.kit, script, variationLabel: option.label }], false);
      else writeScript(item.spec.id, script);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The suggestion does not fit this plan.");
    }
  }

  async function openVersion() {
    if (!version) return;
    setVersionPending(true);
    try { addCopies(await drafts.readVersion(Number(version)), true); }
    catch { setNotice("Could not open this revision. Try again."); }
    finally { setVersionPending(false); }
  }

  function chooseKit(id: string, kit: Item["kit"], custom?: VideoSpec) {
    clearPreview(id);
    patch(id, (row) => ({ ...row, kit, approved: undefined, context: undefined, stale: Boolean(row.script.trim()),
      spec: { ...row.spec, brand: kit === "second-spring" ? connected?.name ?? "Second Spring" : custom?.brand ?? "",
        customContext: kit === "custom" ? custom?.customContext ?? "" : "" } }));
  }

  const approved = items.flatMap((item) => !item.approved || (item.kit === "second-spring" && !canLoadBrand) ? [] : [item.approved]);
  const activeId = items.find(({ spec }) => spec.id === projectId)?.spec.id ?? items[0]?.spec.id;
  const ready = items.filter(({ spec, script, pending, approved, stale }) => spec.keyword.trim() && (!script.trim() || stale) && !pending && !approved).length;
  function download() {
    const url = URL.createObjectURL(productionZip(productionFiles(approved)));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "video-production-batch.zip";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section id="video-production" className="content-studio-pipeline production-batch" aria-labelledby="production-heading">
    <div className="content-studio-pipelineHeader">
      <div>
        <h2 id="production-heading"><Clapperboard size={19} aria-hidden /> Video production</h2>
        <p>Set the brand and keyword for each video. Review the scripts and shots before exporting editable projects.</p>
      </div>
    </div>
    <div className="production-actions content-studio-runActions">
      {onExample && <button type="button" onClick={onExample}>Watch batch example</button>}
      <button type="button" disabled={!hydrated || dispatching || items.length >= limit} onClick={addVideo}><Plus size={15} aria-hidden /> Add video</button>
      {signedIn ? <button type="button" className="content-studio-runButton" disabled={!ready || dispatching || (Boolean(draftKey) && !drafts.savedRevision)}
        onClick={generateScripts}>{dispatching ? "Starting scripts…" : `Generate ${draftKey ? "batch " : ""}scripts${ready ? ` (${ready})` : ""}`}</button>
        : <Link href="/signin?next=%2Fcontent-studio">Sign in to generate scripts</Link>}
      {approved.length > 0 && <button type="button" onClick={download}><Download size={15} aria-hidden /> Export approved ({approved.length})</button>}
    </div>
    {draftKey && <div className="production-sync">
      <p role="status">{({
        opening: "Opening saved drafts…", ready: "Autosave is on", saving: "Saving drafts…", saved: "Saved to Supabase",
        offline: "Cloud save unavailable. Your edits are kept in this tab.", conflict: "A newer revision exists. Open it before continuing.", local: "Saved in this tab",
      })[drafts.status]}</p>
      {drafts.status === "conflict" && <button type="button" onClick={() => void drafts.reopen()}>Open latest revision</button>}
      {drafts.status === "offline" && <button type="button" onClick={drafts.retry}>Retry cloud save</button>}
      {drafts.recovery && <button type="button" onClick={() => {
        if (drafts.recovery && addCopies(drafts.recovery, true)) drafts.clearRecovery();
      }}>Recover local edits as copies</button>}
      {!!drafts.versions.length && <details>
        <summary>Version history</summary>
        <label>Saved revision<select value={version} onChange={(event) => setVersion(event.target.value)}>
          <option value="">Choose a revision</option>
          {drafts.versions.map(({ revision, created_at }) => <option key={revision} value={revision}>Version {revision} · {new Date(created_at).toLocaleString()}</option>)}
        </select></label>
        <button type="button" disabled={!version || versionPending || dispatching} onClick={() => void openVersion()}>Open as copies</button>
      </details>}
    </div>}
    {canLoadBrand && <p className="production-hint">{brandStatus === "ready" ? `Connected brand kit: ${connected?.name} · Read-only`
      : brandStatus === "checking" ? "Checking connected brand kits…" : "Could not verify the Second Spring kit. Refresh to retry."}</p>}
    {signedIn && <p className="production-hint">Script generation uses your agent credits.</p>}
    {notice && <p role="alert">{notice}</p>}
    <div className="studio-project-grid">
    {items.length > 0 && <nav className="studio-project-list" aria-label="Saved video projects">
      <h3>Projects</h3>
      {items.map(({ spec, variationOf, variationLabel }, index) => <button type="button" key={spec.id} aria-current={activeId === spec.id ? "page" : undefined} onClick={() => {
        setProjectId(spec.id); setSelectedShot(0);
      }}>
        <span>{variationLabel || spec.keyword || `Video ${index + 1}`}</span>
        <small>{[spec.brand, `${spec.duration}s`, variationOf ? "Variation" : null].filter(Boolean).join(" · ")}</small>
      </button>)}
    </nav>}
    {items.map((item, index) => {
      const { spec } = item;
      const id = spec.id;
      if (id !== activeId) return null;
      const locked = dispatching || item.pending || uploading[id];
      const previewUrl = previews[id] || (item.renders?.length ? studioMediaUrl(item.renders.at(-1)!.id) : "");
      let plan = item.approved?.plan;
      if (!plan && item.script.trim()) {
        try { plan = parseVideoPlan(item.script); } catch { /* Show the raw draft for correction. */ }
      }
      return <div className={`studio-project-body${draftKey ? " studio-project-body-agent" : ""}`} key={id}>
      <article className="production-item">
        <div className="production-itemHeading">
          <h3>{item.variationLabel || spec.keyword.trim() || `Video ${index + 1}`}</h3>
          <span>{item.pending ? "Writing script" : item.approved ? "Approved" : item.stale ? "Brief changed" : item.variationOf ? "Variation" : item.script ? "Review script" : "Brief"}</span>
          <button type="button" aria-label={`Create variation of video ${index + 1}`} title="Create variation" disabled={locked || items.length >= limit} onClick={() => { addCopies([item], false); }}><CopyPlus size={15} /></button>
          <button type="button" aria-label={`Remove video ${index + 1}`} disabled={locked} onClick={() => {
            clearPreview(id);
            setItems((rows) => rows.filter((row) => row.spec.id !== id));
          }}><X size={15} /></button>
        </div>
        <p className="production-hint">{spec.brand || "Unbranded"} · {spec.duration}s · {chosenFrames(spec).join(", ")}</p>
        <fieldset disabled={locked} className="production-fields">
          <legend className="production-visually-hidden">Brief for video {index + 1}</legend>
          <label>Keyword or topic<input value={spec.keyword} maxLength={180} onChange={(e) => edit(id, { keyword: e.target.value })} /></label>
          <label>Brand kit<select value={item.kit} onChange={(e) => {
            const value = e.target.value;
            const reuse = items.find(({ spec: other }) => other.id === value);
            chooseKit(id, value === "second-spring" ? "second-spring" : "custom", reuse?.spec);
          }}><option value="custom">{item.kit === "custom" && spec.brand ? spec.brand : "Custom or unbranded"}</option>
            {canLoadBrand && <option value="second-spring">Second Spring{brandStatus === "ready" ? " · connected" : ""}</option>}
            {items.filter((other) => other.spec.id !== id && other.kit === "custom" && other.spec.brand.trim() && other.spec.customContext.trim())
              .map(({ spec: other }) => <option key={other.id} value={other.id}>Reuse {other.brand}</option>)}
          </select></label>
          {item.kit === "custom" && <label>Brand name<input value={spec.brand} maxLength={100} onChange={(e) => edit(id, { brand: e.target.value })} /></label>}
          <label>Video type<select value={spec.type} onChange={(e) => edit(id, { type: e.target.value as VideoSpec["type"] })}>
            {Object.entries(videoTypes).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
          </select></label>
          <label>Runtime<select value={spec.duration} onChange={(e) => edit(id, { duration: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 180, 300].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} seconds` : seconds === 90 ? "90 seconds" : `${seconds / 60} min`}</option>)}
          </select></label>
          <label>Audience<input value={spec.audience ?? ""} placeholder={item.kit === "second-spring" ? "Use the brand kit audience" : "Who is this for?"} maxLength={300} onChange={(e) => edit(id, { audience: e.target.value })} /></label>
          <label>Language<input value={spec.language ?? "English"} maxLength={80} onChange={(e) => edit(id, { language: e.target.value })} /></label>
          <fieldset className="production-wide production-frames"><legend>Platforms</legend>
            {platforms.map((channel) => {
              const chosen = spec.platforms ?? [...platforms];
              const checked = chosen.includes(channel);
              return <label key={channel}><input type="checkbox" checked={checked} disabled={checked && chosen.length === 1}
                onChange={() => edit(id, { platforms: checked ? chosen.filter((value) => value !== channel) : [...chosen, channel] })} />{channel}</label>;
            })}
          </fieldset>
          <fieldset className="production-wide production-frames"><legend>Export frames</legend>
            {Object.entries(frameOptions).map(([ratio, label]) => {
              const selected = chosenFrames(spec);
              const active = selected.includes(ratio as VideoRatio);
              return <label key={ratio}><input type="checkbox" checked={active} disabled={active && selected.length === 1} onChange={() => {
                const frames = active ? selected.filter((value) => value !== ratio) : [...selected, ratio as VideoRatio];
                edit(id, { ratio: frames[0], ratios: frames });
              }} />{label} · {ratio}</label>;
            })}
          </fieldset>
          {item.kit === "custom" && <label className="production-wide">Brand context<textarea rows={2} value={spec.customContext} maxLength={5000} onChange={(e) => edit(id, { customContext: e.target.value })} placeholder="Audience, voice, approved claims and available assets" /></label>}
          <NarrationOptions voice={spec.voice} line={plan?.shots.find((shot) => shot.narration)?.narration} onChange={(voice) => edit(id, { voice })} />
          <ReferenceInputs spec={spec} cloud={Boolean(draftKey)} onChange={(change) => edit(id, change)} />
        </fieldset>
        {item.taskId && <Link href={`/app/task/${encodeURIComponent(item.taskId)}`}>Open script task</Link>}
        {plan && <details className="production-shots" open={!item.approved}>
          <summary>{plan.title} · {plan.shots.length} shots</summary>
          <ol>{plan.shots.map((shot, i) => <li key={i} data-selected={i === selectedShot}>
            <strong>{i ? plan.shots[i - 1].end : 0}–{shot.end}s</strong>
            <p>{shot.visual}</p>
            {shot.narration && <q>{shot.narration}</q>}
            <p>Asset · {shot.asset}　 Sound · {shot.sound}　 Overlay · {shot.overlay}</p>
            {draftKey && <button type="button" aria-pressed={i === selectedShot} onClick={() => setSelectedShot(i)}>Select shot {i + 1} for AI</button>}
          </li>)}</ol>
          <p>{plan.caption}</p>
          {plan.titleOptions && <details><summary>Alternate titles</summary><ul>{plan.titleOptions.map((title, i) => <li key={i}>{title}</li>)}</ul></details>}
          {plan.description && <details><summary>Platform description</summary><p>{plan.description}</p></details>}
        </details>}
        {plan && <details className="production-edit">
          <summary>Edit narration and shots</summary>
          <fieldset className="production-fields" disabled={locked}>
            <legend className="production-visually-hidden">Edit draft for video {index + 1}</legend>
            <label className="production-wide">Video title<input value={plan.title} maxLength={100} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, title: e.target.value || "Untitled" }, null, 2))} /></label>
            <label className="production-wide">Social caption<textarea value={plan.caption} maxLength={400} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, caption: e.target.value || "Draft caption" }, null, 2))} /></label>
            <label className="production-wide">Platform description<textarea value={plan.description ?? ""} rows={3} maxLength={1500} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, description: e.target.value || undefined }, null, 2))} /></label>
            {plan.shots.map((shot, shotIndex) => {
              function change(values: Partial<VideoPlan["shots"][number]>) {
                if (!plan) return;
                writeScript(id, JSON.stringify({ ...plan, shots: plan.shots.map((entry, i) => i === shotIndex ? { ...entry, ...values } : entry) }, null, 2));
              }
              return <div className="production-wide production-shotFields" key={shotIndex}>
                <label>Shot {shotIndex + 1} end time in seconds<input type="number" min="1" step="0.1" value={shot.end} onChange={(e) => change({ end: Number(e.target.value) || 1 })} /></label>
                <label>Shot {shotIndex + 1} narration<textarea rows={2} maxLength={700} value={shot.narration} onChange={(e) => change({ narration: e.target.value })} /></label>
                <label>Shot {shotIndex + 1} visual<textarea rows={2} maxLength={450} value={shot.visual} onChange={(e) => change({ visual: e.target.value || "Describe the shot" })} /></label>
                <label>Shot {shotIndex + 1} overlay<input maxLength={100} value={shot.overlay} onChange={(e) => change({ overlay: e.target.value || "On-screen text" })} /></label>
                <label>Overlay placement<select value={shot.overlayPosition ?? "lower"} onChange={(e) => change({ overlayPosition: e.target.value as (typeof overlayPositions)[number] })}>
                  {overlayPositions.map((position) => <option key={position}>{position}</option>)}
                </select></label>
              </div>;
            })}
          </fieldset>
        </details>}
        <details className="production-edit">
          <summary>{item.script ? "View or replace script data" : "Import a script and shot plan"}</summary>
          <label>Script JSON<textarea rows={7} value={item.script} maxLength={40000} disabled={locked} placeholder={sampleShape} onChange={(e) => writeScript(id, e.target.value)} /></label>
        </details>
        {item.stale && <p className="production-hint">Generate a new script or update the draft to match this brief before approving it.</p>}
        {item.error && <p role="alert">{item.error}</p>}
        {item.script.trim() && !item.approved && <div className="content-studio-runActions">
          <button type="button" disabled={locked || item.stale || !spec.keyword.trim()} onClick={() => void approve(item)}>Approve script and shots</button>
        </div>}
        {(item.approved || item.renders?.length) ? <div className="production-preview">
          {item.approved && <label>{draftKey ? "Save and preview a rendered MP4" : "Preview a rendered MP4"}<input type="file" accept="video/mp4,.mp4" disabled={locked} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void previewFile(item, file);
            e.target.value = "";
          }} /></label>}
          {uploading[id] && <p role="status">Saving video privately…</p>}
          {draftKey && !!item.renders?.length && <ul aria-label="Saved renders">
            {item.renders.map((asset) => <li className="production-sourceLine" key={asset.id}>
              <button type="button" onClick={() => {
                clearPreview(id);
                setPreviews((current) => ({ ...current, [id]: studioMediaUrl(asset.id) }));
              }}>Play {asset.name}</button>
              <a href={studioMediaUrl(asset.id, true)}>Download</a>
            </li>)}
          </ul>}
          <p>{draftKey ? "Saved renders are private. Review them here before sharing." : "Playback stays on this device."}</p>
          {previewUrl && <video controls playsInline preload="metadata" src={previewUrl} onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            const aspect = video.videoWidth / video.videoHeight;
            const ratios = chosenFrames(spec);
            const matches = Math.abs(video.duration - spec.duration) <= 0.1 && ratios.some((ratio) => {
              const [width, height] = videoDimensions[ratio];
              return Math.abs(aspect - width / height) < 0.01;
            });
            if (!matches) patch(id, (row) => ({ ...row, error: `Preview is ${video.duration.toFixed(2)}s at ${video.videoWidth} × ${video.videoHeight}. The brief calls for ${spec.duration}s at ${ratios.join(", ")}.` }));
          }} aria-label={`Private preview of ${item.approved?.plan.title ?? spec.keyword}`} />}
        </div> : null}
      </article>
      {draftKey && <ProjectAgent spec={spec} script={item.script} plan={plan} shot={selectedShot} onShot={setSelectedShot}
        revision={drafts.savedRevision} stage={stage} onStage={onStage} activity={activity} canStart={Boolean(spec.keyword.trim()) && !locked && (item.kit !== "second-spring" || brandStatus === "ready")}
        canCopy={items.length < limit} onPlan={(run, copy) => loadRunPlan(item, run, copy)} onSuggestion={(run, option, copy) => applySuggestion(item, run, option, copy)} />}
      </div>;
    })}
    </div>
    <details className="production-toolchain">
      <summary>Production tools and handoffs</summary>
      <ul>{productionTools.map(({ name, url, role, input }) => <li key={name}><a href={url} target="_blank" rel="noreferrer">{name}</a> · {role}. {input}</li>)}</ul>
    </details>
  </section>;
}
