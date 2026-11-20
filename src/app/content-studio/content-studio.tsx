// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Download, FileText, Film, Image, ListVideo, Search, Settings2, Smartphone, Sparkles, Globe2, Hash, ChevronDown, Play, Moon, Sun } from "lucide-react";
import { stashPrompt } from "@/components/composer/handoff";
import { APP_HOME } from "@/lib/supabase/config";
import { getSecondSpringContext } from "@/lib/agent/client";
import { examples, formats, makePrompt, platforms, runtimes, stages, type Brief } from "./workflow";
import { WorkflowRunner } from "./workflow-runner";
import { ProductionBatch } from "./production-batch";
import { ReferenceLibrary } from "./reference-library";
import "./studio.css";

const icons = [Settings2, Search, Image, ListVideo, Film, Smartphone, FileText];

const script = [
  ["0–5s", "Hold the TV remote up to your cheek.", "Hi, yes. I’d like to report a missing phone."],
  ["5–13s", "Wide shot. Your phone glows on the counter.", "I walked into the kitchen for my phone. Then I forgot why I was there and made toast."],
  ["13–23s", "Friend points at your phone. Slowly lower the remote.", "Oh. Well, at least somebody in this house knows what channel we’re on."],
  ["23–30s", "Take a bite of toast. Look straight at camera.", "If you’ve ever gone looking for one thing and come back with a snack, come sit by me."],
];

