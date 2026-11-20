// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Download, FileText, Film, Image, ListVideo, Search, Settings2, Smartphone, Sparkles } from "lucide-react";
import { stashPrompt } from "@/components/composer/handoff";
import { APP_HOME } from "@/lib/supabase/config";
import { examples, formats, makePrompt, platforms, stages, type Brief } from "./workflow";
import styles from "./studio.module.css";

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
  const [active, setActive] = useState(0);
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
      setFeedback("Clipboard unavailable. Select the text in the agent brief to copy it.");
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

  return (
    <main className={`dark ${styles.studio}`}>
      <header className={styles.bar}>
        <span className={styles.wordmark}><Clapperboard size={19} aria-hidden /> Content Studio</span>
        <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden /> Home</Link>
      </header>

      <div className={styles.workspace}>
        <section className={styles.hero}>
          <div>
            <h1>Create content for <em>any niche.</em></h1>
            <p>Find what works, plan your edits, and turn an idea into your next video.</p>
          </div>
          <Clapperboard className={styles.heroArt} aria-hidden />
        </section>

        <div className={styles.grid}>
          <section className={styles.panel} aria-labelledby="brief-heading">
            <h2 id="brief-heading">Content brief</h2>
            <div className={styles.fields}>
              <label>Niche or topic
                <input value={brief.topic} onChange={(event) => update("topic", event.target.value)} maxLength={200} required />
              </label>
              <div className={styles.options} aria-label="Example topics" role="group">
                {examples.map((topic) => (
                  <button key={topic} type="button" aria-pressed={brief.topic === topic} onClick={() => update("topic", topic)}>{topic}</button>
                ))}
              </div>
              <label>Audience
                <input value={brief.audience} onChange={(event) => update("audience", event.target.value)} maxLength={300} placeholder="e.g. Beginners who want practical tips" />
              </label>
              <div className={styles.pair}>
                <label>Format
                  <select value={brief.format} onChange={(event) => update("format", event.target.value)}>
                    {formats.map((format) => <option key={format}>{format}</option>)}
                  </select>
                </label>
                <label>Language
                  <input value={brief.language} onChange={(event) => update("language", event.target.value)} maxLength={80} required />
                </label>
              </div>
              <fieldset>
                <legend>Platforms</legend>
                <div className={styles.options}>
                  {platforms.map((platform) => {
                    const selected = brief.platforms.includes(platform);
                    return <button key={platform} type="button" aria-pressed={selected} onClick={() => update("platforms", platforms.filter((item) => item === platform ? !selected : brief.platforms.includes(item)))}>{platform}</button>;
                  })}
                </div>
              </fieldset>
              <label>Source material and constraints
                <textarea value={brief.notes} onChange={(event) => update("notes", event.target.value)} rows={3} maxLength={4000} placeholder="Add reference links, footage notes, or topics to skip." />
              </label>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="workflow-heading">
            <h2 id="workflow-heading">Workflow</h2>
            <ol className={styles.steps}>
              {stages.map((item, index) => {
                const Icon = icons[index];
                return (
                  <li key={item.title}>
                    <button type="button" aria-current={active === index ? "step" : undefined} onClick={() => { setActive(index); setFeedback(""); }}>
                      <span className={styles.stepIcon}><Icon size={18} aria-hidden /></span>
                      <span><strong>{index + 1}. {item.title}</strong><small>{item.description}</small></span>
                      <ArrowRight className={styles.stepArrow} size={16} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <section className={styles.panel} aria-labelledby="output-heading">
          <div className={styles.outputHeader}>
            <div><h2 id="output-heading">Agent brief</h2><p>{stage.title} · {stage.output}</p></div>
            {ready && <div className={styles.actions}>
              <button type="button" onClick={copy}><Copy size={16} aria-hidden /> Copy</button>
              <button type="button" onClick={download}><Download size={16} aria-hidden /> Download</button>
              <button type="button" className={styles.primary} onClick={() => { stashPrompt(prompt); window.location.assign(APP_HOME); }}><Sparkles size={16} aria-hidden /> Open in agent</button>
            </div>}
          </div>
          {ready ? <textarea className={styles.preview} aria-label="Generated agent brief" readOnly value={prompt} rows={11} /> : <p>Enter a topic and language, and select at least one platform.</p>}
          <p className={styles.feedback} role="status">{feedback}</p>
        </section>
      </div>
    </main>
  );
}
