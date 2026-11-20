"use client";

import { useEffect, useState } from "react";
import { studioMediaUrl, uploadStudioMedia } from "@/lib/agent/client";
import { mediaExtension, studioMediaLimit, studioMediaPerProject, studioMediaTypes, studioTextExtension } from "@/lib/studio/media-types";
import { voiceDirections, type VideoSpec } from "./production";

const defaultVoice: NonNullable<VideoSpec["voice"]> = { style: "Warm conversational", rate: 1 };

export function NarrationOptions({ voice, line, onChange }: {
  voice?: VideoSpec["voice"]; line?: string; onChange: (value: NonNullable<VideoSpec["voice"]>) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    const frame = requestAnimationFrame(load);
    synth.addEventListener("voiceschanged", load);
    return () => { cancelAnimationFrame(frame); synth.removeEventListener("voiceschanged", load); };
  }, []);
  const value = voice ?? defaultVoice;
  const availableVoice = voices.find(({ voiceURI }) => voiceURI === value.device);

  function audition() {
    const synth = window.speechSynthesis;
    if (!synth) { setMessage("This browser does not support voice previews."); return; }
    synth.cancel();
    const text = new SpeechSynthesisUtterance(line || "Here’s the opening line for your video. Let’s see how it sounds.");
    if (availableVoice) text.voice = availableVoice;
    if (value.language) text.lang = value.language;
    text.rate = value.rate;
    text.onend = () => setMessage("");
    text.onerror = (error) => setMessage(error.error === "interrupted" || error.error === "canceled" ? "" : "This device could not play the selected voice.");
    setMessage("Playing voice sample…");
    synth.speak(text);
  }

  return <details className="production-wide production-inputGroup">
    <summary>Narration and voice</summary>
    <div className="production-fields">
      <label>Delivery style<select value={value.style} onChange={(event) => onChange({ ...value, style: event.target.value })}>
        {voiceDirections.map((style) => <option key={style}>{style}</option>)}
      </select></label>
      <label>Device preview voice<select value={availableVoice?.voiceURI ?? ""} onChange={(event) => {
        const selected = voices.find(({ voiceURI }) => voiceURI === event.target.value);
        onChange({ ...value, device: selected?.voiceURI, language: selected?.lang || value.language });
      }}><option value="">Device default</option>{voices.map(({ voiceURI, name, lang }) =>
        <option key={voiceURI} value={voiceURI}>{name} · {lang}</option>)}</select></label>
      <label>Narration language<input value={value.language ?? ""} maxLength={60} placeholder="e.g. en-US" onChange={(event) => onChange({ ...value, language: event.target.value })} /></label>
      <label>Pace<select value={value.rate} onChange={(event) => onChange({ ...value, rate: Number(event.target.value) })}>
        <option value="0.85">Unhurried · 0.85×</option><option value="1">Natural · 1×</option><option value="1.1">Brisk · 1.1×</option>
      </select></label>
    </div>
    <div className="content-studio-runActions"><button type="button" onClick={audition}>Preview voice</button>
      <button type="button" onClick={() => { window.speechSynthesis?.cancel(); setMessage(""); }}>Stop audio</button></div>
    <p className="production-hint">Voice style and pace go into the production brief. Playback uses voices available on this device.</p>
    {message && <p role="status">{message}</p>}
  </details>;
}

function referenceUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && url.href.length <= 1500 ? url.href : null;
  } catch { return null; }
}

