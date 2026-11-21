"use client";

import { useState } from "react";
import type { ApprovedVideo } from "./production-package";
import { moraViralBrief, moraViralMaxSeconds, moraViralUrl, storySteps, storyTutorial } from "./story-workflow";
import { StoryEditor } from "./story-editor";
import type { StoryEdit } from "./story-timeline";

export function StoryWorkflowPanel({ approved, duration, edit, onEdit, onRender, cloud }: {
  approved?: ApprovedVideo; duration: number; edit?: StoryEdit; onEdit: (value: StoryEdit) => void;
  onRender: (file: File) => Promise<void>; cloud: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);
  return <details className="production-shots production-wide" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>OpenCode story workflow</summary>
    <ol>{storySteps.map(({ time, label, detail }) => <li key={time}>
      <a href={storyTutorial + "&t=" + time + "s"} target="_blank" rel="noreferrer">{label}</a>
      <p>{detail}</p>
    </li>)}</ol>
    <p className="production-hint">{approved
      ? "Export approved to get the OpenCode skill, shot plan, captions and local render project."
      : "Approve a script to include the OpenCode skill and local render project in your export."}</p>
    {duration <= moraViralMaxSeconds && <p className="production-hint">
      <a href={moraViralUrl} target="_blank" rel="noreferrer">MoraViral</a> is a separate service with its own pricing. Use the brief for a manual draft.
      {approved && <> <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(moraViralBrief(approved)); setNotice("MoraViral brief copied."); }
        catch { setNotice("Download the approved ZIP to open MoraViral-brief.md."); }
      }}>Copy MoraViral brief</button></>}
    </p>}
    {notice && <p role="status">{notice}</p>}
    {approved && expanded && <StoryEditor approved={approved} value={edit} onChange={onEdit} onRender={onRender} cloud={cloud} />}
  </details>;
}
