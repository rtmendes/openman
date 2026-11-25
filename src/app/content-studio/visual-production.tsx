"use client";

import Image from "next/image";
import { ClipboardList } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { StudioMedia } from "@/lib/studio/media-types";
import { AssetPreview, AssetThumbnail, attachmentAsset } from "./asset-preview";
import { chosenFrames, type VideoPlan, type VideoSpec } from "./production";
import { productionViews, type ProductionView } from "./production-views";

export function VisualProduction({ view, onView }: {
  view: ProductionView; onView: (view: ProductionView) => void;
}) {
  return <section id="studio-reference" className="studio-visual-production" aria-label="Video production workflow">
    <div className="studio-visual-steps" role="tablist" aria-label="Production stages">
      {productionViews.map(({ id, title, image }, index) => <button type="button" role="tab" key={id}
        id={`studio-tab-${id}`} aria-controls={`studio-panel-${id}`} aria-selected={view === id} tabIndex={view === id ? 0 : -1}
        onClick={() => onView(id)} onKeyDown={(event) => {
          const count = productionViews.length;
          let next: number;
          if (event.key === "ArrowRight") next = (index + 1) % count;
          else if (event.key === "ArrowLeft") next = (index + count - 1) % count;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = count - 1;
          else return;
          event.preventDefault();
          const nextView = productionViews[next].id;
          onView(nextView);
          document.getElementById(`studio-tab-${nextView}`)?.focus();
        }}>
        {id === "brief" ? <ClipboardList className="studio-brief-tab-icon" size={24} aria-hidden />
          : <Image src={`/studio/workflow/${image}.webp`} alt="" width={412} height={412} unoptimized />}
        <span>{title}</span>
      </button>)}
    </div>
  </section>;
}

export function ProductionViewPanel({ id, active, children }: { id: ProductionView; active: ProductionView; children: ReactNode }) {
  const step = productionViews.find((view) => view.id === id)!;
  return <section className="studio-workflow-panel" role="tabpanel" id={`studio-panel-${id}`}
    aria-labelledby={`studio-tab-${id}`} hidden={active !== id}>
    <header><h4>{step.title}</h4><p>{step.synopsis}</p></header>
    {children}
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