export function ContentStudio({ canLoadBrand = false, signedIn = false, draftKey }: { canLoadBrand?: boolean; signedIn?: boolean; draftKey?: string }) {
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
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState("");
  const [showScript, setShowScript] = useState(false);
  const [referenceIndex, setReferenceIndex] = useState(6);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const cached = localStorage.getItem("mahara:studio-theme");
        setTheme(cached === "dark" || (!cached && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
      } catch { /* Use the initial theme if settings storage is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const stage = stages[active];
  const ready = Boolean(brief.topic.trim() && brief.language.trim() && brief.platforms.length);
  const prompt = ready ? makePrompt(brief, active) : "";

  function update<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
    setFeedback("");
  }

  async function loadSecondSpring() {
    setBrandLoading(true);
    setBrandError("");
    try {
      const { registry, commandCenter, kits, assets } = await getSecondSpringContext();
      const context = [
        registry.voiceRules ? "Registry voice: " + registry.voiceRules : "",
        commandCenter.channels?.length ? "Command Center channels: " + commandCenter.channels.join(", ") : "",
        ...kits.flatMap((kit) => [kit.tone ? "Brand kit tone: " + kit.tone : "", ...(kit.do ?? []).map((rule) => "Do: " + rule), ...(kit["don’t"] ?? []).map((rule) => "Avoid: " + rule)]),
        assets.length ? "Brand asset references: " + assets.map(({ name, type }) => `${name} (${type})`).join(", ") : "",
      ].filter(Boolean).join("\n");
      setBrief((current) => ({
        ...current, topic: registry.name, audience: registry.audience ?? current.audience,
        format: "Comedy skit", runtimeSeconds: 30, platforms: ["Instagram", "TikTok"],
        brandContext: context,
      }));
      setActive(stages.length - 1);
      setShowScript(false);
      setFeedback("");
    } catch {
      setBrandError("Could not load Second Spring. Check your owner session and try again.");
    } finally {
      setBrandLoading(false);
    }
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

  function seeExample(index: number) {
    setReferenceIndex(index);
    document.getElementById("studio-reference")?.scrollIntoView({ block: "start" });
  }

  function openExampleWorkflow(index: number) {
    if (index === stages.length) {
      document.getElementById("video-production")?.scrollIntoView({ block: "start" });
      return;
    }
    selectStep(index);
    document.getElementById("stage-workbench")?.scrollIntoView({ block: "start" });
  }

  const StageIcon = icons[active];

  return (
    <main className="content-studio-studio" data-theme={theme}>
      <header className="content-studio-bar">
        <h1 className="content-studio-wordmark"><span><Clapperboard size={17} aria-hidden /></span> Content Studio</h1>
        <nav className="production-actions" aria-label="Studio pages">
          <button type="button" className="content-studio-back" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
            try { localStorage.setItem("mahara:studio-theme", next); } catch { /* Theme works for this visit. */ }
          }}>{theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}{theme === "dark" ? "Light" : "Dark"}</button>
          {canLoadBrand && <a href="#studio-reference" className="content-studio-back"><Play size={15} aria-hidden /> Examples</a>}
          <a href="#video-production" className="content-studio-back"><Film size={15} aria-hidden /> Video production</a>
          <Link href="/" className="content-studio-back"><ArrowLeft size={15} aria-hidden /> Home</Link>
        </nav>
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
          {canLoadBrand && <ReferenceLibrary selected={referenceIndex} onSelect={setReferenceIndex} onOpen={openExampleWorkflow} />}
          <ProductionBatch canLoadBrand={canLoadBrand} signedIn={signedIn} draftKey={draftKey}
            onExample={canLoadBrand ? () => seeExample(stages.length) : undefined} />
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

          {canLoadBrand && <section className="content-studio-pipeline" aria-labelledby="studio-brand">
            <div className="content-studio-pipelineHeader">
              <div>
                <h2 id="studio-brand">Brand context</h2>
                <p>{brief.brandContext ? "Second Spring loaded from the registry, Command Center, brand kit and asset library." : "Load Second Spring’s read-only context into your brief."}</p>
              </div>
              <button type="button" className="content-studio-runButton" disabled={brandLoading} onClick={loadSecondSpring}>
                {brandLoading ? "Loading…" : brief.brandContext ? "Refresh Second Spring" : "Load Second Spring"}
              </button>
            </div>
            {brandError && <p role="alert">{brandError}</p>}
            <details className="content-studio-runState">
              <summary>Preview Hostage Talks, 2 A.M.</summary>
              <p>30-second vertical animation · Narration and captions · Draft for review</p>
              <video controls playsInline preload="none" width={320} style={{ maxWidth: "100%", display: "block" }}
                aria-label="Hostage Talks, 2 A.M. animated draft" src="/api/admin/second-spring/video" />
            </details>
            {brief.brandContext && <div className="content-studio-runState">
              <div className="content-studio-runActions">
                <button type="button" onClick={() => setShowScript((visible) => !visible)} aria-expanded={showScript}>{showScript ? "Hide" : "Preview"} 30-second sample</button>
                <button type="button" onClick={() => { update("brandContext", undefined); setShowScript(false); }}>Remove brand context</button>
              </div>
              {showScript && <div className="content-studio-stageReview">
                <h3>I’d Like to Report a Missing Phone</h3>
                <p>Sample comedy skit · Estimated 30 seconds</p>
                <ol>{script.map(([time, action, line]) => <li key={time}><strong>{time}</strong> · {action} <q>{line}</q></li>)}</ol>
              </div>}
            </div>}
          </section>}

          <WorkflowRunner brief={brief} ready={ready} />

          <div id="stage-workbench" className="content-studio-editor">
            <section className="content-studio-document" aria-labelledby="output-heading">
              <div className="content-studio-documentHead">
                <div className="content-studio-documentLabel"><StageIcon size={17} aria-hidden /> Your brief</div>
                {ready && (
                  <div className="content-studio-tools">
                    <button type="button" onClick={copy}><Copy size={15} aria-hidden /> Copy</button>
                    <button type="button" onClick={download}><Download size={15} aria-hidden /> Export</button>
                    {canLoadBrand && <button type="button" onClick={() => seeExample(active)}><Play size={15} aria-hidden /> Example</button>}
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
                <label>Target runtime
                  <select value={brief.runtimeSeconds ?? ""} onChange={(event) => update("runtimeSeconds", event.target.value ? Number(event.target.value) : undefined)}>
                    {runtimes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
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
