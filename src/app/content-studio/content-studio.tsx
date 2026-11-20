// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Download, FileText, Film, Image, ListVideo, Search, Settings2, Smartphone, Sparkles, Globe2, Hash, ChevronDown, Play } from "lucide-react";
import { stashPrompt } from "@/components/composer/handoff";
import { APP_HOME } from "@/lib/supabase/config";
import { examples, formats, makePrompt, platforms, stages, type Brief } from "./workflow";
import "./studio.css";

const icons = [Settings2, Search, Image, ListVideo, Film, Smartphone, FileText];

export function ContentStudio() {
  const [brief, setBrief] = useState<Brief>({
    topic: "GTA 6",
    audience: "",
    language: "English",
    format: "Guide",
    platforms: [...platforms],
    notes: "",
  });
  const [active, setActive] = useState(stages.length - 1);
  const [feedback, setFeedback] = useState("");
  const stage = stages[active];
  const ready = Boolean(brief.topic.trim() && brief.language.trim() && brief.platforms.length);
  const prompt = ready ? makePrompt(brief, active) : "";

  function update<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
    setFeedback("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setFeedback("Agent brief copied.");
    } catch {
      setFeedback("Clipboard unavailable. Open “View full prompt” to copy the text.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content-studio-step-" + (active + 1) + ".md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectStep(index: number) {
    setActive(index);
    setFeedback("");
  }

  const StageIcon = icons[active];

  return (
    <main className="content-studio-studio">
      <header className="content-studio-bar">
        <h1 className="content-studio-wordmark"><span><Clapperboard size={17} aria-hidden /></span> Content Studio</h1>
        <Link href="/" className="content-studio-back"><ArrowLeft size={15} aria-hidden /> Home</Link>
      </header>

      <div className="content-studio-workspace">
        <nav className="content-studio-rail" aria-labelledby="workflow-heading">
          <h2 id="workflow-heading">Workflow</h2>
          <ol className="content-studio-steps">
            {stages.map((item, index) => {
              const Icon = icons[index];
              return (
                <li key={item.title}>
                  <button type="button" aria-current={active === index ? "step" : undefined} onClick={() => selectStep(index)}>
                    <Icon size={17} aria-hidden />
                    <span>{item.title}</span>
                    {active === index && <ArrowRight size={15} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <select className="content-studio-stepSelect" aria-labelledby="workflow-heading" value={active} onChange={(event) => selectStep(Number(event.target.value))}>
            {stages.map((item, index) => <option key={item.title} value={index}>{item.title}</option>)}
          </select>
        </nav>

        <div className="content-studio-main">
          <section className="content-studio-topic" aria-labelledby="topic-heading">
            <div className="content-studio-heroArt" aria-hidden="true"><span /><span /><div><Play size={38} fill="currentColor" /></div></div>
            <h2 id="topic-heading">What are you creating?</h2>
            <label htmlFor="studio-topic">Niche or topic</label>
            <div className="content-studio-topicField">
              <Hash size={25} aria-hidden />
              <input id="studio-topic" value={brief.topic} onChange={(event) => update("topic", event.target.value)} placeholder="Enter any topic" maxLength={200} required />
            </div>
            <div className="content-studio-examples" aria-label="Example topics" role="group">
              <span>Try</span>
              {examples.filter((topic) => topic !== brief.topic).map((topic) => (
                <button key={topic} type="button" onClick={() => update("topic", topic)}>{topic}</button>
              ))}
            </div>
          </section>

          <div className="content-studio-editor">
            <section className="content-studio-document" aria-labelledby="output-heading">
              <div className="content-studio-documentHead">
                <div className="content-studio-documentLabel"><StageIcon size={17} aria-hidden /> Your brief</div>
                {ready && (
                  <div className="content-studio-tools">
                    <button type="button" onClick={copy}><Copy size={15} aria-hidden /> Copy</button>
                    <button type="button" onClick={download}><Download size={15} aria-hidden /> Export</button>
                    <button type="button" className="content-studio-primary" onClick={() => { stashPrompt(prompt); window.location.assign(APP_HOME); }}><Sparkles size={15} aria-hidden /> Open in agent</button>
                  </div>
                )}
              </div>

              <div className="content-studio-paper">
                <h2 id="output-heading">{stage.title}</h2>
                <p className="content-studio-description">{stage.description}</p>
                {ready ? (
                  <div aria-label="Generated agent brief">
                    <ul className="content-studio-context">
                      <li>{brief.topic.trim()}</li>
                      <li>{brief.format}</li>
                      {brief.platforms.map((platform) => <li key={platform}>{platform}</li>)}
                      <li><Globe2 size={13} aria-hidden /> {brief.language.trim()}</li>
                    </ul>
                    <details className="content-studio-raw"><summary>Workflow instructions <ChevronDown size={14} aria-hidden /></summary>
                    <ol className="content-studio-instructions">{stage.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></details>
                    <div className="content-studio-deliverables">
                      <FileText size={17} aria-hidden />
                      <div><h3>Expected output</h3><p>{stage.output}</p></div>
                    </div>
                    <details className="content-studio-raw">
                      <summary>View full prompt <ChevronDown size={14} aria-hidden /></summary>
                      <pre>{prompt}</pre>
                    </details>
                  </div>
                ) : <p className="content-studio-empty">Enter a topic and language, and select a platform to build your brief.</p>}
              </div>

              <p className="content-studio-feedback" role="status">{feedback}</p>
            </section>

            <aside className="content-studio-settings" aria-labelledby="brief-heading">
              <h2 id="brief-heading"><Settings2 size={16} aria-hidden /> Personalize</h2>
              <div className="content-studio-fields">
                <label>Audience
                  <input value={brief.audience} onChange={(event) => update("audience", event.target.value)} maxLength={300} placeholder="e.g. First-time creators" />
                </label>
                <label>Format
                  <select value={brief.format} onChange={(event) => update("format", event.target.value)}>
                    {formats.map((format) => <option key={format}>{format}</option>)}
                  </select>
                </label>
                <label>Language
                  <input value={brief.language} onChange={(event) => update("language", event.target.value)} maxLength={80} required />
                </label>
                <fieldset>
                  <legend>Platforms</legend>
                  <div className="content-studio-platforms">
                    {platforms.map((platform) => {
                      const selected = brief.platforms.includes(platform);
                      return (
                        <label key={platform}>
                          <input type="checkbox" checked={selected} onChange={() => update("platforms", platforms.filter((item) => item === platform ? !selected : brief.platforms.includes(item)))} />
                          {platform}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label>References &amp; constraints
                  <textarea value={brief.notes} onChange={(event) => update("notes", event.target.value)} rows={3} maxLength={4000} placeholder="Links, footage notes, or topics to skip" />
                </label>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

