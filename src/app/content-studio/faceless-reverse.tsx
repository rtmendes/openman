"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeVideo, calibrationVideo } from "@/lib/studio/faceless/reverse-browser";
import { cutsFromFrames, pace, reverseReportSchema, styleBrief, compareReports, type ReverseReport } from "@/lib/studio/faceless/reverse";
import { jsonInput } from "@/lib/studio/faceless/integration";
import { downloadStudioJson } from "./faceless-import";

export function FacelessReverse({ report, comparison, locked, onSave }: {
  report?: ReverseReport; comparison?: ReverseReport; locked: boolean;
  onSave: (report: ReverseReport, comparison: boolean) => void;
}) {
  const [file, setFile] = useState<File>();
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(30);
  const [fps, setFps] = useState(2);
  const [threshold, setThreshold] = useState(0.18);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [thumbs, setThumbs] = useState<{ t: number; image: string }[]>([]);
  const [compare, setCompare] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function analyze(calibration = false) {
    if (abort.current) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setStatus("Preparing analysis…");
    try {
      const input = calibration ? await calibrationVideo() : file;
      if (!input) throw new Error("Choose a local video first.");
      const result = await analyzeVideo(input, calibration ? "Calibration: cuts at 2s and 4s" : file!.name, {
        start: calibration ? 0 : start, length: calibration ? 6 : length, fps, threshold, signal: controller.signal,
        progress: (text) => { if (!controller.signal.aborted) setStatus(text); },
      });
      if (!controller.signal.aborted) {
        onSave(reverseReportSchema.parse(result.report), compare); setThumbs(result.thumbs);
        setStatus("Evidence saved to this project. Review candidate cuts and findings before using its style brief.");
      }
    } catch (error) { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Video analysis failed."); }
    finally { if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  const selected = compare ? comparison : report;
  const measured = selected ? pace(selected) : undefined;
  const difference = report && comparison ? compareReports(report, comparison) : undefined;
  const save = (change: Partial<ReverseReport>) => {
    if (!selected) return;
    try { onSave(reverseReportSchema.parse({ ...selected, ...change }), compare); }
    catch { setStatus("The edited evidence is invalid. Keep timestamps inside the analyzed segment."); }
  };
  return <details className="content-studio-runState faceless-reverse">
    <summary>Reverse engineer a reference video</summary>
    <p>Analyze a local video in this browser. No upload or model charge. Sampled cuts and colors are estimates; exact fonts, layers and editing settings remain unknown.</p>
    <fieldset disabled={locked || busy}>
      <label>Evidence target<select value={compare ? "rebuild" : "reference"} onChange={(event) => { setCompare(event.target.value === "rebuild"); setThumbs([]); }}><option value="reference">Reference</option><option value="rebuild">Rebuild for comparison</option></select></label>
      <label>Local video · up to 100 MB<input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0])} /></label>
      <div className="production-fields">
        <label>Start seconds<input type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label>
        <label>Analyze seconds<input type="number" min={1} max={180} value={length} onChange={(e) => setLength(Number(e.target.value))} /></label>
        <label>Samples per second<select value={fps} onChange={(e) => setFps(Number(e.target.value))}>{[1, 2, 5, 10].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Cut threshold<input type="number" step="0.01" min={0.01} max={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
      </div>
      <div className="production-actions">
        <button type="button" disabled={!file || !Number.isFinite(start) || start < 0 || length < 1 || length > 180 || threshold < 0.01 || threshold > 1} onClick={() => void analyze()}>Analyze video</button>
        <button type="button" onClick={() => void analyze(true)}>Test with two known cuts</button>
      </div>
      <label>Or import an evidence report<input type="file" accept=".json,application/json" onChange={async (event) => {
        const input = event.target.files?.[0]; event.target.value = ""; if (!input) return;
        try {
          if (input.size > 2_500_000) throw new Error("Use a report smaller than 2.5 MB.");
          const value = reverseReportSchema.parse(jsonInput(await input.text())); onSave(value, compare); setThumbs([]); setStatus("Evidence report imported.");
        } catch { setStatus("This is not a valid evidence report."); }
      }} /></label>
    </fieldset>
    {busy && <button type="button" onClick={() => { abort.current?.abort(); setStatus("Analysis cancelled."); }}>Cancel analysis</button>}
    <p role="status">{status}</p>
    {!!thumbs.length && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
      {thumbs.map((thumb) => <figure key={thumb.t} style={{ margin: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb.image} alt={`Sample at ${thumb.t.toFixed(2)} seconds`} style={{ width: "100%" }} /><figcaption>{thumb.t.toFixed(2)}s</figcaption></figure>)}
    </div>}
    {selected && measured && <fieldset disabled={locked || busy}>
      <p>{selected.name} · {selected.width} × {selected.height} · {selected.start.toFixed(2)}–{selected.end.toFixed(2)}s · {selected.cuts.length} candidate cuts · {measured.meanShot.toFixed(2)}s mean candidate shot</p>
      <p>{selected.audio ? `Audio RMS ${selected.audio.rmsDb.toFixed(1)} dBFS · ${selected.audio.silencePercent.toFixed(1)}% below −45 dBFS. Not LUFS.` : "Audio measurements unavailable."}</p>
      <p>Palette: {selected.palette.map((color) => <span key={color} style={{ borderBottom: `6px solid ${color}`, marginRight: 8 }}>{color}</span>)}</p>
      <button type="button" onClick={() => save({ cuts: cutsFromFrames(selected.frames, threshold, selected.sampleFps), threshold })}>Recalculate cuts with threshold above</button>
      <p>Candidate timestamps: {selected.cuts.map((cut) => cut.t.toFixed(2)).join(", ") || "None detected"}</p>
      <label>Verified segment transcript<textarea rows={3} maxLength={30000} value={selected.transcript} onChange={(event) => save({ transcript: event.target.value, transcriptSource: "Creator supplied; verify against the analyzed segment" })} /></label>
      <label>Reusable style notes<textarea rows={3} maxLength={12000} value={selected.style} onChange={(event) => save({ style: event.target.value })} /></label>
      {selected.findings.map((finding, index) => <div key={index}><p>{finding.label} · {finding.at}s · {finding.category}: {finding.detail}</p>
        <label>Review finding {index + 1}<select value={finding.review} onChange={(event) => save({ findings: selected.findings.map((value, i) => i === index ? { ...value, review: event.target.value as "pending" | "confirmed" | "rejected" } : value) })}>
          <option value="pending">Needs review</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option></select></label></div>)}
      <details><summary>Style brief and limitations</summary><pre style={{ whiteSpace: "pre-wrap" }}>{styleBrief(selected)}</pre></details>
      <button type="button" onClick={() => downloadStudioJson("video-evidence.json", JSON.stringify(selected, null, 2))}>Export evidence report</button>
    </fieldset>}
    {difference && <details><summary>Reference versus rebuild measurements</summary><p>Comparisons measure sampled editing similarity, not originality, quality or audience performance.</p><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(difference, null, 2)}</pre></details>}
  </details>;
}
