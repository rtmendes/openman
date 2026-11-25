import { z } from "zod";
import { researchUrl } from "./keyword-research";

export const initiativeSources = {
  audience: "Audience language",
  topic: "Topic research",
  format: "Creative reference",
  offer: "Offer reference",
} as const;

function sourceUrl(value: string) {
  const normalized = researchUrl(value);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  const keys = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  if (keys.some((key) => /token|api.?key|password|secret|signature|credential|^sig$|^key$|^x-amz|^x-goog/i.test(key))) return undefined;
  return normalized;
}

const sourceSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["audience", "topic", "format", "offer"]),
  label: z.string().max(120),
  note: z.string().max(900),
  url: z.string().max(600).refine((value) => !value.trim() || Boolean(sourceUrl(value)), "Use an HTTP or HTTPS reference without access credentials."),
});

const referenceSchema = z.object({
  offerId: z.string().regex(/^[a-f0-9]{8}$/),
  briefId: z.string().regex(/^[\w-]{8,100}$/),
  revision: z.number().int().positive(),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.enum(["draft", "review_ready"]),
});

export const initiativeSchema = z.object({
  name: z.string().max(120),
  objective: z.string().max(500),
  viewerMoment: z.string().max(800),
  objection: z.string().max(400),
  payoff: z.string().max(400),
  concept: z.string().max(1400),
  sources: z.array(sourceSchema).max(6).refine((rows) => new Set(rows.map(({ id }) => id)).size === rows.length),
  offerFactory: referenceSchema.optional(),
});
export type Initiative = z.infer<typeof initiativeSchema>;
export const emptyInitiative: Initiative = { name: "", objective: "", viewerMoment: "", objection: "", payoff: "", concept: "", sources: [] };

const offerFactoryBriefSchema = referenceSchema.omit({ sourceRevision: true }).extend({
  schema: z.literal("ofcampaignbriefv1"),
  brief: z.object({
    goal: z.string().max(500),
    buyer: z.string().max(800),
    approvedOfferURL: z.string().max(600).refine((value) => Boolean(sourceUrl(value))),
    proof: z.string().max(2400),
    creativeAssets: z.string().max(2400),
    budget: z.string().max(600),
  }),
  offerContract: z.object({
    schema: z.literal("offerfactory.offer-reference/1"),
    offerId: referenceSchema.shape.offerId,
    sourceRevision: referenceSchema.shape.sourceRevision.unwrap(),
  }).optional(),
}).refine(({ offerContract, offerId }) => !offerContract || offerContract.offerId === offerId);

export function readOfferFactoryBrief(text: string) {
  if (text.length > 12000) throw new Error("Use an Offer Factory campaign brief of up to 12,000 characters.");
  try {
    return offerFactoryBriefSchema.parse(JSON.parse(text));
  } catch {
    throw new Error("Use an exported Offer Factory campaign brief with a matching offer ID and a public offer link.");
  }
}

export function importOfferFactoryBrief(initiative: Initiative, packet: ReturnType<typeof readOfferFactoryBrief>, sourceId: string): Initiative {
  const { offerId, briefId, revision, status, offerContract, brief } = packet;
  const priorId = initiative.offerFactory?.offerId;
  const prior = initiative.sources.find(({ kind, label }) => kind === "offer" && label === `Offer Factory · ${priorId}`);
  const sources = initiative.sources.filter((source) => source.id !== prior?.id);
  if (sources.length >= 6) throw new Error("Remove an initiative source before importing this offer.");
  if (initiative.offerFactory?.briefId === briefId && initiative.offerFactory.revision > revision) {
    throw new Error("This brief predates the revision already saved in this project.");
  }
  return {
    ...initiative,
    objective: brief.goal,
    viewerMoment: brief.buyer,
    offerFactory: { offerId, briefId, revision, status, sourceRevision: offerContract?.sourceRevision },
    sources: [...sources, { id: prior?.id ?? sourceId, kind: "offer", label: `Offer Factory · ${offerId}`, note: "", url: brief.approvedOfferURL }],
  };
}

export function initiativeEvidence(initiative?: Initiative) {
  return (initiative?.sources ?? []).flatMap(({ id, kind, label, note, url }) => label.trim() && (note.trim() || sourceUrl(url))
    ? [{ id, kind: initiativeSources[kind], label: label.trim(), text: note.trim(), url: sourceUrl(url) }] : []);
}

export function initiativeContext(initiative?: Initiative) {
  if (!initiative) return "";
  const { name, objective, viewerMoment, objection, payoff, concept, offerFactory } = initiative;
  const evidence = initiativeEvidence(initiative);
  const data = { name, objective, viewerMoment, objection, payoff, concept, offerFactory, evidence: evidence.length ? evidence : undefined };
  if (!Object.values(data).some((value) => typeof value === "string" ? value.trim() : value)) return "";
  return "Initiative brief (source data): " + JSON.stringify(data) +
    "\nUse the viewer situation, objection, and payoff to choose language and visible action. Honor the selected concept when one is supplied. " +
    "Use research and creative examples for audience fit and execution. Use only explicitly supplied offer terms and proof for offer claims. Preserve qualifications and label any inference that needs review.";
}
