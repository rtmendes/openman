"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clapperboard, Download, Plus, X } from "lucide-react";
import { createTask, getSecondSpringContext, getTask } from "@/lib/agent/client";
import { brandBrief, parseVideoPlan, planningPrompt, productionTools, readVideoPlan, videoTypes, type VideoPlan, type VideoSpec } from "./production";
import { productionFiles, productionZip, videoDimensions, type ApprovedVideo } from "./production-package";

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
};

const storageKey = "mahara:video-production:v1";
const limit = 12;

function blank(): Item {
  return { spec: { id: crypto.randomUUID(), keyword: "", brand: "", customContext: "", type: "skit", duration: 30, ratio: "9:16", reference: "" }, kit: "custom", script: "" };
}

const sampleShape = '{"title":"My video","caption":"Social caption","shots":[{"end":5,"narration":"Opening line","visual":"Describe the shot","overlay":"Opening text","sound":"Sound cue","asset":"Footage to record"}]}';

export function ProductionBatch({ canLoadBrand, signedIn, onExample }: { canLoadBrand: boolean; signedIn: boolean; onExample?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewUrls = useRef(new Map<string, string>());
  const dispatchLock = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey + (canLoadBrand ? ":owner" : ":personal")) ?? "[]") as Item[];
        setItems(saved.length ? saved.slice(0, limit) : [blank()]);
      } catch {
        setItems([blank()]);
      }
      setHydrated(true);
    });
    const urls = previewUrls.current;
    return () => {
      cancelAnimationFrame(frame);
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [canLoadBrand]);

  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(storageKey + (canLoadBrand ? ":owner" : ":personal"), JSON.stringify(items)); }
    catch { /* Private browsing may disable draft persistence. */ }
  }, [canLoadBrand, hydrated, items]);

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
  }, [pendingKey]);

  function patch(id: string, change: (item: Item) => Item) {
    setItems((rows) => rows.map((item) => item.spec.id === id ? change(item) : item));
  }

  function clearPreview(id: string) {
    const url = previewUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(id);
    setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  }

  function edit(id: string, values: Partial<VideoSpec>) {
    clearPreview(id);
    patch(id, (item) => ({ ...item, spec: { ...item.spec, ...values }, approved: undefined, stale: Boolean(item.script.trim()), context: undefined, error: undefined }));
  }

  async function contextFor(item: Item, connected?: string) {
    if (item.kit !== "second-spring") return item.spec.customContext.trim();
    if (!canLoadBrand) throw new Error("Sign in as owner to use the connected Second Spring kit.");
    return connected ?? brandBrief(await getSecondSpringContext());
  }

  async function generateScripts() {
    if (dispatchLock.current) return;
    const selected = items.filter(({ spec, script, pending, approved, stale }) => spec.keyword.trim() && (!script.trim() || stale) && !pending && !approved);
    if (!selected.length) return;
    dispatchLock.current = true;
    setDispatching(true);
    setNotice("");
    try {
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

  function previewFile(item: Item, file: File) {
    const id = item.spec.id;
    clearPreview(id);
    const url = URL.createObjectURL(file);
    previewUrls.current.set(id, url);
    setPreviews((current) => ({ ...current, [id]: url }));
    patch(id, (row) => ({ ...row, error: undefined }));
  }

  function writeScript(id: string, script: string) {
    clearPreview(id);
    patch(id, (row) => ({ ...row, script, approved: undefined, stale: false, error: undefined }));
  }

  const approved = items.flatMap((item) => !item.approved || (item.kit === "second-spring" && !canLoadBrand) ? [] : [item.approved]);
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
      <button type="button" disabled={!hydrated || dispatching || items.length >= limit} onClick={() => setItems((rows) => [...rows, blank()])}><Plus size={15} aria-hidden /> Add video</button>
      {signedIn ? <button type="button" className="content-studio-runButton" disabled={!ready || dispatching}
        onClick={generateScripts}>{dispatching ? "Starting scripts…" : `Generate scripts${ready ? ` (${ready})` : ""}`}</button>
        : <Link href="/signin?next=%2Fcontent-studio">Sign in to generate scripts</Link>}
      {approved.length > 0 && <button type="button" onClick={download}><Download size={15} aria-hidden /> Export approved ({approved.length})</button>}
    </div>
    {signedIn && <p className="production-hint">Script generation uses your agent credits. Editing, approval and exporting project files run in this browser.</p>}
    {notice && <p role="alert">{notice}</p>}
    {items.map((item, index) => {
      const { spec } = item;
      const id = spec.id;
      const locked = dispatching || item.pending;
      let plan = item.approved?.plan;
      if (!plan && item.script.trim()) {
        try { plan = parseVideoPlan(item.script); } catch { /* Show the raw draft for correction. */ }
      }
      return <article className="production-item" key={id}>
        <div className="production-itemHeading">
          <h3>{spec.keyword.trim() || `Video ${index + 1}`}</h3>
          <span>{item.pending ? "Writing script" : item.approved ? "Approved" : item.stale ? "Brief changed" : item.script ? "Review script" : "Brief"}</span>
          <button type="button" aria-label={`Remove video ${index + 1}`} disabled={locked} onClick={() => {
            clearPreview(id);
            setItems((rows) => rows.filter((row) => row.spec.id !== id));
          }}><X size={15} /></button>
        </div>
        <fieldset disabled={locked} className="production-fields">
          <legend className="production-visually-hidden">Brief for video {index + 1}</legend>
          <label>Keyword or topic<input value={spec.keyword} maxLength={180} onChange={(e) => edit(id, { keyword: e.target.value })} /></label>
          <label>Brand kit<select value={item.kit} onChange={(e) => {
            clearPreview(id);
            const kit = e.target.value as Item["kit"];
            patch(id, (row) => ({ ...row, kit, approved: undefined, context: undefined, stale: Boolean(row.script.trim()),
              spec: { ...row.spec, brand: kit === "second-spring" ? "Second Spring" : "", customContext: "" } }));
          }}><option value="custom">Custom or unbranded</option>{canLoadBrand && <option value="second-spring">Second Spring · connected</option>}</select></label>
          {item.kit === "custom" && <label>Brand name<input value={spec.brand} maxLength={100} onChange={(e) => edit(id, { brand: e.target.value })} /></label>}
          <label>Video type<select value={spec.type} onChange={(e) => edit(id, { type: e.target.value as VideoSpec["type"] })}>
            {Object.entries(videoTypes).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
          </select></label>
          <label>Runtime<select value={spec.duration} onChange={(e) => edit(id, { duration: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 180, 300].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} seconds` : seconds === 90 ? "90 seconds" : `${seconds / 60} min`}</option>)}
          </select></label>
          <label>Frame<select value={spec.ratio} onChange={(e) => edit(id, { ratio: e.target.value as VideoSpec["ratio"] })}>
            <option value="9:16">Vertical · 9:16</option><option value="16:9">Landscape · 16:9</option><option value="1:1">Square · 1:1</option>
          </select></label>
          {item.kit === "custom" && <label className="production-wide">Brand context<textarea rows={2} value={spec.customContext} maxLength={5000} onChange={(e) => edit(id, { customContext: e.target.value })} placeholder="Audience, voice, approved claims and available assets" /></label>}
          <details className="production-wide">
            <summary>Reference notes</summary>
            <label className="production-reference">Import a rea-video VIDEO.md breakdown<input type="file" accept=".md,text/markdown,text/plain" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const excerpt = await file.slice(0, 12000).text();
              edit(id, { reference: excerpt.slice(0, 6000) });
            }} /></label>
            <label>Shot order, pacing or visual references<textarea rows={2} value={spec.reference} maxLength={6000} onChange={(e) => edit(id, { reference: e.target.value })} /></label>
          </details>
        </fieldset>
        {item.taskId && <Link href={`/app/task/${encodeURIComponent(item.taskId)}`}>Open script task</Link>}
        {plan && <details className="production-shots" open={!item.approved}>
          <summary>{plan.title} · {plan.shots.length} shots</summary>
          <ol>{plan.shots.map((shot, i) => <li key={i}>
            <strong>{i ? plan.shots[i - 1].end : 0}–{shot.end}s</strong>
            <p>{shot.visual}</p>
            {shot.narration && <q>{shot.narration}</q>}
            <p>Asset · {shot.asset}　 Sound · {shot.sound}　 Overlay · {shot.overlay}</p>
          </li>)}</ol>
          <p>{plan.caption}</p>
        </details>}
        {plan && <details className="production-edit">
          <summary>Edit narration and shots</summary>
          <fieldset className="production-fields" disabled={locked}>
            <legend className="production-visually-hidden">Edit draft for video {index + 1}</legend>
            <label className="production-wide">Video title<input value={plan.title} maxLength={100} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, title: e.target.value || "Untitled" }, null, 2))} /></label>
            <label className="production-wide">Social caption<textarea value={plan.caption} maxLength={400} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, caption: e.target.value || "Draft caption" }, null, 2))} /></label>
            {plan.shots.map((shot, shotIndex) => {
              function change(values: Partial<VideoPlan["shots"][number]>) {
                if (!plan) return;
                writeScript(id, JSON.stringify({ ...plan, shots: plan.shots.map((entry, i) => i === shotIndex ? { ...entry, ...values } : entry) }, null, 2));
              }
              return <div className="production-wide production-shotFields" key={shotIndex}>
                <label>Shot {shotIndex + 1} end time in seconds<input type="number" min="1" step="0.1" value={shot.end} onChange={(e) => change({ end: Number(e.target.value) || 1 })} /></label>
                <label>Shot {shotIndex + 1} narration<textarea rows={2} maxLength={700} value={shot.narration} onChange={(e) => change({ narration: e.target.value })} /></label>
                <label>Shot {shotIndex + 1} visual<textarea rows={2} maxLength={450} value={shot.visual} onChange={(e) => change({ visual: e.target.value || "Describe the shot" })} /></label>
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
        {item.approved && <div className="production-preview">
          <label>Preview a rendered MP4<input type="file" accept="video/mp4,.mp4" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) previewFile(item, file);
          }} /></label>
          <p>Playback stays on this device. Review the export here before sharing it.</p>
          {previews[id] && <video controls playsInline preload="metadata" src={previews[id]} onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            const [width, height] = videoDimensions[spec.ratio];
            const matches = Math.abs(video.duration - spec.duration) <= 0.1 && Math.abs(video.videoWidth / video.videoHeight - width / height) < 0.01;
            if (!matches) patch(id, (row) => ({ ...row, error: `Preview is ${video.duration.toFixed(2)}s at ${video.videoWidth} × ${video.videoHeight}. The brief calls for ${spec.duration}s at ${spec.ratio}.` }));
          }} aria-label={`Private preview of ${item.approved.plan.title}`} />}
        </div>}
      </article>;
    })}
    <details className="production-toolchain">
      <summary>Production tools and handoffs</summary>
      <ul>{productionTools.map(({ name, url, role, input }) => <li key={name}><a href={url} target="_blank" rel="noreferrer">{name}</a> · {role}. {input}</li>)}</ul>
    </details>
  </section>;
}
