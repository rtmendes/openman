import { z } from "zod";
import { keywordTerms, researchUrl } from "./keyword-research";
import { researchBriefsSchema } from "./research-briefs";

const link = z.string().trim().max(600);
export const offerInputSchema = z.object({
  name: z.string().trim().max(120), deliverable: z.string().trim().max(450), audienceMoment: z.string().trim().max(400),
  proof: z.string().trim().max(600), proofUrl: link, action: z.string().trim().max(100), destination: link,
});
export type OfferInput = z.infer<typeof offerInputSchema>;
export const emptyOffer: OfferInput = { name: "", deliverable: "", audienceMoment: "", proof: "", proofUrl: "", action: "", destination: "" };
const requiredOffer = { name: "Offer name", deliverable: "What the offer includes", audienceMoment: "Audience situation", action: "Call to action" } as const;

export function missingOfferFields(offer?: OfferInput) {
  return Object.entries(requiredOffer).flatMap(([key, label]) => offer?.[key as keyof typeof requiredOffer].trim() ? [] : [label]);
}

export function usableOffer(input?: OfferInput) {
  const parsed = offerInputSchema.safeParse(input);
  return parsed.success && !missingOfferFields(parsed.data).length && (!parsed.data.proofUrl || parsed.data.proof) &&
    [parsed.data.proofUrl, parsed.data.destination].every((url) => !url || researchUrl(url)) ? parsed.data : undefined;
}

export const campaignInventoryDraftSchema = z.object({
  kit: z.enum(["custom", "second-spring"]), script: z.string(), variationOf: z.string().optional(),
  approved: z.unknown().optional(), renders: z.array(z.unknown()).optional(),
  spec: z.object({ id: z.uuid(), keyword: z.string(), brand: z.string().optional(), offer: offerInputSchema.optional(), researchBriefs: researchBriefsSchema.optional() }),
});
type InventoryDraft = z.infer<typeof campaignInventoryDraftSchema>;

export type InventoryEntry = {
  id: string; topic: string; offer?: string; status: "brief" | "script" | "approved" | "rendered";
  variations: number; matchesTopic: boolean;
};

const identity = (value?: string) => value?.normalize("NFKC").toLowerCase().trim() ?? "";

export function campaignResearchParent(target: InventoryDraft, drafts: InventoryDraft[]) {
  const parent = drafts.find(({ spec }) => spec.id === target.variationOf && spec.id !== target.spec.id);
  if (!parent || parent.kit !== target.kit || identity(parent.spec.brand) !== identity(target.spec.brand)) return undefined;
  const topic = identity(parent.spec.keyword);
  const variation = identity(target.spec.keyword);
  if (!topic || (variation !== topic && !variation.startsWith(`${topic} · `))) return undefined;
  return { videoId: parent.spec.id, topic: parent.spec.keyword.trim() };
}

export function savedContentInventory(target: InventoryDraft, drafts: InventoryDraft[]): InventoryEntry[] {
  const brand = identity(target.spec.brand);
  const root = target.variationOf ?? target.spec.id;
  const topics = [target.spec.keyword, ...(target.spec.researchBriefs ?? []).slice(0, 6).flatMap(({ terms }) => terms.slice(0, 4))];
  const terms = topics.map((topic) => new Set(keywordTerms(topic)));
  const candidates = drafts.filter((item) => item.spec.keyword.trim() && item.kit === target.kit &&
    (item.kit === "second-spring" || (brand ? identity(item.spec.brand) === brand : (item.variationOf ?? item.spec.id) === root)));
  const roots = new Map<string, InventoryDraft>();
  for (const item of candidates) {
    const id = item.variationOf ?? item.spec.id;
    if (!roots.has(id) || item.spec.id === id) roots.set(id, item);
  }
  return [...roots].map(([id, item]): InventoryEntry => {
    const words = keywordTerms(item.spec.keyword);
    const sameTopic = item.spec.id === target.spec.id || id === root || terms.some((term) => {
      const shared = words.filter((word) => term.has(word)).length;
      return shared > 0 && (shared === words.length && shared === term.size || shared >= 2 && shared / Math.max(words.length, term.size) >= 0.66);
    });
    return { id: item.spec.id, topic: item.spec.keyword.trim().slice(0, 180), offer: item.spec.offer?.name?.slice(0, 120),
      status: item.renders?.length ? "rendered" : item.approved ? "approved" : item.script.trim() ? "script" : "brief",
      variations: candidates.filter((row) => row.spec.id !== item.spec.id && (row.variationOf ?? row.spec.id) === id).length,
      matchesTopic: sameTopic };
  }).sort((a, b) => Number(b.matchesTopic) - Number(a.matchesTopic)).slice(0, 12);
}

export function inventoryRecommendation(entries: InventoryEntry[]) {
  const existing = entries.filter(({ matchesTopic }) => matchesTopic);
  if (existing.length > 1) return "Compare the overlapping projects and combine their strongest material in a new variation.";
  if (existing[0]?.status === "brief") return "Develop the existing brief before starting a second project on the same topic.";
  if (existing.length) return "Refresh the existing creative or give the next piece a different audience question.";
  return "This topic has no close match in the saved brand projects. Consider a new piece.";
}
