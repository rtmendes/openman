"use client";

import { useState } from "react";
import { readFacelessExport, exportFaceless, integrationByteLimit, type FacelessData, type IntegratedItem } from "@/lib/studio/faceless/integration";

export function downloadStudioJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FacelessImport({ items, locked, onImport }: { items: IntegratedItem[]; locked: boolean; onImport: (sources: FacelessData[]) => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<FacelessData[]>([]);
  const [error, setError] = useState("");
  const existing = new Set(items.flatMap((item) => item.faceless ? [item.faceless.sourceProjectId] : []));
  const fresh = preview.filter((source) => !existing.has(source.sourceProjectId));
  function check(value: string) {
    setPreview([]); setError("");
    try { setPreview(readFacelessExport(value)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not read this export."); }
  }
  return <details className="content-studio-runState faceless-import">
    <summary>Combine Faceless Director projects</summary>
    <p>Import its workspace JSON into these project folders. Existing projects remain intact; repeated imports skip matching source IDs.</p>
    <label>Workspace export<input type="file" accept="application/json,.json" disabled={locked} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setPreview([]); setError("");
      if (file.size > integrationByteLimit) { setError("Use an export smaller than 2.5 MB."); return; }
      try { const value = await file.text(); setText(value); check(value); } catch { setError("The file could not be read. Try again."); }
    }} /></label>
    <label>Or paste workspace JSON<textarea rows={3} value={text} maxLength={integrationByteLimit} onChange={(event) => { setText(event.target.value); setPreview([]); }} /></label>
    <div className="production-actions">
      <button type="button" disabled={locked || !text.trim()} onClick={() => check(text)}>Preview import</button>
      {!!items.some((item) => item.faceless) && <button type="button" onClick={() => downloadStudioJson("faceless-studio-projects.json", exportFaceless(items))}>Export Faceless source data</button>}
    </div>
    {!!preview.length && <div>
      <p>{fresh.length} new projects · {preview.length - fresh.length} already imported. No media files or approval flags transfer automatically.</p>
      <ul>{preview.map((source) => <li key={source.sourceProjectId}>{source.project.title} · {source.project.scenes.length} source scenes · {source.project.results.length} agent results {existing.has(source.sourceProjectId) ? "· already present" : ""}</li>)}</ul>
      <button type="button" disabled={locked || !fresh.length} onClick={() => {
        try { onImport(fresh); setPreview([]); setText(""); setError(""); }
        catch (error) { setError(error instanceof Error ? error.message : "Import could not be applied."); }
      }}>Import {fresh.length} projects</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
