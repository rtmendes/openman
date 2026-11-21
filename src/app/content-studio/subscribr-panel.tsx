"use client";

import { useState } from "react";
import { getSubscribrNarration, listSubscribrChannels, listSubscribrScripts, type SubscribrNarration } from "@/lib/agent/client";
import type { SubscribrSource } from "./production";

export function SubscribrPanel({ connected, current, onImport }: {
  connected: boolean; current?: SubscribrSource; onImport: (source: SubscribrSource) => void;
}) {
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listSubscribrChannels>>>();
  const [channel, setChannel] = useState(0);
  const [channelSearch, setChannelSearch] = useState("");
  const [usedChannelSearch, setUsedChannelSearch] = useState("");
  const [scripts, setScripts] = useState<Awaited<ReturnType<typeof listSubscribrScripts>>>();
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<(SubscribrNarration & { title: string })>();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");

  async function load(action: () => Promise<void>) {
    setPending(true);
    setStatus("");
    try { await action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not read Subscribr."); }
    finally { setPending(false); }
  }

  if (!connected && !current) return <details className="production-inputGroup">
    <summary>Use a Subscribr script</summary>
    <p className="production-hint">To read your existing scripts, connect a Subscribr API token with channel and script read access in the server configuration.</p>
    <a href="https://subscribr.ai/youtube-api/reference" target="_blank" rel="noreferrer">Subscribr API setup</a>
  </details>;

  return <details className="production-inputGroup">
    <summary>Use a Subscribr script</summary>
    {current && <p role="status">Saved as source material for this project · {current.title} · {current.kind} v{current.version}</p>}
    {connected && <fieldset disabled={pending} className="production-fields">
      <label>Filter Subscribr channels<input value={channelSearch} maxLength={180} onChange={(event) => setChannelSearch(event.target.value)} /></label>
      <div className="content-studio-runActions production-wide">
        <button type="button" onClick={() => void load(async () => {
          setChannels(await listSubscribrChannels(1, channelSearch));
          setUsedChannelSearch(channelSearch);
          setChannel(0); setScripts(undefined); setPreview(undefined);
        })}>Browse Subscribr channels</button>
      </div>
      {channels && <>
        <label>Subscribr channel<select value={channel} onChange={(event) => {
          setChannel(Number(event.target.value)); setScripts(undefined); setPreview(undefined);
        }}><option value={0}>Choose a channel</option>{channels.entries.map(({ id, title, scriptCount }) => <option key={id} value={id}>
          {title}{scriptCount === undefined ? "" : ` · ${scriptCount} scripts`}
        </option>)}</select></label>
        <div className="content-studio-runActions">
          {channels.page > 1 && <button type="button" onClick={() => void load(async () => setChannels(await listSubscribrChannels(channels.page - 1, usedChannelSearch)))}>Previous channels</button>}
          {channels.page < channels.lastPage && <button type="button" onClick={() => void load(async () => setChannels(await listSubscribrChannels(channels.page + 1, usedChannelSearch)))}>More channels</button>}
        </div>
      </>}
      {channels?.entries.length === 0 && <p>No channels match the filter.</p>}
      {channel > 0 && <div className="studio-keyword-inputs production-wide">
        <label>Filter scripts<input value={search} maxLength={180} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="content-studio-runActions"><button type="button" onClick={() => void load(async () => {
          setScripts(await listSubscribrScripts(channel, 1, search)); setPreview(undefined);
        })}>Find scripts</button></div>
      </div>}
      {scripts && <div className="production-wide">
        {scripts.entries.length === 0 && <p>No scripts match the search.</p>}
        <ul className="studio-research-results">{scripts.entries.map(({ id, title, hasScript }) => <li key={id}>
          <strong>{title}</strong><small>{hasScript === false ? "Draft or outline" : "Subscribr script"}</small>
          <button type="button" aria-label={`Preview Subscribr script: ${title}`} onClick={() => void load(async () => {
            setPreview({ ...await getSubscribrNarration(id), title });
          })}>Preview</button>
        </li>)}</ul>
        <div className="content-studio-runActions">
          {scripts.page > 1 && <button type="button" onClick={() => void load(async () =>
            setScripts(await listSubscribrScripts(channel, scripts.page - 1, search)))}>Previous scripts</button>}
          {scripts.page < scripts.lastPage && <button type="button" onClick={() => void load(async () =>
            setScripts(await listSubscribrScripts(channel, scripts.page + 1, search)))}>More scripts</button>}
        </div>
      </div>}
    </fieldset>}
    {preview && <div className="studio-keyword-pick">
      <strong>{preview.title}</strong>
      <pre className="studio-subscribr-text">{preview.script.trim() || preview.outline.trim() || "This item has no script or outline yet."}</pre>
      {Boolean(preview.script.trim() || preview.outline.trim()) && <div className="content-studio-runActions">
        <button type="button" onClick={() => {
          const body = preview.script.trim();
          const text = body || preview.outline.trim();
          onImport({ id: preview.id, version: preview.version, title: preview.title.slice(0, 255), kind: body ? "script" : "outline", text: text.slice(0, 12000) });
          setStatus(text.length > 12000 ? "Saved the first 12,000 characters as source material." : "Saved as source material for the next Studio script.");
        }}>Save to creative brief</button>
      </div>}
    </div>}
    {pending && <p role="status">Reading Subscribr…</p>}
    {status && <p role="status">{status}</p>}
  </details>;
}
