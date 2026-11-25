/* eslint-disable @next/next/no-img-element -- Private thumbnails use an authenticated redirect and must bypass the shared image optimizer. */
"use client";

import { AudioLines, ExternalLink, FileText, Film, ImageIcon, Link2, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { studioMediaUrl } from "@/lib/agent/client";
import { mediaExtension, studioTextExtension, type StudioMedia } from "@/lib/studio/media-types";

type Kind = "image" | "video" | "audio" | "pdf" | "text" | "youtube" | "link";
export type PreviewAsset = { key: string; title: string; src: string; kind: Kind; download?: string; videoId?: string };

export function referenceUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && url.href.length <= 1500 ? url.href : null;
  } catch { return null; }
}

function mediaKind(type: string, name: string): Kind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (studioTextExtension.test(mediaExtension(name))) return "text";
  return "link";
}

export function attachmentAsset(asset: StudioMedia): PreviewAsset {
  return { key: asset.id, title: asset.name, src: studioMediaUrl(asset.id), download: studioMediaUrl(asset.id, true), kind: mediaKind(asset.type, asset.name) };
}

export function linkAsset(raw: string): PreviewAsset | undefined {
  const src = referenceUrl(raw);
  if (!src) return;
  const url = new URL(src);
  const path = url.pathname.split("/").filter(Boolean);
  const id = url.hostname === "youtu.be" ? path[0]
    : /^(?:(?:www|m)\.)?youtube\.com$/.test(url.hostname)
      ? url.searchParams.get("v") ?? (/^(?:shorts|embed|live)$/.test(path[0] ?? "") ? path[1] : undefined)
      : undefined;
  if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return { key: src, title: `YouTube · ${id}`, src, kind: "youtube", videoId: id };
  const ext = mediaExtension(url.pathname);
  const kind: Kind = /^(?:png|jpe?g|webp|gif)$/.test(ext) ? "image"
    : /^(?:webm|mp4|mov)$/.test(ext) ? "video" : /^(?:mp3|wav|m4a|ogg)$/.test(ext) ? "audio" : "link";
  let label = path.at(-1) ?? "";
  try { label = decodeURIComponent(label); } catch { /* Keep the escaped label. */ }
  return { key: src, title: label ? `${label} · ${url.hostname}` : url.hostname, src, kind };
}

export function AssetThumbnail({ asset }: { asset: PreviewAsset }) {
  const [failed, setFailed] = useState(false);
  const symbol = { image: ImageIcon, video: Film, audio: AudioLines, pdf: FileText, text: FileText, youtube: Play, link: Link2 }[asset.kind];
  const Icon = symbol;
  return <span className="studio-asset-thumb" aria-hidden="true">
    <Icon size={24} />
    {!failed && (asset.kind === "image" || asset.videoId) && <img alt="" loading="lazy" referrerPolicy="no-referrer"
      src={asset.videoId ? `https://i.ytimg.com/vi/${asset.videoId}/mqdefault.jpg` : asset.src} onError={() => setFailed(true)} />}
    {!failed && asset.kind === "video" && asset.download && <video muted playsInline preload="metadata" tabIndex={-1}
      src={`${asset.src}#t=0.1`} onError={() => setFailed(true)} />}
  </span>;
}

function DocumentPreview({ asset }: { asset: PreviewAsset }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    async function load() {
      const response = await fetch(asset.src, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable preview");
      if (asset.kind === "pdf") {
        const blob = await response.blob();
        if (await blob.slice(0, 5).text() !== "%PDF-") throw new Error("Invalid PDF");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setValue(objectUrl);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Unavailable preview");
      const decoder = new TextDecoder();
      let text = "";
      while (text.length < 12000) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      if (text.length >= 12000) void reader.cancel().catch(() => {});
      if (!controller.signal.aborted) setValue(text.slice(0, 12000) || "This file is empty.");
    }
    void load().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.kind, asset.src]);
  if (error) return <p role="status">Preview unavailable. Open or download the original file.</p>;
  if (!value) return <p role="status">Loading preview…</p>;
  return asset.kind === "pdf" ? <iframe title={asset.title} src={value} /> : <pre tabIndex={0}>{value}</pre>;
}

export function AssetPreview({ asset, onClose }: { asset: PreviewAsset; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [embed, setEmbed] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return <aside className="studio-asset-preview" ref={panel} tabIndex={-1} aria-label={`Preview of ${asset.title}`}
    onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <header><strong>{asset.title}</strong><button type="button" onClick={onClose} aria-label="Close asset preview"><X size={17} /></button></header>
    <div className="studio-asset-viewer">
      {!error && asset.kind === "image" && <img alt={asset.title} src={asset.src} referrerPolicy="no-referrer" onError={() => setError(true)} />}
      {!error && asset.kind === "video" && <video src={asset.src} controls playsInline preload="metadata" onError={() => setError(true)} aria-label={asset.title} />}
      {!error && asset.kind === "audio" && <audio src={asset.src} controls preload="metadata" onError={() => setError(true)} aria-label={asset.title} />}
      {(asset.kind === "pdf" || asset.kind === "text") && <DocumentPreview asset={asset} />}
      {asset.videoId && (embed ? <iframe title={asset.title} src={`https://www.youtube-nocookie.com/embed/${asset.videoId}`}
        referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        : <button type="button" className="studio-asset-embed" onClick={() => setEmbed(true)}>
          <AssetThumbnail asset={asset} /><Play size={16} /> Load YouTube player
        </button>)}
      {asset.kind === "link" && <p>Open this link to view the source.</p>}
      {error && <p role="status">This browser couldn’t preview the file. Open or download the original.</p>}
    </div>
    <footer>
      <a href={asset.src} target="_blank" rel="noreferrer">Open original <ExternalLink size={13} aria-hidden /></a>
      {asset.download && <a href={asset.download}>Download</a>}
    </footer>
  </aside>;
}
