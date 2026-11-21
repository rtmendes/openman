import { z } from "zod";
import { keywordEvidenceSchema, keywordIntent, type KeywordEvidence } from "./keyword-research";

const optionalText = z.string().nullish();
const number = z.number().nullish();
const resultItem = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: number }).nullish(),
  keyword_properties: z.object({ keyword_difficulty: number }).nullish(),
  search_intent_info: z.object({ main_intent: optionalText }).nullish(),
});
const dataForSeoResponse = z.object({
  status_code: z.number(),
  cost: z.number().nonnegative().optional(),
  tasks: z.array(z.object({
    status_code: z.number(),
    result: z.array(z.object({ items: z.array(resultItem).nullish() })).nullish(),
  })),
});

export function readDataForSeoKeywords(value: unknown, market: string, language: string, added: string) {
  const report = dataForSeoResponse.parse(value);
  const task = report.tasks[0];
  if (report.status_code !== 20000 || task?.status_code !== 20000) throw new Error("DataForSEO did not complete the lookup.");
  const rows: KeywordEvidence[] = (task.result ?? []).flatMap(({ items }) => (items ?? []).flatMap((item) => {
    const row = keywordEvidenceSchema.safeParse({
      term: item.keyword, market, language, added, provider: "DataForSEO",
      volume: item.keyword_info?.search_volume ?? undefined,
      difficulty: item.keyword_properties?.keyword_difficulty ?? undefined,
      intent: keywordIntent(item.search_intent_info?.main_intent ?? undefined),
    });
    return row.success ? [row.data] : [];
  }));
  return { rows, cost: report.cost };
}

const pageInfo = z.object({ current_page: z.number().int().positive(), last_page: z.number().int().nonnegative() }).optional();
const channel = z.object({
  id: z.number().int().positive(),
  yt_handle: optionalText,
  details: z.object({ title: optionalText }).nullish(),
});
const script = z.object({
  id: z.number().int().positive(),
  title: optionalText,
  topic: optionalText,
  has_script: z.boolean().optional(),
});
const envelope = <T extends z.ZodType>(shape: T) => z.object({ success: z.literal(true), data: shape, pagination: pageInfo });

export function readSubscribrChannels(value: unknown) {
  const page = envelope(z.array(channel)).parse(value);
  return { entries: page.data.map(({ id, yt_handle, details }) => ({ id, title: details?.title || yt_handle || `Channel ${id}` })),
    page: page.pagination?.current_page ?? 1, lastPage: Math.max(1, page.pagination?.last_page ?? 1) };
}
export function readSubscribrScripts(value: unknown) {
  const page = envelope(z.array(script)).parse(value);
  return { entries: page.data.map(({ id, title, topic, has_script }) => ({ id, title: title || topic || `Script ${id}`, hasScript: has_script })),
    page: page.pagination?.current_page ?? 1, lastPage: Math.max(1, page.pagination?.last_page ?? 1) };
}
export function readSubscribrNarration(value: unknown, id: number) {
  const { data } = envelope(z.object({ script_id: z.literal(id), script: z.string(), outline: z.string(),
    content_version: z.number().int().nonnegative() })).parse(value);
  return { id, script: data.script, outline: data.outline, version: data.content_version };
}
