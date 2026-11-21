"use client";

import { useMemo, useState } from "react";
import {
  draftResearchBrief, groupGoogleKeywords, groupSavedVideos, researchBriefLimit, researchEvidenceLabels, type ResearchBrief,
} from "@/lib/studio/research-briefs";
import { keywordObjectives, type KeywordBoard } from "@/lib/studio/keyword-research";
import { videoTypes, type VideoSpec } from "./production";

export type ResearchBriefChanges = Pick<VideoSpec, "researchBriefs" | "activeResearchBriefId">;

export function ResearchBriefs({ spec, board, audience, youtube, onChange }: {
  spec: VideoSpec; board: KeywordBoard; audience: string; youtube?: string;
  onChange: (changes: ResearchBriefChanges, affectsScript: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState("");
  const briefs = spec.researchBriefs ?? [];
  const current = briefs.find(({ id }) => id === selected) ?? briefs.at(-1);
  const context = { topic: spec.keyword, audience, duration: spec.duration, format: videoTypes[spec.type].label,
    direction: videoTypes[spec.type].direction };
  const google = useMemo(() => groupGoogleKeywords(board, { topic: spec.keyword, audience }), [board, spec.keyword, audience]);
  const videos = useMemo(() => youtube ? groupSavedVideos(youtube, spec.keyword, audience) : [], [youtube, spec.keyword, audience]);

  function patchBrief(brief: ResearchBrief, changes: Partial<ResearchBrief>) {
    onChange({ researchBriefs: briefs.map((row) => row.id === brief.id ? { ...row, ...changes } : row) }, spec.activeResearchBriefId === brief.id);
  }

  return <section className="studio-research-briefs" aria-label="Keyword groups and content briefs">
    <h4>Keyword groups and content briefs</h4>
    <p className="production-hint">Review saved research and build an editable video brief. This uses no model or provider calls.</p>
    {!google.length && !videos.length && <p>Open a saved keyword report, import an export, or open a project with an approved YouTube scan.</p>}
    {([{ title: "Google keyword groups", data: google }, { title: "Themes from saved YouTube research", data: videos }]).map(({ title, data }) =>
      data.length > 0 && <div className="studio-research-groups" key={title}>
        <h5>{title}</h5>
        {(showAll ? data : data.slice(0, 5)).map((group) => <details className="studio-keyword-import" key={group.id}>
          <summary>{group.label} <small>{group.members.length} {group.kind === "youtube" ? "videos" : "keyword records"}</small></summary>
          <p className="production-hint">{researchEvidenceLabels[group.kind]} · {group.scope}</p>
          <ul className="studio-research-evidence">{group.members.map(({ title, source, detail }, index) => <li key={`${title}-${index}`}>
            {source ? <a href={source} target="_blank" rel="noreferrer">{title}</a> : <span>{title}</span>}
            {detail && <small>{detail}</small>}
          </li>)}</ul>
          {group.kind !== "youtube" && group.sources.length > 0 && <details className="studio-keyword-import">
            <summary>View saved ranking pages</summary>
            <ul className="studio-research-evidence">{group.sources.map(({ title, url }) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>)}</ul>
          </details>}
          <div className="content-studio-runActions">
            <button type="button" disabled={briefs.length >= researchBriefLimit} onClick={() => {
              if (briefs.length >= researchBriefLimit) return;
              const brief = draftResearchBrief(group, {
                ...context, direction: group.kind === "youtube" ? context.direction : `${keywordObjectives[board.objective]}. ${context.direction}`,
              }, crypto.randomUUID());
              onChange({ researchBriefs: [...briefs, brief] }, false);
              setSelected(brief.id);
              setMessage("Content brief created. Review it before using it for scripts.");
            }}>Create content brief</button>
          </div>
        </details>)}
      </div>)}
    {(google.length > 5 || videos.length > 5) && <div className="content-studio-runActions">
      <button type="button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer groups" : "Show all groups"}</button>
    </div>}
    {briefs.length >= researchBriefLimit && <p className="production-hint">This project has six briefs. Remove one to make room for another.</p>}
    {current && <div className="studio-keyword-pick studio-research-editor">
      <label>Saved content brief<select value={current.id} onChange={(event) => { setSelected(event.target.value); setMessage(""); }}>
        {briefs.map((brief) => <option key={brief.id} value={brief.id}>{brief.title || brief.topic}{spec.activeResearchBriefId === brief.id ? " · used for scripts" : ""}</option>)}
      </select></label>
      <p className="production-hint">{researchEvidenceLabels[current.kind]} · {current.scope} · Researched for {current.topic}{current.audience ? ` · ${current.audience}` : ""}</p>
      <label>Brief title<input maxLength={180} value={current.title} onChange={(event) => patchBrief(current, { title: event.target.value })} /></label>
      <label>Creative angle<textarea rows={2} maxLength={600} value={current.angle} onChange={(event) => patchBrief(current, { angle: event.target.value })} /></label>
      <label>Video direction<textarea rows={2} maxLength={700} value={current.beats} onChange={(event) => patchBrief(current, { beats: event.target.value })} /></label>
      <label>What to verify<textarea rows={2} maxLength={600} value={current.check} onChange={(event) => patchBrief(current, { check: event.target.value })} /></label>
      <details>
        <summary>Research behind this brief</summary>
        <ul className="studio-research-evidence">{current.terms.map((term) => <li key={term}>{term}</li>)}</ul>
        {!!current.sources.length && <ul className="studio-research-evidence">{current.sources.map(({ title, url }) =>
          <li key={url}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>)}</ul>}
      </details>
      <div className="content-studio-runActions">
        <button type="button" disabled={!current.angle.trim() || !current.beats.trim()} onClick={() => {
          const active = spec.activeResearchBriefId === current.id;
          onChange({ activeResearchBriefId: active ? undefined : current.id }, true);
          setMessage(active ? "This brief is saved. Future scripts will use the project’s other references." : "Future scripts will use this brief. Start script generation when ready.");
        }}>{spec.activeResearchBriefId === current.id ? "Stop using for scripts" : "Use for scripts"}</button>
        <button type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText([current.title, current.topic, current.audience, current.angle, current.beats, current.check,
              ...current.terms, ...current.sources.map(({ title, url }) => `${title} ${url}`)].filter(Boolean).join("\n"));
            setMessage("Content brief copied.");
          } catch { setMessage("Could not copy the brief. Your draft is still saved."); }
        }}>Copy brief</button>
        <button type="button" onClick={() => {
          const active = spec.activeResearchBriefId === current.id;
          onChange({ researchBriefs: briefs.filter(({ id }) => id !== current.id), ...(active ? { activeResearchBriefId: undefined } : {}) }, active);
          setSelected("");
          setMessage("Content brief removed from this draft.");
        }}>Remove brief</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
