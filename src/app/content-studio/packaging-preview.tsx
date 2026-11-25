"use client";

import { useState } from "react";
import { studioMediaUrl } from "@/lib/agent/client";
import type { StudioPackaging, StudioThumbnail } from "@/lib/studio/packaging";
import type { VideoSpec } from "./production";

const secondSpringStills = { payoff: "thermostat", reaction: "bedroom", detail: "terms" } as const;

function headlineLines(overlay: string) {
  const words = overlay.toUpperCase().split(/\s+/);
  const pairs = words.slice(1).map((_, index) =>
    [words.slice(0, index + 1).join(" "), words.slice(index + 1).join(" ")]);
  return pairs.reduce((best, pair) =>
    Math.max(...pair.map((line) => line.length)) < Math.max(...best.map((line) => line.length)) ? pair : best,
  [words.join(" ")]);
}

async function downloadPng(option: StudioThumbnail, src: string, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not generate a preview image.");
  context.fillStyle = "#1a2630";
  context.fillRect(0, 0, 1280, 720);
  if (src) {
    const response = await fetch(src);
    if (!response.ok) throw new Error("The reference image was unavailable.");
    const photo = await createImageBitmap(await response.blob());
    const scale = Math.max(1280 / photo.width, 720 / photo.height);
    context.drawImage(photo, (1280 - photo.width * scale) / 2, (720 - photo.height * scale) / 2, photo.width * scale, photo.height * scale);
    photo.close();
  }
  const flipped = option.look === "reaction";
  const fade = context.createLinearGradient(flipped ? 1280 : 0, 0, flipped ? 440 : 840, 0);
  fade.addColorStop(0, "#15101c");
  fade.addColorStop(1, "#15101c00");
  context.fillStyle = fade;
  context.fillRect(0, 0, 1280, 720);
  const lines = headlineLines(option.overlay);
  context.font = "900 102px Arial, sans-serif";
  context.textAlign = flipped ? "right" : "left";
  context.shadowColor = "#100918";
  context.shadowBlur = 16;
  for (const [line, text] of lines.entries()) {
    context.fillStyle = line ? "#ffdc94" : "#ffffff";
    context.fillText(text, flipped ? 1200 : 80, lines.length > 1 ? 320 + line * 110 : 370, 650);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The preview image could not be encoded.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `thumbnail-option-${index + 1}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PackagingPreview({ result, spec, kit }: { result: StudioPackaging; spec: VideoSpec; kit: string }) {
  const [error, setError] = useState("");
  const references = spec.media?.filter(({ type }) => type.startsWith("image/")) ?? [];
  const thermostatProject = kit === "second-spring" && /thermostat|hostage talks/i.test(spec.keyword);
  return <section className="studio-packaging" aria-label="Title and thumbnail options">
    <h4>Three title and thumbnail options</h4>
    <div className="studio-packaging-options">{result.options.map((option, index) => {
      const reference = references[index] ?? references[0];
      const src = reference ? studioMediaUrl(reference.id) : thermostatProject ? `/studio/reference/${secondSpringStills[option.look]}.jpg` : "";
      const lines = headlineLines(option.overlay);
      const textSize = Math.min(8, 82 / Math.max(...lines.map((line) => line.length)));
      return <article key={option.look} className="studio-result-option">
        <small>{result.recommendation === index + 1 ? "Recommended" : `Option ${index + 1}`}</small>
        <strong>{option.title}</strong>
        <figure className="studio-thumb" data-look={option.look} aria-label={`Thumbnail option ${index + 1}`}>
          {src && <div className="studio-thumb-photo" style={{ backgroundImage: `url(${src})` }} />}
          <figcaption style={{ fontSize: `${textSize}cqw` }}>{lines.map((line, i) => <span key={i}>{line}</span>)}</figcaption>
        </figure>
        <details><summary>Art direction</summary><p>{option.composition}</p><small>{option.reason}</small></details>
        {src && <div className="studio-assistant-actions"><button type="button" onClick={() => {
          setError("");
          void downloadPng(option, src, index).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not export this thumbnail."));
        }}>Download thumbnail {index + 1}</button></div>}
      </article>;
    })}</div>
    <details><summary>Research behind these options</summary><p>{result.patterns}</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
