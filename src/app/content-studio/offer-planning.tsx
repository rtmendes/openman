"use client";

import { emptyOffer, inventoryRecommendation, type InventoryEntry, type OfferInput } from "@/lib/studio/campaign-input";
import { campaignEvidence, campaignReviewNeedsChanges, offerStages } from "@/lib/studio/campaign-workflow";
import type { StudioRun } from "@/lib/studio/runs";

const audiences = { discover: "Discovery", consider: "Consideration", act: "Action" } as const;
const status = { brief: "Brief", script: "Script", approved: "Approved", rendered: "Rendered" } as const;
const offerFields = [
  { key: "name", label: "Offer name", max: 120, placeholder: "Name as it appears on the offer" },
  { key: "deliverable", label: "What the offer includes", max: 450, placeholder: "List what buyers receive and any eligibility or terms the creative can mention.", long: true },
  { key: "audienceMoment", label: "Audience situation", max: 400, placeholder: "Describe the moment they need help and what they’ve tried or hesitated over.", long: true },
  { key: "action", label: "Call to action", max: 100, placeholder: "Write one action exactly as you want the viewer to hear it." },
  { key: "destination", label: "Destination link (optional)", max: 600, placeholder: "https://…" },
  { key: "proof", label: "Proof and claims you can support (optional)", max: 600, placeholder: "Quote only evidence you can use. Include limits and qualifications.", long: true },
  { key: "proofUrl", label: "Link to supporting evidence (optional)", max: 600, placeholder: "https://…" },
] as const;

export function OfferPlanning({ value, inventory, canDispatch, onChange }: {
  value?: OfferInput; inventory: InventoryEntry[]; canDispatch: boolean; onChange: (offer: OfferInput) => void;
}) {
  const offer = value ?? emptyOffer;
  return <details id="studio-offer-planning" className="production-wide production-inputGroup">
    <summary>Offer and editorial planning</summary>
    <div className="studio-research-briefs">
      <p className="production-hint">Give the campaign the facts it can use. Keep proof blank when the creative should show only the offer or audience experience.</p>
      <div className="studio-offer-fields">{offerFields.map((field) => <label key={field.key}>
        {field.label}{"long" in field ? <textarea value={offer[field.key]} maxLength={field.max} rows={3} placeholder={field.placeholder}
          onChange={(event) => onChange({ ...offer, [field.key]: event.target.value })} />
          : <input value={offer[field.key]} maxLength={field.max} placeholder={field.placeholder}
            onChange={(event) => onChange({ ...offer, [field.key]: event.target.value })} />}
      </label>)}</div>
      <section aria-label="Saved content inventory">
        <h4>Saved content inventory</h4>
        <p>{inventoryRecommendation(inventory)}</p>
        {inventory.length > 0 && <div className="studio-keyword-scroll" role="region" tabIndex={0} aria-label="Saved brand projects">
          <table><thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Topic match</th></tr></thead>
            <tbody>{inventory.map((item) => <tr key={item.id}>
              <th scope="row">{item.topic}{item.offer && <small>{item.offer}</small>}</th>
              <td>{status[item.status]}{item.variations > 0 && <small>{item.variations} {item.variations === 1 ? "variation" : "variations"}</small>}</td>
              <td>{item.matchesTopic ? "Related" : "Other topic"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      <details>
        <summary>Read the offer campaign SOP</summary>
        {offerStages.map((stage) => <div key={stage.title}><h5>{stage.title}</h5><ol>{stage.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></div>)}
      </details>
      {canDispatch && <a href="#studio-offer-run-heading">Go to offer campaign controls</a>}
    </div>
  </details>;
}

export function OfferCampaignResult({ run }: { run: StudioRun }) {
  const output = run.state.campaign;
  if (!output?.strategy) return null;
  const evidence = campaignEvidence(run);
  return <section aria-label="Editorial plan and creatives" className="studio-research-groups">
    <h4>{output.strategy.series}</h4>
    <p className="production-hint">{run.input.campaign?.offer.name} · Saved revision {run.input.revision}</p>
    {run.input.campaign?.researchOrigin && <p className="production-hint">Uses the approved scan from {run.input.campaign.researchOrigin}.</p>}
    <p>{output.strategy.objective}</p>
    {output.strategy.slots.map((slot) => {
      const creative = output.creatives?.find(({ intent }) => intent === slot.intent);
      const review = output.review?.find(({ intent }) => intent === slot.intent);
      return <details className="studio-result-option" key={slot.intent}>
        <summary>{audiences[slot.intent]} · {slot.topic}</summary>
        <p>{slot.placement} · <strong>{slot.decision[0].toUpperCase() + slot.decision.slice(1)}</strong></p>
        <dl className="studio-offer-handoff">
          <dt>Audience question</dt><dd>{slot.audienceQuestion}</dd>
          <dt>Why this piece</dt><dd>{slot.rationale}</dd>
          {slot.projectIds.length > 0 && <><dt>Saved projects</dt><dd>{slot.projectIds.map((id) => run.input.campaign?.inventory.find((item) => item.id === id)?.topic).filter(Boolean).join(", ")}</dd></>}
          <dt>Payoff</dt><dd>{slot.payoff}</dd>
          <dt>Next step</dt><dd>{slot.nextStep}</dd>
          <dt>What to verify</dt><dd>{slot.assumption}</dd>
          {slot.evidence.length > 0 && <><dt>Evidence</dt><dd><ul>{slot.evidence.map((id) => {
            const item = evidence.find((entry) => entry.id === id);
            return item && <li key={id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> : item.label}</li>;
          })}</ul></dd></>}
        </dl>
        {creative && <details className="studio-keyword-import"><summary>{creative.plan.title} · {run.input.spec.duration}s</summary>
          <dl className="studio-offer-handoff"><dt>Treatment</dt><dd>{creative.treatment}</dd><dt>First frame</dt><dd>{creative.firstFrame}</dd>
            <dt>Thumbnail</dt><dd>{creative.thumbnail} · {creative.thumbnailDirection}</dd>
            <dt>Title options</dt><dd>{creative.plan.titleOptions?.join(" · ")}</dd>
            <dt>Caption</dt><dd>{creative.plan.caption}</dd><dt>Description</dt><dd>{creative.plan.description}</dd>
            {creative.assumptions.length > 0 && <><dt>Production assumptions</dt><dd>{creative.assumptions.join(" · ")}</dd></>}
          </dl>
          <ol>{creative.plan.shots.map((shot, index) => <li key={shot.end}>
            <strong>{index ? creative.plan.shots[index - 1].end : 0}–{shot.end}s</strong> {shot.narration || "No narration"}
            <p>{shot.visual} · Overlay {shot.overlay} · Sound {shot.sound} · Asset {shot.asset}</p>
          </li>)}</ol>
        </details>}
        {review && <div className="studio-keyword-pick">
          <strong>{campaignReviewNeedsChanges(review) ? "Changes needed" : "Passed creative review"}</strong><p>{review.note}</p>
          <p className="production-hint">Opening {review.opening}/5 · Brand {review.brandFit}/5 · Proof {review.proof}/5 · Feasibility {review.feasibility}/5 · Action {review.action}/5</p>
          {review.blockers.length > 0 && <ul>{review.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
        </div>}
      </details>;
    })}
  </section>;
}
