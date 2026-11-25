"use client";

import { useState } from "react";
import { getSubscribrChannelContext, getSubscribrNarration, listSubscribrChannels, listSubscribrScripts, type SubscribrNarration } from "@/lib/agent/client";
import { filterSubscribrChannels, type SubscribrChannelContext, type SubscribrChannelEntry, type SubscribrWriting } from "@/lib/studio/subscribr";
import type { SubscribrSource } from "./production";

export function SubscribrPanel({ connected, current, writing, locked, onImport, onWriting }: {
  connected: boolean; current?: SubscribrSource; writing?: SubscribrWriting; locked: boolean;
  onImport: (source?: SubscribrSource) => void; onWriting: (value?: SubscribrWriting) => void;
}) {
  const [channels, setChannels] = useState<SubscribrChannelEntry[]>();
  const [channel, setChannel] = useState(writing?.channel.id ?? 0);
  const [channelSearch, setChannelSearch] = useState("");
  const [context, setContext] = useState<SubscribrChannelContext>();
  const [voiceId, setVoiceId] = useState(0);
  const [templateId, setTemplateId] = useState(0);
  const [scripts, setScripts] = useState<Awaited<ReturnType<typeof listSubscribrScripts>>>();
  const [search, setSearch] = useState("");
  const [usedSearch, setUsedSearch] = useState("");
  const [preview, setPreview] = useState<(SubscribrNarration & { title: string })>();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const filtered = filterSubscribrChannels(channels ?? [], channelSearch);
  const selected = channels?.find(({ id }) => id === channel);
  const voice = context?.voices.find(({ id }) => id === voiceId);
  const template = context?.templates.find(({ id }) => id === templateId);

  async function load(action: () => Promise<void>) {
    setPending(true);
    setStatus("");
    try { await action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not read Subscribr."); }
    finally { setPending(false); }
  }

  function syncChannels() {
    void load(async () => {
      const synced = new Map<number, SubscribrChannelEntry>();
      for (let page = 1; page <= 1000; page++) {
        const result = await listSubscribrChannels(page);
        if (result.page !== page || result.lastPage > 1000) throw new Error("Subscribr returned an invalid channel page.");
        for (const entry of result.entries) synced.set(entry.id, entry);
        if (page >= result.lastPage) break;
      }
      setChannels([...synced.values()]);
    });
  }

  function loadContext(id: number) {
    void load(async () => {
      const result = await getSubscribrChannelContext(id);
      const saved = writing?.channel.id === id ? writing : undefined;
      setContext(result);
      setVoiceId(saved ? saved.voice?.id ?? 0 : result.defaultVoiceId ?? 0);
      setTemplateId(saved ? saved.template?.id ?? 0 : result.defaultTemplateId ?? 0);
    });
  }

  if (!connected && !current && !writing) return <details className="production-inputGroup">
    <summary>Write with Subscribr</summary>
    <p className="production-hint">Connect a Subscribr API token with channel and script read access to use its writing inputs.</p>
    <a href="https://subscribr.ai/youtube-api/reference" target="_blank" rel="noreferrer">Subscribr API setup</a>
  </details>;

  return <details className="production-inputGroup" onToggle={(event) => {
    if (event.currentTarget.open && connected && !channels && !pending && !locked && !status) syncChannels();
  }}>
    <summary>Write with Subscribr{writing ? ` · ${writing.channel.title}` : ""}</summary>
    {(writing || current) && <div className="studio-subscribr-saved">
      {writing && <div>
        <strong>Saved writing inputs</strong>
        <p>{[writing.channel.title, writing.voice?.name, writing.template?.name].filter(Boolean).join(" · ")}</p>
        <button type="button" disabled={locked} onClick={() => onWriting(undefined)}>Remove writing inputs</button>
      </div>}
      {current && <div>
        <strong>Saved source · {current.title}</strong>
        <p>{current.kind} v{current.version}</p>
        <button type="button" disabled={locked} onClick={() => onImport(undefined)}>Remove script source</button>
      </div>}
    </div>}
    {connected && <fieldset disabled={pending || locked} className="production-fields">
      <label>Filter Subscribr channels<input value={channelSearch} maxLength={180} placeholder="Search title or @handle"
        onChange={(event) => setChannelSearch(event.target.value)} /></label>
      <label>Subscribr channel<select value={selected ? channel : 0} onChange={(event) => {
        const id = Number(event.target.value);
        setChannel(id); setContext(undefined); setScripts(undefined); setPreview(undefined); setSearch(""); setStatus("");
        if (id) loadContext(id);
      }}><option value={0}>Choose a channel</option>
        {selected && !filtered.some(({ id }) => id === channel) && <option value={channel}>{selected.title} · Selected</option>}
        {filtered.map(({ id, title, handle, scriptCount }) => <option key={id} value={id}>
          {title}{handle ? ` · @${handle.replace(/^@/, "")}` : ""}{scriptCount === undefined ? "" : ` · ${scriptCount} scripts`}
        </option>)}</select></label>
      <div className="content-studio-runActions">
        <button type="button" onClick={syncChannels}>{channels ? "Refresh channels" : "Sync channels"}</button>
        {channelSearch && <button type="button" onClick={() => setChannelSearch("")}>Clear filter</button>}
      </div>
      {channels && <p className="production-wide production-hint" role="status">{filtered.length ? `${filtered.length} of ${channels.length} synced channels` : "No channels match the filter."}</p>}
      {selected && <>
        {!context && <div className="content-studio-runActions production-wide">
          <button type="button" onClick={() => loadContext(channel)}>Load writing inputs</button>
        </div>}
        {context && <div className="production-wide studio-subscribr-context">
          <h4>{context.channel.title}</h4>
          {context.channel.audience && <p><strong>Audience</strong> {context.channel.audience}</p>}
          {context.channel.description && <details><summary>Channel description</summary><p>{context.channel.description}</p></details>}
          <div className="production-fields">
            {context.voices.length > 0 && <label>Writing voice profile<select value={voiceId} onChange={(event) => setVoiceId(Number(event.target.value))}>
              <option value={0}>Use Mahara direction</option>
              {context.voices.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
            </select></label>}
            {context.templates.length > 0 && <label>Script template<select value={templateId} onChange={(event) => setTemplateId(Number(event.target.value))}>
              <option value={0}>Use Mahara structure</option>
              {context.templates.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
            </select></label>}
          </div>
          {voice?.instructions && <details><summary>Voice guidelines</summary><p>{voice.instructions}</p></details>}
          {template?.description && <p className="production-hint">{template.description}</p>}
          {context.unavailable.length > 0 && <p className="production-hint">
            Subscribr didn’t return {context.unavailable.map((kind) => `${kind}${context.readIssues?.[kind] ? ` (${context.readIssues[kind]})` : ""}`).join(" or ")}.
            {context.unavailable.includes("voices") && context.voices.length > 0 ? " The channel’s default profile is available." : ""}
          </p>}
          <div className="content-studio-runActions">
            <button type="button" onClick={() => {
              onWriting({ channel: context.channel, voice, template });
              setStatus("Saved for the next Studio script.");
            }}>Use in next script</button>
            <button type="button" onClick={() => loadContext(channel)}>Refresh writing inputs</button>
          </div>
          <p className="production-hint">Mahara writes the script using these inputs. Your Subscribr account stays read-only.</p>
        </div>}
        <div className="studio-keyword-inputs production-wide">
          <label>Filter scripts<input value={search} maxLength={180} placeholder="Search scripts by title" onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="content-studio-runActions"><button type="button" onClick={() => void load(async () => {
            setScripts(await listSubscribrScripts(channel, 1, search)); setUsedSearch(search); setPreview(undefined);
          })}>{search.trim() ? "Find scripts" : "Browse scripts"}</button></div>
        </div>
      </>}
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
            setScripts(await listSubscribrScripts(channel, scripts.page - 1, usedSearch)))}>Previous scripts</button>}
          {scripts.page < scripts.lastPage && <button type="button" onClick={() => void load(async () =>
            setScripts(await listSubscribrScripts(channel, scripts.page + 1, usedSearch)))}>More scripts</button>}
        </div>
      </div>}
    </fieldset>}
    {preview && <div className="studio-keyword-pick">
      <strong>{preview.title}</strong>
      <pre className="studio-subscribr-text">{preview.script.trim() || preview.outline.trim() || "This item has no script or outline yet."}</pre>
      {Boolean(preview.script.trim() || preview.outline.trim()) && <div className="content-studio-runActions">
        <button type="button" disabled={pending || locked} onClick={() => {
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
