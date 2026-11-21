"use client";

import { useState } from "react";
import { searchStudioTopic, type StudioResearchSource } from "@/lib/agent/client";

export function TopicResearch({ keyword, signedIn, savedLinks, onSave }: {
  keyword: string; signedIn: boolean; savedLinks: string[]; onSave: (url: string) => void;
}) {
  const [override, setOverride] = useState<string>();
  const [results, setResults] = useState<{ topic: string; sources: StudioResearchSource[] }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const topic = (override ?? keyword).trim();
  const encoded = encodeURIComponent(topic);
  return <details className="production-wide production-inputGroup">
    <summary>Research this topic</summary>
    <label>Public search phrase<input maxLength={180} value={override ?? keyword} onChange={(event) => {
      setOverride(event.target.value); setError("");
    }} /></label>
    {topic.length >= 2 && <div className="content-studio-runActions studio-search-links">
      <a href={`https://www.youtube.com/results?search_query=${encoded}`} target="_blank" rel="noreferrer">Search YouTube</a>
      <a href={`https://www.google.com/search?q=${encoded}`} target="_blank" rel="noreferrer">Search the web</a>
      <a href={`https://en.wikipedia.org/w/index.php?search=${encoded}`} target="_blank" rel="noreferrer">Open Wikipedia search</a>
    </div>}
    {signedIn && <div className="content-studio-runActions">
      <button type="button" disabled={pending || topic.length < 2} onClick={async () => {
        setPending(true);
        setError("");
        try { setResults({ topic, sources: (await searchStudioTopic(topic)).sources }); }
        catch (err) { setError(err instanceof Error ? err.message : "Search failed. Try again."); }
        finally { setPending(false); }
      }}>{pending ? "Searching Wikipedia…" : "Find background sources"}</button>
    </div>}
    <p className="production-hint">Wikipedia offers background and citations to follow. {signedIn && <a href="#studio-run-heading">Go to the YouTube performance scan</a>}</p>
    {error && <p role="alert">{error}</p>}
    {results?.topic === topic && (results.sources.length ? <ul className="studio-research-results">{results.sources.map((source) =>
      <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        {source.description && <small>{source.description}</small>}
        <button type="button" disabled={savedLinks.includes(source.url) || savedLinks.length >= 15} onClick={() => onSave(source.url)}>
          {savedLinks.includes(source.url) ? "Saved" : savedLinks.length >= 15 ? "Reference list full" : "Save to references"}
        </button></li>)}</ul>
      : <p role="status">No background sources found. Try a broader phrase.</p>)}
  </details>;
}
