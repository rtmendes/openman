import { z } from "zod";
import { overlayPositions } from "@/app/content-studio/production";
import type { StageOutput } from "@/app/content-studio/pipeline";
import type { Brief } from "@/app/content-studio/workflow";
import type { VideoPlan, VideoSpec } from "@/app/content-studio/production";
import type { StudioPackaging } from "./packaging";

export const suggestionActions = {
  angles: "Suggest three distinct creative angles",
  "story-pitches": "Research-backed story pitches",
  hook: "Write three alternate opening hooks",
  narration: "Rewrite this narration",
  caption: "Write three social caption alternatives",
  visual: "Suggest alternate visual layouts",
  review: "Review this draft",
} as const;

const suggestion = z.object({
  action: z.enum(["angles", "story-pitches", "hook", "narration", "caption", "visual", "review"]),
  shot: z.number().int().min(0).max(23).default(0),
  direction: z.string().trim().max(500).default(""),
});

const request = z.object({ id: z.uuid(), videoId: z.uuid(), revision: z.number().int().positive() });
export const startStudioRunSchema = z.discriminatedUnion("kind", [
  request.extend({ kind: z.literal("workflow"), stage: z.number().int().min(0).max(6).optional() }),
  request.extend({ kind: z.literal("script") }),
  request.extend({ kind: z.literal("suggestion"), suggestion }),
]);
export const changeStudioRunSchema = z.object({
  id: z.uuid(), version: z.number().int().positive(), action: z.enum(["approve", "retry", "stop"]),
  notes: z.string().trim().max(1200).default(""),
});
export type StartStudioRun = z.infer<typeof startStudioRunSchema>;
export type ChangeStudioRun = z.infer<typeof changeStudioRunSchema>;
export type StudioSuggestion = z.infer<typeof suggestion>;

const alternativeSchema = z.object({
  label: z.string().trim().min(1).max(95),
  text: z.string().trim().min(1).max(700),
  reason: z.string().trim().min(1).max(360),
  overlay: z.string().trim().min(1).max(100).optional(),
  overlayPosition: z.enum(overlayPositions).optional(),
  location: z.string().trim().max(90).optional(),
  sourceToCheck: z.string().trim().min(1).max(400).optional(),
});
const suggestionsSchema = z.object({ alternatives: z.array(alternativeSchema).min(1).max(10) });
export type StudioAlternative = z.infer<typeof alternativeSchema>;

export function readStudioSuggestions(output: string, selection: StudioSuggestion) {
  const raw = output.trim();
  const json = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? raw;
  const { alternatives } = suggestionsSchema.parse(JSON.parse(json));
  if (selection.action === "story-pitches") {
    if (alternatives.length !== 10 || new Set(alternatives.map(({ label }) => label.toLowerCase())).size !== 10 ||
        alternatives.some(({ overlay, sourceToCheck }) => !overlay || overlay.length > 36 || !sourceToCheck)) {
      throw new Error("Provide ten distinct story pitches with thumbnail copy and a fact check or fiction note for each.");
    }
  } else if (alternatives.length > 5) {
    throw new Error("Provide up to five alternatives.");
  }
  if (["angles", "hook", "caption"].includes(selection.action) && alternatives.length !== 3) {
    throw new Error("Provide three alternatives.");
  }
  if (selection.action === "visual" && (alternatives.length < 2 || alternatives.some(({ text, overlay, overlayPosition }) => text.length > 450 || !overlay || !overlayPosition))) {
    throw new Error("Provide at least two layouts with visual direction and on-screen text.");
  }
  if (selection.action === "caption" && alternatives.some(({ text }) => text.length > 400)) {
    throw new Error("Each caption must be at most 400 characters.");
  }
  return alternatives;
}

export type StudioRunInput = {
  revision: number;
  sourceKey?: string;
  kit: "custom" | "second-spring";
  spec: VideoSpec;
  brief: Brief;
  script: string;
  singleStage?: number;
  suggestion?: StudioSuggestion;
};

export type StudioRunPhase = "queued" | "dispatching" | "running" | "waiting" | "review" | "blocked" | "complete" | "stopped";
export type StudioRunState = {
  stage: number;
  taskId?: string;
  startedAt?: string;
  outputs: StageOutput[];
  plan?: VideoPlan;
  alternatives?: StudioAlternative[];
  packaging?: StudioPackaging;
  message?: string;
  notes?: string;
};
export type StudioRun = {
  id: string;
  video_id: string;
  kind: StartStudioRun["kind"];
  phase: StudioRunPhase;
  version: number;
  input: StudioRunInput;
  state: StudioRunState;
  due_at: string;
  created_at: string;
  updated_at: string;
};

export const activeStudioPhases = ["queued", "dispatching", "running", "waiting"] as const;

export function isStudioRunActive(phase: StudioRunPhase) {
  return activeStudioPhases.some((entry) => entry === phase);
}

export function isStudioRunOpen(phase: StudioRunPhase) {
  return phase !== "complete" && phase !== "stopped";
}

type ProjectSource = { spec: unknown; kit: string; script: string };

/** Postgres JSONB and the editor can order the same object's fields differently. */
export function studioSourceKey(source: Pick<ProjectSource, "spec" | "kit">) {
  return JSON.stringify({ kit: source.kit, spec: source.spec }, (_key, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  });
}

export function matchesStudioSource(run: StudioRun, source: ProjectSource, savedRevision?: number) {
  if (!savedRevision || source.script !== run.input.script) return false;
  return run.input.sourceKey === undefined ? savedRevision === run.input.revision : run.input.sourceKey === studioSourceKey(source);
}
