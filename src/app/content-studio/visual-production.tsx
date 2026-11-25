"use client";

import Image from "next/image";
import { ArrowRight, Play, X } from "lucide-react";
import { useState } from "react";
import type { StudioMedia } from "@/lib/studio/media-types";
import { AssetPreview, AssetThumbnail, attachmentAsset } from "./asset-preview";
import { chosenFrames, type VideoPlan, type VideoSpec } from "./production";

const steps = [
  { id: "research", title: "Research", demo: "outliers", target: "studio-topic-research", action: "Open topic research", stage: 1 },
  { id: "script", title: "Script", demo: "script", target: "studio-run-heading", action: "Open script workflow", stage: 6 },
  { id: "packaging", title: "Titles & covers", demo: "packaging", target: "studio-run-heading", action: "Open title and thumbnail workflow", stage: 2 },
  { id: "narration", title: "Narration", demo: "vertical", target: "studio-narration", action: "Hear delivery samples" },
  { id: "shots", title: "Storyboard", demo: "episode", target: "studio-storyboard", action: "Open shot board" },
  { id: "review", title: "Review & export", demo: "batch", target: "studio-video-preview", action: "Open render review" },
] as const;

export function VisualProduction({ canSeeExamples, agent, hasPlan, hasPreview, onStage }: {
  canSeeExamples: boolean; agent: boolean; hasPlan: boolean; hasPreview: boolean; onStage: (stage: number) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = steps[selected];
  const targetId = step.id === "shots" && !hasPlan ? "studio-references"
    : step.id === "review" && !hasPreview ? "studio-script"
      : step.target === "studio-run-heading" && !agent ? "studio-script" : step.target;
  const action = step.id === "shots" && !hasPlan ? "Add visual references"
    : step.id === "review" && !hasPreview ? "Open script for review" : step.action;

  return <section className="studio-visual-production" aria-label="Video production stages">
    <nav className="studio-visual-steps" aria-label="Production stages">
      {steps.map(({ id, title }, index) => <button type="button" key={id} aria-pressed={selected === index}
        onClick={() => { setSelected(index); setPlaying(false); }}>
        <Image src={`/studio/workflow/${id}.webp`} alt="" width={412} height={412} unoptimized />
        <span>{title}</span>
      </button>)}
    </nav>
    <div className="studio-visual-actions">
      <a href={`#${targetId}`} onClick={(event) => {
        event.preventDefault();
        if ("stage" in step) onStage(step.stage);
        const target = document.getElementById(targetId);
        const detail = target instanceof HTMLDetailsElement ? target : target?.querySelector("details");
        if (detail) detail.open = true;
        target?.scrollIntoView({ block: "start", behavior: "smooth" });
      }}>{action} <ArrowRight size={15} aria-hidden /></a>
      {canSeeExamples && <button type="button" aria-expanded={playing} onClick={() => setPlaying(!playing)}>
        {playing ? <X size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        {playing ? "Close example" : `Watch ${step.title.toLowerCase()} example`}
      </button>}
    </div>
    {playing && <video key={step.demo} controls playsInline autoPlay preload="metadata"
      poster={`/studio/workflow/${step.id}.webp`} src={`/api/admin/second-spring/reference/${step.demo}`}
      aria-label={`Second Spring example for ${step.title}`} />}
  </section>;
}

export function ShotBoard({ plan, spec, pinned, onPin, shotIndex, onSelect, canSelect, locked }: {
  plan: VideoPlan; spec: VideoSpec; pinned: Record<number, string>;
  onPin: (index: number, id: string) => void; shotIndex: number; onSelect: (index: number) => void;
  canSelect: boolean; locked: boolean;
}) {
  const [preview, setPreview] = useState<StudioMedia>();
  const [status, setStatus] = useState("");
  const images = (spec.media ?? []).filter(({ type }) => type.startsWith("image/") || type.startsWith("video/"));
  const selected = preview && images.find(({ id }) => id === preview.id);

  async function copyBrief(index: number) {
    const shot = plan.shots[index];
    const start = plan.shots[index - 1]?.end ?? 0;
    const brief = [
      `Create a single original storyboard frame for ${plan.title}, shot ${index + 1} (${start}–${shot.end}s).`,
      `Frame: ${chosenFrames(spec)[0]}. Keep the subject and important props within the center-safe area for ${chosenFrames(spec).join(", ")}.`,
      `Camera framing and action: ${shot.visual}`,
      `Required subject, location or props: ${shot.asset}`,
      `Leave clear space for the separate “${shot.overlay}” caption in the ${shot.overlayPosition ?? "lower"} area. Do not render lettering, logos or watermarks into the image.`,
    ].join("\n");
    try { await navigator.clipboard.writeText(brief); setStatus(`Image brief for shot ${index + 1} copied.`); }
    catch { setStatus("Clipboard unavailable. Use the shot’s visual direction and asset details."); }
  }

  return <section id="studio-storyboard" className="studio-shot-board" aria-label="Shot board">
    <header><h4>Storyboard</h4><span>{plan.shots.length} shots · {spec.duration}s</span></header>
    <div className="studio-shot-grid">
      {plan.shots.map((shot, index) => {
        const image = images.find(({ id }) => id === pinned[index]);
        return <article key={index} data-selected={canSelect && index === shotIndex} className="studio-shot-card">
          {image ? <button type="button" className="studio-shot-image" aria-label={`Preview ${image.name} for shot ${index + 1}`} onClick={() => setPreview(image)}>
            <AssetThumbnail asset={attachmentAsset(image)} key={image.id} />
          </button> : <div className="studio-shot-placeholder">
            <Image src="/studio/workflow/shots.webp" alt="" width={412} height={412} unoptimized />
            <span>No frame assigned</span>
          </div>}
          <div className="studio-shot-copy">
            <strong>Shot {index + 1} · {plan.shots[index - 1]?.end ?? 0}–{shot.end}s</strong>
            <p>{shot.visual}</p>
            {images.length > 0 && <label>Frame reference<select value={image?.id ?? ""} disabled={locked}
              onChange={(event) => onPin(index, event.target.value)}>
              <option value="">Choose an attachment</option>
              {images.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>}
            <div className="content-studio-runActions">
              <button type="button" onClick={() => void copyBrief(index)}>Copy image brief</button>
              {canSelect && <button type="button" aria-pressed={shotIndex === index} onClick={() => onSelect(index)}>Select shot</button>}
            </div>
          </div>
        </article>;
      })}
    </div>
    {selected && <AssetPreview asset={attachmentAsset(selected)} key={selected.id} onClose={() => setPreview(undefined)} />}
    {status && <p role="status">{status}</p>}
  </section>;
}
