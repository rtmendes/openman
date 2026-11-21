import { z } from "zod";

export const thumbnailLooks = ["payoff", "reaction", "detail"] as const;
const option = z.object({
  title: z.string().trim().min(1).max(92),
  overlay: z.string().trim().min(1).max(28).refine((text) => {
    const words = text.split(/\s+/).length;
    return words >= 2 && words <= 4;
  }),
  look: z.enum(thumbnailLooks),
  composition: z.string().trim().min(1).max(320),
  reason: z.string().trim().min(1).max(220),
});
const packaging = z.object({
  patterns: z.string().trim().min(1).max(1800),
  options: z.tuple([option, option, option]),
  recommendation: z.number().int().min(1).max(3),
});
export type StudioPackaging = z.infer<typeof packaging>;
export type StudioThumbnail = z.infer<typeof option>;

export function readStudioPackaging(output: string): StudioPackaging {
  const trimmed = output.trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].at(-1)?.[1];
  const start = trimmed.search(/\{\s*"patterns"\s*:/);
  const json = fenced ?? (start > 0 ? trimmed.slice(start, trimmed.lastIndexOf("}") + 1) : trimmed);
  const result = packaging.parse(JSON.parse(json));
  if (new Set(result.options.map(({ title }) => title.toLowerCase())).size !== 3 ||
      new Set(result.options.map(({ look }) => look)).size !== 3) {
    throw new Error("Provide three distinct titles and one thumbnail for each composition.");
  }
  return result;
}
