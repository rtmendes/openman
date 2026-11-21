import { z } from "zod";
import { keywordEvidenceSchema, keywordIntent, type KeywordEvidence } from "./keyword-research";

const optionalText = z.string().nullish();
const number = z.number().nullish();
const resultItem = z.object({ keyword: z.string(), keyword_info: z.unknown(), keyword_properties: z.unknown(), search_intent_info: z.unknown() });
const dataForSeoResponse = z.object({
  status_code: z.number(),
  cost: z.number().nonnegative().optional(),
  tasks: z.array(z.object({
    status_code: z.number(),
    result: z.array(z.object({ items: z.array(z.unknown()).nullish() })).nullish(),
  })),
});

export function readDataForSeoKeywords(value: unknown, market: string, language: string, added: string) {
  const report = dataForSeoResponse.parse(value);
  const task = report.tasks[0];
  if (report.status_code !== 20000 || task?.status_code !== 20000) throw new Error("DataForSEO did not complete the lookup.");
  const rows: KeywordEvidence[] = (task.result ?? []).flatMap(({ items }) => (items ?? []).flatMap((entry) => {
    const item = resultItem.safeParse(entry);
    if (!item.success) return [];
    const row = keywordEvidenceSchema.safeParse({
      term: item.data.keyword, market, language, added, provider: "DataForSEO",
      volume: z.object({ search_volume: number }).safeParse(item.data.keyword_info).data?.search_volume ?? undefined,
      difficulty: z.object({ keyword_difficulty: number }).safeParse(item.data.keyword_properties).data?.keyword_difficulty ?? undefined,
      intent: keywordIntent(z.object({ main_intent: optionalText }).safeParse(item.data.search_intent_info).data?.main_intent ?? undefined),
    });
    return row.success ? [row.data] : [];
  }));
  return { rows, cost: report.cost };
}

const providerId = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().positive());
const pageInfo = z.object({ current_page: providerId, last_page: z.coerce.number().int().nonnegative() }).nullish();
const channel = z.object({
  id: providerId,
  yt_handle: optionalText,
  name: optionalText,
  title: optionalText,
  details: z.unknown(),
  scripts_count: z.coerce.number().int().nonnegative().nullish(),
});
const script = z.object({
  id: providerId,
  title: optionalText,
  topic: optionalText,
  has_script: z.boolean().nullish(),
});
const envelope = <T extends z.ZodType>(shape: T) => z.object({ success: z.literal(true).optional(), data: shape, pagination: pageInfo, meta: pageInfo });

export function readSubscribrChannels(value: unknown) {
  const page = envelope(z.array(channel)).parse(value);
  const pagination = page.pagination ?? page.meta;
  return { entries: page.data.map(({ id, yt_handle, details, name, title, scripts_count }) => ({
    id, title: z.object({ title: optionalText }).safeParse(details).data?.title || title || name || yt_handle || `Channel ${id}`, scriptCount: scripts_count ?? undefined,
  })), page: pagination?.current_page ?? 1, lastPage: Math.max(1, pagination?.last_page ?? 1) };
}
export function readSubscribrScripts(value: unknown) {
  const page = envelope(z.array(script)).parse(value);
  const pagination = page.pagination ?? page.meta;
  return { entries: page.data.map(({ id, title, topic, has_script }) => ({ id, title: title || topic || `Script ${id}`, hasScript: has_script ?? undefined })),
    page: pagination?.current_page ?? 1, lastPage: Math.max(1, pagination?.last_page ?? 1) };
}
export function readSubscribrNarration(value: unknown, id: number) {
  const { data } = envelope(z.object({ script_id: providerId.refine((value) => value === id), script: optionalText, outline: optionalText,
    content_version: z.number().int().nonnegative().nullish() })).parse(value);
  return { id, script: data.script ?? "", outline: data.outline ?? "", version: data.content_version ?? 0 };
}
