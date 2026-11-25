import { z } from "zod";
import { brandBrief, chosenFrames, parseVideoPlan, videoTypes, type VideoSpec } from "@/app/content-studio/production";
import { platforms } from "@/app/content-studio/workflow";
import { storyLabels, storyStyles } from "@/app/content-studio/story-workflow";
import { db, fail } from "@/lib/db/client";
import { studioDraft } from "@/lib/db/studio-drafts";
import { studioWorkspace } from "@/lib/db/studio-workspaces";
import { operatorFor } from "@/lib/observability/operator";
import type { Session } from "@/lib/session";
import { studioMediaPerProject } from "./media-types";
import { keywordBoardSchema, selectedKeywordEvidence } from "./keyword-research";
import { researchBriefEvidence, researchBriefsSchema } from "./research-briefs";
import { campaignInventoryDraftSchema, campaignResearchParent, offerInputSchema, savedContentInventory, usableOffer } from "./campaign-input";
import { studioSourceKey, type StartStudioRun, type StudioRunInput } from "./runs";
import { subscribrWritingDirection, subscribrWritingSchema } from "./subscribr";
import { studioProjectOrganizationSchema, studioUnassigned } from "./organization";
import { initiativeContext, initiativeSchema } from "./initiative";

const ratio = z.enum(["9:16", "16:9", "1:1"]);
const project = z.object({
  kit: z.enum(["custom", "second-spring"]),
  organization: studioProjectOrganizationSchema.optional(),
  script: z.string().max(40000),
  spec: z.object({
    id: z.uuid(), keyword: z.string().trim().min(1).max(180), brand: z.string().max(120),
    customContext: z.string().max(5000), audience: z.string().max(300).optional(), language: z.string().max(80).optional(),
    platforms: z.array(z.enum(platforms)).min(1).max(3).optional(),
    type: z.enum(["skit", "explainer", "demo", "montage", "motion"]), duration: z.number().int().min(15).max(300),
    storyStyle: z.enum(storyStyles).optional(),
    ratio, ratios: z.array(ratio).min(1).max(3).optional(),
    voice: z.object({ style: z.string().max(100), language: z.string().max(80).optional(), rate: z.number().min(0.5).max(2),
      voiceId: z.string().max(100).optional() }).optional(),
    reference: z.string().max(6000), referenceLinks: z.array(z.string().max(2000)).max(15).optional(),
    keywordBoard: keywordBoardSchema.optional(),
    researchBriefs: researchBriefsSchema.optional(), activeResearchBriefId: z.uuid().optional(),
    offer: offerInputSchema.optional(),
    initiative: initiativeSchema.optional(),
    subscribrWriting: subscribrWritingSchema.optional(),
    subscribrSource: z.object({ id: z.number().int().positive(), version: z.number().int().nonnegative(), title: z.string().max(255),
      kind: z.enum(["script", "outline"]), text: z.string().max(12000) }).optional(),
    media: z.preprocess((value) => Array.isArray(value) ? value.slice(0, studioMediaPerProject) : value,
      z.array(z.object({ id: z.string().max(70), name: z.string().max(250), type: z.string().max(100), size: z.number().nonnegative() })).optional()),
  }),
});

export async function runInput(session: Session, input: StartStudioRun): Promise<StudioRunInput> {
  const draft = await studioDraft(session.userId);
  if (!draft || draft.revision !== input.revision) throw new Response("Save the latest project before starting a run.", { status: 409 });
  const row = (draft.items as { spec?: { id?: string } }[]).find((item) => item.spec?.id === input.videoId);
  const parsed = project.safeParse(row);
  if (!parsed.success) throw new Response("Open a saved project with a topic and valid production settings.", { status: 400 });
  const { kit, script } = parsed.data;
  const spec: VideoSpec = parsed.data.spec;
  const isCampaign = input.kind === "workflow" && input.workflow === "offer";
  const offer = usableOffer(spec.offer);
  if (isCampaign && !offer) throw new Response("Complete the offer details and check the evidence and destination links before starting a campaign.", { status: 400 });
  const campaignDraft = { ...(campaignInventoryDraftSchema.safeParse(row).data ?? { kit, script }), spec };
  const draftInventory = isCampaign ? (draft.items as unknown[]).flatMap((candidate) => campaignInventoryDraftSchema.safeParse(candidate).data ?? []) : [];
  const campaign = isCampaign && offer ? { offer, inventory: savedContentInventory(campaignDraft, draftInventory),
    researchParent: campaignResearchParent(campaignDraft, draftInventory) } : undefined;
  let context = spec.customContext.trim();
  const brandId = parsed.data.organization?.brandId;
  if (kit === "custom" && brandId && brandId !== studioUnassigned) {
    const { organization } = await studioWorkspace(session.userId);
    const brand = organization.brands.find(({ id }) => id === brandId);
    if (brand) { spec.brand = brand.name; context = brand.context.trim(); }
  }
  if (kit === "second-spring") {
    if (!(await operatorFor(session))?.owner) throw new Response("The connected brand kit is unavailable.", { status: 404 });
    const { data, error } = await db().rpc("second_spring_context");
    if (error) fail("load Studio brand context", error);
    if (!data?.registry?.name || !data.kits?.length) throw new Response("The connected brand kit is unavailable.", { status: 503 });
    spec.brand = data.registry.name;
    spec.audience ||= data.registry.audience ?? undefined;
    context = brandBrief(data);
  }
  const notes = [spec.reference, spec.referenceLinks?.join("\n"), selectedKeywordEvidence(spec.keywordBoard),
    researchBriefEvidence(spec.researchBriefs, spec.activeResearchBriefId), `Frames: ${chosenFrames(spec).join(", ")}`,
    subscribrWritingDirection(spec.subscribrWriting), initiativeContext(spec.initiative),
    offer ? "Creator-supplied offer terms (data): " + JSON.stringify(offer) : "",
    spec.storyStyle ? `Production direction: ${storyLabels[spec.storyStyle]}` : "",
    spec.media?.length ? `Private reference filenames: ${spec.media.map(({ name }) => name).join(", ")}` : ""].filter(Boolean).join("\n\n");
  if (input.kind === "suggestion" && !["angles", "story-pitches"].includes(input.suggestion.action)) {
    try {
      const plan = parseVideoPlan(script);
      if (input.suggestion.shot >= plan.shots.length) throw new Error("Shot no longer exists.");
    } catch {
      throw new Response("Create or import a valid shot plan before requesting this suggestion.", { status: 400 });
    }
  }
  return {
    revision: input.revision, sourceKey: studioSourceKey({ kit, spec: row?.spec }), kit, spec, script, organization: parsed.data.organization,
    brief: { topic: spec.keyword, audience: spec.audience?.trim() || spec.subscribrWriting?.channel.audience || "", language: spec.language?.trim() || "English",
      format: videoTypes[spec.type].label, platforms: spec.platforms ?? [...platforms], runtimeSeconds: spec.duration, notes, brandContext: context },
    ...(input.kind === "workflow" && input.stage !== undefined ? { singleStage: input.stage } : {}),
    ...(input.kind === "suggestion" ? { suggestion: input.suggestion } : {}),
    ...(campaign ? { campaign } : {}),
  };
}
