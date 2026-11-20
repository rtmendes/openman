"use client";

import { useState } from "react";
import NextImage from "next/image";
import { ArrowRight, Download, Film, Play } from "lucide-react";
import examples from "./reference-examples.json";

const images = "/studio/reference";

export function ReferenceLibrary({ selected, onSelect, onOpen }: {
  selected: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const example = examples[selected] ?? examples[0];
  const poster = `${images}/${example.image}.jpg`;

  function download() {
    const url = URL.createObjectURL(new Blob([example.sample + "\n"], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = example.artifact;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section id="studio-reference" className="studio-reference" aria-labelledby="studio-reference-heading">
      <header className="studio-reference-hero">
        <NextImage src={`${images}/thermostat.jpg`} alt="" fill sizes="(max-width: 700px) 100vw, 1060px" priority />
        <div className="studio-reference-heroCopy">
          <p>Second Spring · Reference project</p>
          <h2 id="studio-reference-heading">See a video<br />take shape.</h2>
          <span>Follow <em>Hostage Talks, 2 A.M.</em> from a creative brief to a review-ready cut.</span>
        </div>
      </header>
      <div className="studio-reference-body">
        <nav className="studio-reference-nav" aria-label="Reference examples">
          {examples.map((item, index) => (
            <button type="button" key={item.id} aria-pressed={index === selected} onClick={() => { setPlaying(null); onSelect(index); }}>
              <Film size={15} aria-hidden /> {item.title}
            </button>
          ))}
        </nav>
        <div className="studio-reference-example" key={example.id}>
          <div className="studio-reference-player">
            {playing === example.id ? (
              <video controls autoPlay playsInline preload="metadata" poster={poster} aria-label={`${example.title} video walkthrough`}
                src={`/api/admin/second-spring/reference/${example.id}`} />
            ) : (
              <button className="studio-reference-play" type="button" onClick={() => setPlaying(example.id)}
                aria-label={`Play example for ${example.title}`}>
                <NextImage src={poster} alt="" fill sizes="(max-width: 760px) 100vw, 560px" />
                <span><Play size={20} fill="currentColor" aria-hidden /> Watch example</span>
              </button>
            )}
          </div>
          <div className="studio-reference-output">
            <h3>{example.title}</h3>
            <p>{example.lesson}</p>
            <details>
              <summary>View example output <span>{example.artifact}</span></summary>
              <pre>{example.sample}</pre>
              <button type="button" onClick={download}><Download size={15} aria-hidden /> Download example</button>
            </details>
            <button className="studio-reference-open" type="button" onClick={() => onOpen(selected)}>
              Open workflow <ArrowRight size={16} aria-hidden />
            </button>
            {playing === example.id && (
              <details className="studio-reference-transcript">
                <summary>Transcript</summary>
                <p>{example.narration}</p>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
