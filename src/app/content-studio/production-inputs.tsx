"use client";

import { Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { uploadStudioMedia } from "@/lib/agent/client";
import { mediaExtension, studioMediaLimit, studioMediaPerProject, studioMediaTypes, studioTextExtension } from "@/lib/studio/media-types";
import { AssetPreview, AssetThumbnail, attachmentAsset, linkAsset, referenceUrl } from "./asset-preview";
import type { VideoSpec } from "./production";

export function ReferenceInputs({ spec, cloud, onChange }: {
  spec: VideoSpec; cloud: boolean; onChange: (change: (current: VideoSpec) => Partial<VideoSpec>) => void;
}) {
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selection, setSelection] = useState("");
  const uploadLock = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const remaining = Math.max(0, studioMediaPerProject - (spec.media?.length ?? 0));
  const assets = [...(spec.media ?? []).map(attachmentAsset), ...(spec.referenceLinks ?? []).flatMap((link) => linkAsset(link) ?? [])];
  const selected = assets.find(({ key }) => key === selection);

  function closePreview() {
    setSelection("");
    opener.current?.focus();
  }

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
    if (uploadLock.current) return;
    if (cloud && !remaining) { setMessage(`This project has its ${studioMediaPerProject} private attachments. Remove a reference to make space.`); return; }
    uploadLock.current = true;
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
    uploadLock.current = false;
    setUploading(false);
    setMessage([uploaded ? `Saved ${uploaded} privately.` : "", ...errors].filter(Boolean).join(" "));
  }

  return <section id="studio-references" className="production-wide production-inputGroup studio-asset-section" aria-label="References and attachments">
    <details>
    <summary><Paperclip size={15} aria-hidden /> References and attachments{assets.length ? ` · ${assets.length}` : ""}</summary>
    <label>Notes<textarea rows={3} value={spec.reference} maxLength={6000} onChange={(event) => {
      const reference = event.target.value;
      onChange(() => ({ reference }));
    }} placeholder="Paste a transcript, a VIDEO.md excerpt, shot notes or timing cues." /></label>
    <div className="production-linkInput content-studio-runActions">
      <label>Reference links<textarea rows={2} inputMode="url" value={url} maxLength={6000} onChange={(event) => setUrl(event.target.value)}
        placeholder="Paste one or more URLs" /></label>
      <button type="button" onClick={() => addLinks(url)}>Add links</button>
    </div>
    <div className="production-drop" data-dragging={dragging} tabIndex={0} aria-label="Drop files or paste images here" onDragOver={(event) => {
      if (uploading || event.currentTarget.closest("fieldset:disabled")) return;
      event.preventDefault(); setDragging(true);
    }} onDragLeave={() => setDragging(false)} onDrop={(event) => {
      event.preventDefault(); setDragging(false);
      if (uploading || event.currentTarget.closest("fieldset:disabled")) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length) { void addFiles(files); return; }
      const dropped = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
      if (dropped.trim().split(/\s+/).every((entry) => referenceUrl(entry))) addLinks(dropped);
      else if (dropped) onChange((current) => ({ reference: [current.reference, dropped].filter(Boolean).join("\n\n").slice(0, 6000) }));
    }} onPaste={(event) => {
      if (uploading || event.currentTarget.closest("fieldset:disabled")) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); void addFiles(files); }
    }}>
      <label>Drop references, paste a screenshot or browse<input type="file" multiple disabled={uploading}
        accept={Object.keys(studioMediaTypes).map((extension) => `.${extension}`).join(",")}
        onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void addFiles(files); }} /></label>
      <p className="production-hint">Images, video, audio, PDFs, text, CSV, JSON and captions · Up to 50 MB each{cloud ? ` · ${remaining} attachment slots available` : ""}</p>
    </div>
    {uploading && <p role="status">Adding references…</p>}
    {message && <p role="status">{message}</p>}
    </details>
    {assets.length > 0 && <div className="studio-asset-layout" data-open={Boolean(selected)}>
      <ul className="studio-asset-grid" aria-label="Saved references">
        {assets.map((asset) => <li key={asset.key}>
          <button type="button" className="studio-asset-tile" aria-pressed={selection === asset.key} onClick={(event) => {
            opener.current = event.currentTarget;
            if (selection === asset.key) closePreview();
            else setSelection(asset.key);
          }}>
            <AssetThumbnail asset={asset} />
            <strong title={asset.title}>{asset.title}</strong>
          </button>
          <button type="button" className="studio-asset-remove" aria-label={`Remove ${asset.title} from draft`} onClick={() => {
            if (selection === asset.key) setSelection("");
            onChange((current) => asset.download
              ? { media: current.media?.filter(({ id }) => id !== asset.key) }
              : { referenceLinks: current.referenceLinks?.filter((item) => referenceUrl(item) !== asset.key) });
          }}><Trash2 size={14} /></button>
        </li>)}
      </ul>
      {selected && <AssetPreview key={selected.key} asset={selected} onClose={closePreview} />}
    </div>}
  </section>;
}
