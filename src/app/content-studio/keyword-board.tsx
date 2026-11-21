"use client";

import { useEffect, useRef, useState } from "react";
import { lookupStudioKeywords, studioKeywordLookup } from "@/lib/agent/client";
import {
  importKeywordCsv, keywordBatchSize, keywordId, keywordLimit, keywordMarketNames, keywordObjectives, keywordProviders,
  rankKeywords, selectedKeywordEvidence, type KeywordBoard, type KeywordEvidence, type KeywordLookup,
} from "@/lib/studio/keyword-research";

const number = new Intl.NumberFormat();
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });
const display = (value?: number) => value === undefined ? "Unavailable" : number.format(value);

export function ResearchKeywordBoard({ videoId, topic, audience, value, onChange, dataForSeo }: {
  videoId: string; topic: string; audience: string; value: KeywordBoard;
  onChange: (patch: (board: KeywordBoard) => KeywordBoard) => void; dataForSeo: boolean;
}) {
  const [provider, setProvider] = useState<KeywordEvidence["provider"]>("LowFruits");
  const [market, setMarket] = useState("US");
  const [language, setLanguage] = useState("en");
  const [csvMarket, setCsvMarket] = useState("Unspecified");
  const [filter, setFilter] = useState("all");
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [visibleRows, setVisibleRows] = useState(12);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const seed = value.seed || topic;
  const ranked = rankKeywords(value.rows, seed, audience, value.objective);
  const filtered = ranked.filter(({ row }) => (filter === "all" || row.provider === filter) &&
    (!shortlistedOnly || value.shortlist.includes(keywordId(row))));
  const best = ranked.find(({ score }) => score >= 2);

  function addRows(rows: KeywordEvidence[]) {
    onChange((board) => {
      const merged = new Map(board.rows.map((row) => [keywordId(row), row]));
      for (const row of rows) {
        const id = keywordId(row);
        if (merged.has(id) || merged.size < keywordLimit) merged.set(id, row);
      }
      return { ...board, rows: [...merged.values()] };
    });
    setVisibleRows(12);
    setFilter("all");
  }

  async function waitForReport(start: () => Promise<KeywordLookup | null>) {
    if (activeRequest.current) return;
    const active = new AbortController();
    activeRequest.current = active;
    setStatus("Waiting for the provider. You can return to this project and open the latest report.");
    setPending(true);
    try {
      let lookup = await start();
      if (!lookup) {
        if (!active.signal.aborted) setStatus("No DataForSEO report has been saved for this project.");
        return;
      }
      while (!lookup.result && !active.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        if (active.signal.aborted) return;
        lookup = (await studioKeywordLookup(videoId, lookup.id)).lookup ?? lookup;
      }
      if (active.signal.aborted || !lookup.result) return;
      if ("error" in lookup.result) { setStatus(lookup.result.error); return; }
      const { rows, cost } = lookup.result;
      addRows(rows);
      setStatus(rows.length ? `DataForSEO returned ${rows.length} keywords${cost === undefined ? "." : ` · ${dollars.format(cost)} reported.`}`
        : "DataForSEO returned no keywords. Try a more specific seed.");
    } catch (error) {
      if (!active.signal.aborted) setStatus(error instanceof Error ? error.message : "Could not read the saved keyword lookup.");
    } finally {
      if (!active.signal.aborted) setPending(false);
      activeRequest.current = null;
    }
  }

  async function readFile(file: File) {
    try {
      if (file.size > 600_000) throw new Error("Export up to 600 KB of keyword rows at a time.");
      const buffer = await file.arrayBuffer();
      const encoding = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
      const text = new TextDecoder(encoding[0] === 255 && encoding[1] === 254 ? "utf-16le" :
        encoding[0] === 254 && encoding[1] === 255 ? "utf-16be" : "utf-8").decode(buffer);
      const date = new Date().toLocaleDateString("sv-SE");
      const { rows, skipped } = importKeywordCsv(text, provider, csvMarket, date);
      if (!rows.length) throw new Error("No keyword rows could be read. Check the export and try again.");
      addRows(rows);
      setStatus(`Read ${rows.length} rows from ${provider}.${skipped ? ` Skipped ${skipped} malformed rows.` : ""} This project holds up to ${keywordLimit} rows.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not read the file."); }
  }

  return <section className="studio-keyword-board" aria-label="Keyword opportunities">
    <div className="studio-keyword-inputs">
      <label>Search seed<input maxLength={180} value={value.seed} placeholder={topic || "Enter a broad or specific topic"} onChange={(event) => {
        const seed = event.target.value; onChange((board) => ({ ...board, seed }));
      }} /></label>
      <label>Content goal<select value={value.objective} onChange={(event) => {
        const objective = event.target.value as KeywordBoard["objective"];
        onChange((board) => ({ ...board, objective }));
      }}>{Object.entries(keywordObjectives).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
    </div>
    {dataForSeo && <div className="studio-keyword-inputs">
      <label>Google market<select value={market} onChange={(event) => setMarket(event.target.value)}>
        {Object.entries(keywordMarketNames).map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label>
      <label>Google language<select value={language} onChange={(event) => setLanguage(event.target.value)}>
        <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option></select></label>
      <div className="content-studio-runActions">
        <button type="button" disabled={pending || seed.trim().length < 2} onClick={() =>
          void waitForReport(() => lookupStudioKeywords(videoId, seed, market, language))
        }>{pending ? "Waiting for DataForSEO…" : "Get Google keyword data · about $0.015"}</button>
        <button type="button" disabled={pending} onClick={() =>
          void waitForReport(async () => (await studioKeywordLookup(videoId)).lookup)}>Open latest report</button>
        <small>One DataForSEO lookup, up to {keywordBatchSize} results.</small>
      </div>
    </div>}
    <details className="studio-keyword-import">
      <summary>Import keyword data</summary>
      <div className="studio-keyword-inputs">
        <label>Export source<select value={provider} onChange={(event) => setProvider(event.target.value as KeywordEvidence["provider"])}>
          {keywordProviders.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Export market<select value={csvMarket} onChange={(event) => setCsvMarket(event.target.value)}>
          <option>Unspecified</option>{Object.entries(keywordMarketNames).map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label>
        <label>Keyword export<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (file) void readFile(file);
        }} /></label>
      </div>
      <p className="production-hint">Import LowFruits, Semrush, Ahrefs, or DataForSEO exports. CSV and TSV stay private in this project.</p>
    </details>
    {status && <p role="status">{status}</p>}
    {value.rows.length > 0 && <>
      {best && <div className="studio-keyword-pick"><strong>Closest fit · {best.row.term}</strong><p>{best.reason}. {best.angle}</p></div>}
      <div className="studio-keyword-inputs">
        <label>Filter by source<select value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleRows(12); }}>
          <option value="all">All sources</option>{keywordProviders.filter((source) => value.rows.some(({ provider }) => provider === source))
            .map((source) => <option key={source}>{source}</option>)}</select></label>
        <label className="studio-keyword-check"><input type="checkbox" checked={shortlistedOnly} onChange={(event) => setShortlistedOnly(event.target.checked)} /> Shortlist only</label>
      </div>
      <div className="studio-keyword-scroll" role="region" tabIndex={0} aria-label="Keyword comparison table">
        <table>
          <thead><tr><th scope="col">Keyword and fit</th><th scope="col">Intent</th><th scope="col">Google searches / mo.</th><th scope="col">Difficulty</th><th scope="col">Source</th><th scope="col">Shortlist</th></tr></thead>
          <tbody>{filtered.slice(0, visibleRows).map(({ row, reason }) => {
            const id = keywordId(row);
            const chosen = value.shortlist.includes(id);
            return <tr key={id}>
              <th scope="row">{row.term}<small>{reason}</small></th>
              <td>{row.intent ?? "Unavailable"}</td>
              <td>{display(row.volume)}</td>
              <td>{row.difficulty === undefined ? "Unavailable" : row.provider === "LowFruits" ? `SD ${row.difficulty}` : `${row.difficulty}/100`}
                {row.weakSites !== undefined && <small>{row.weakSites} weak sites</small>}</td>
              <td>{row.provider}<small>{row.market}{row.language ? ` · ${row.language}` : ""} · added {row.added}</small></td>
              <td><button type="button" aria-label={(chosen ? "Remove from shortlist: " : "Shortlist: ") + row.term} aria-pressed={chosen}
                disabled={!chosen && value.shortlist.length >= 5} onClick={() => onChange((board) => ({
                  ...board, shortlist: board.shortlist.includes(id) ? board.shortlist.filter((entry) => entry !== id) : [...board.shortlist, id].slice(0, 5),
                }))}>{chosen ? "Selected" : "Select"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!filtered.length && <p role="status">No keywords match this filter.</p>}
      <p className="production-hint">Ranked by topic and audience word overlap, then goal fit. Search volume and difficulty use each provider’s own estimates.</p>
      <div className="content-studio-runActions">
        {visibleRows < filtered.length && <button type="button" onClick={() => setVisibleRows((n) => n + 12)}>Show more keywords</button>}
        {value.shortlist.length > 0 && <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(selectedKeywordEvidence(value)); setStatus("Copied the keyword shortlist."); }
          catch { setStatus("Could not copy the shortlist. Your selections are still saved."); }
        }}>Copy shortlist ({value.shortlist.length})</button>}
        {value.shortlist.length > 0 && <a href="#studio-assistant-heading">Use shortlist in AI suggestions</a>}
      </div>
    </>}
  </section>;
}
