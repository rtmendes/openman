"use client";

import { useState } from "react";
import { emptyInitiative, importOfferFactoryBrief, initiativeSources, readOfferFactoryBrief, type Initiative } from "@/lib/studio/initiative";
import type { OfferInput } from "@/lib/studio/campaign-input";
import { emptyOffer } from "@/lib/studio/campaign-input";

const fields = [
  { key: "name", label: "Initiative", limit: 120, placeholder: "e.g. Second Spring · Late-night humor series" },
  { key: "objective", label: "Campaign goal", limit: 500, placeholder: "What should the viewer understand or do after this video?" },
  { key: "viewerMoment", label: "Audience situation", limit: 800, placeholder: "What just happened in the viewer’s day, in their own words?" },
  { key: "objection", label: "Question or objection", limit: 400, placeholder: "What might make them scroll past or hesitate?" },
  { key: "payoff", label: "On-screen payoff", limit: 400, placeholder: "What action, object, or result can they actually see?" },
  { key: "concept", label: "Selected creative direction", limit: 1400, placeholder: "Describe the treatment or select an AI angle from the assistant." },
] as const;

export function InitiativeBrief({ value, offer, onChange, onImport }: {
  value?: Initiative;
  offer?: OfferInput;
  onChange: (initiative: Initiative) => void;
  onImport: (initiative: Initiative, offer: OfferInput) => void;
}) {
  const initiative = value ?? emptyInitiative;
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");

  function importBrief() {
    try {
      const packet = readOfferFactoryBrief(input);
      const next = importOfferFactoryBrief(initiative, packet, crypto.randomUUID());
      const existing = initiative.offerFactory?.offerId === packet.offerId ? offer ?? emptyOffer : emptyOffer;
      onImport(next, { ...existing, destination: packet.brief.approvedOfferURL });
      setInput("");
      setMessage("Imported the buyer context and destination. Confirm the offer terms, proof, and call to action below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The brief could not be imported.");
    }
  }

  return <section className="production-wide production-inputGroup studio-initiative">
    <h5>Initiative brief</h5>
    <div className="studio-offer-fields">
      {fields.map(({ key, label, limit, placeholder }) => <label key={key}>{label}
        <textarea rows={key === "name" ? 1 : 2} value={initiative[key]} maxLength={limit} placeholder={placeholder}
          onChange={(event) => onChange({ ...initiative, [key]: event.target.value })} />
      </label>)}
    </div>
    <details>
      <summary>Audience and topic sources{initiative.sources.length > 0 && ` · ${initiative.sources.length}`}</summary>
      {initiative.sources.map((source, index) => {
        const edit = (change: Partial<Initiative["sources"][number]>) => onChange({ ...initiative,
          sources: initiative.sources.map((row) => row.id === source.id ? { ...row, ...change } : row),
        });
        return <fieldset key={source.id} className="studio-offer-fields studio-initiative-source">
          <legend>Source {index + 1}</legend>
          <label>Type<select value={source.kind} onChange={(event) => edit({ kind: event.target.value as typeof source.kind })}>
            {Object.entries(initiativeSources).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select></label>
          <label>Source name<input value={source.label} maxLength={120} onChange={(event) => edit({ label: event.target.value })} /></label>
          <label>Public source link<input type="url" value={source.url} maxLength={600} onChange={(event) => edit({ url: event.target.value })} /></label>
          <label>What it tells us<textarea rows={2} value={source.note} maxLength={900} onChange={(event) => edit({ note: event.target.value })} /></label>
          <div className="content-studio-runActions"><button type="button" onClick={() => onChange({ ...initiative, sources: initiative.sources.filter(({ id }) => id !== source.id) })}>Remove source {index + 1}</button></div>
        </fieldset>;
      })}
      {initiative.sources.length < 6 && <button type="button" onClick={() => onChange({ ...initiative,
        sources: [...initiative.sources, { id: crypto.randomUUID(), kind: "audience", label: "", note: "", url: "" }],
      })}>Add source</button>}
    </details>
    <details>
      <summary>Import Offer Factory brief</summary>
      <label>Campaign brief JSON<textarea rows={3} value={input} maxLength={12000}
        onChange={(event) => { setInput(event.target.value); setMessage(""); }} /></label>
      <button type="button" onClick={importBrief} disabled={!input.trim()}>Import buyer context and destination</button>
      {message && <p role="status">{message}</p>}
    </details>
    {initiative.offerFactory && <p className="production-hint">Offer Factory · {initiative.offerFactory.offerId} · Brief revision {initiative.offerFactory.revision}</p>}
  </section>;
}