export function ReferenceInputs({ spec, cloud, onChange }: {
  spec: VideoSpec; cloud: boolean; onChange: (change: (current: VideoSpec) => Partial<VideoSpec>) => void;
}) {
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const remaining = Math.max(0, studioMediaPerProject - (spec.media?.length ?? 0));

  function addLinks(raw: string) {
    const links = raw.split(/[\s\n]+/).flatMap((line) => {
      const link = referenceUrl(line);
      return link ? [link] : [];
    });
    if (!links.length) { setMessage("Enter a valid HTTP or HTTPS link."); return; }
    onChange((current) => ({ referenceLinks: [...new Set([...(current.referenceLinks ?? []), ...links])].slice(0, 15) }));
    setUrl("");
    setMessage("");
  }

  async function addFiles(files: File[]) {
    if (cloud && !remaining) { setMessage(`This project has its ${studioMediaPerProject} private attachments. Remove a reference to make space.`); return; }
    setUploading(true);
    setMessage("");
    const errors: string[] = [];
    let uploaded = 0;
    const accepted = files.slice(0, cloud ? Math.min(remaining, 12) : 12);
    for (const file of accepted) {
      const type = mediaExtension(file.name);
      try {
        if (!Object.hasOwn(studioMediaTypes, type) || !file.size || file.size > studioMediaLimit) {
          throw new Error("Unsupported file or larger than 50 MB");
        }
        if (studioTextExtension.test(type)) {
          const excerpt = await file.slice(0, 7500).text();
          onChange((current) => ({ reference: [current.reference, `[${file.name}]\n${excerpt}`].filter(Boolean).join("\n\n").slice(0, 6000) }));
        }
        if (cloud) {
          const saved = await uploadStudioMedia(file);
          onChange((current) => ({ media: [...(current.media ?? []), saved] }));
          uploaded++;
        } else if (!studioTextExtension.test(type)) {
          throw new Error("Sign in to save this attachment");
        }
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
      }
    }
    if (accepted.length < files.length) errors.push(`${files.length - accepted.length} skipped. Add up to 12 files at a time${cloud ? ` and ${studioMediaPerProject} per project` : ""}.`);
    setUploading(false);
    setMessage([uploaded ? `Saved ${uploaded} privately.` : "", ...errors].filter(Boolean).join(" "));
  }

  return <details className="production-wide production-inputGroup">
    <summary>References and attachments{spec.media?.length ? ` · ${spec.media.length} files` : ""}</summary>
    <label>Notes<textarea rows={3} value={spec.reference} maxLength={6000} onChange={(event) => {
      const reference = event.target.value;
      onChange(() => ({ reference }));
    }} placeholder="Paste a transcript, a VIDEO.md excerpt, shot notes or timing cues." /></label>
    <div className="production-linkInput content-studio-runActions">
      <label>Reference links<input type="text" inputMode="url" value={url} maxLength={6000} onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLinks(url); } }} placeholder="Paste one or more URLs" /></label>
      <button type="button" onClick={() => addLinks(url)}>Add links</button>
    </div>
    {(spec.referenceLinks ?? []).map((link) => <div className="production-sourceLine" key={link}>
      <a href={link} target="_blank" rel="noreferrer">{link}</a>
      <button type="button" onClick={() => onChange((current) => ({ referenceLinks: current.referenceLinks?.filter((item) => item !== link) }))}>Remove</button>
    </div>)}
    <div className="production-drop" data-dragging={dragging} onDragOver={(event) => {
      if (uploading || event.currentTarget.closest("fieldset:disabled")) return;
      event.preventDefault(); setDragging(true);
    }} onDragLeave={() => setDragging(false)} onDrop={(event) => {
      event.preventDefault(); setDragging(false);
      if (uploading || event.currentTarget.closest("fieldset:disabled")) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length) { void addFiles(files); return; }
      const dropped = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
      if (referenceUrl(dropped)) addLinks(dropped);
      else if (dropped) onChange((current) => ({ reference: [current.reference, dropped].filter(Boolean).join("\n\n").slice(0, 6000) }));
    }}>
      <label>Drop references here or browse<input type="file" multiple disabled={uploading}
        accept={Object.keys(studioMediaTypes).map((extension) => `.${extension}`).join(",")}
        onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void addFiles(files); }} /></label>
      <p className="production-hint">Images, video, audio, PDFs, text, CSV, JSON and captions · Up to 50 MB each{cloud ? ` · ${remaining} attachment slots available` : ""}</p>
    </div>
    {uploading && <p role="status">Adding references…</p>}
    {message && <p role="status">{message}</p>}
    {(spec.media ?? []).map((asset) => <div className="production-sourceLine" key={asset.id}>
      <a href={studioMediaUrl(asset.id, true)}>{asset.name}</a>
      <button type="button" onClick={() => onChange((current) => ({ media: current.media?.filter(({ id }) => id !== asset.id) }))}>Remove from draft</button>
    </div>)}
  </details>;
}
