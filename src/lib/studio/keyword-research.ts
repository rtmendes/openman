import { z } from "zod";

export const keywordProviders = ["DataForSEO", "LowFruits", "Semrush", "Ahrefs"] as const;
export const keywordMarkets = { US: 2840, GB: 2826, CA: 2124, AU: 2036 } as const;
export const keywordMarketNames = { US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia" } as const;
export const keywordLimit = 80;
export const keywordBatchSize = 24;
const objectives = ["answer", "relate", "compare", "demonstrate"] as const;
export type KeywordObjective = typeof objectives[number];
export const keywordObjectives: Record<KeywordObjective, string> = {
  answer: "Answer audience questions", relate: "Find relatable situations", compare: "Compare options", demonstrate: "Show a result",
};

const indexedNumber = z.number().int().nonnegative().max(100);
export const keywordEvidenceSchema = z.object({
  term: z.string().trim().min(1).max(180),
  provider: z.enum(keywordProviders),
  market: z.string().trim().min(1).max(40),
  language: z.string().trim().min(1).max(25).optional(),
  volume: z.number().int().nonnegative().max(1_000_000_000).optional(),
  difficulty: indexedNumber.optional(),
  weakSites: indexedNumber.optional(),
  intent: z.enum(["informational", "commercial", "transactional", "navigational"]).optional(),
  added: z.string().date(),
});
export const keywordBoardSchema = z.object({
  seed: z.string().trim().max(180),
  objective: z.enum(objectives),
  rows: z.array(keywordEvidenceSchema).max(keywordLimit),
  shortlist: z.array(z.string().max(480)).max(5),
});
export type KeywordEvidence = z.infer<typeof keywordEvidenceSchema>;
export type KeywordBoard = z.infer<typeof keywordBoardSchema>;
export type KeywordLookup = {
  id: string; seed: string; market: string; language: string; requestedAt: number;
  result?: { rows: KeywordEvidence[]; cost?: number } | { error: string };
};

export const keywordId = (row: KeywordEvidence) => JSON.stringify([row.provider, row.market, row.language ?? "", row.term.toLowerCase()]);

export function readKeywordDelimitedRows(csv: string) {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const header = text.trimStart().split("\n", 1)[0];
  const delimiter = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i] ?? "\n";
    if (char === '"' && (quoted || !field.length)) {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === "\n")) {
      record.push(field.trim());
      field = "";
      if (char === "\n") {
        if (record.some(Boolean)) records.push(record);
        record = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("The export has an unclosed quoted field.");
  return records;
}

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

export function keywordIntent(raw?: string) {
  const match = raw?.toLowerCase().trim().match(/^(informational|navigational|commercial|transactional|i|n|c|t)(?=[,;|\s]|$)/)?.[1];
  return match ? keywordEvidenceSchema.shape.intent.safeParse(({ i: "informational", n: "navigational", c: "commercial", t: "transactional" } as Record<string, string>)[match] ?? match).data : undefined;
}

export function importKeywordCsv(csv: string, provider: KeywordEvidence["provider"], market: string, added: string) {
  const [header, ...records] = readKeywordDelimitedRows(csv);
  if (!header) throw new Error("The export is empty.");
  const columns = header.map(headerKey);
  const column = (...choices: string[]) => choices.map((choice) => columns.indexOf(choice)).find((i) => i !== -1) ?? -1;
  const term = column("keyword", "keywords", "kw", "term", "query", "ph");
  const volume = column("volume", "searchvolume", "monthlyvolume", "monthlysearchvolume", "avgmonthlysearches", "nq");
  const difficulty = provider === "LowFruits" ? column("sd", "serpdifficulty", "serpdifficultyscore", "serpscore") : column("keyworddifficulty", "keyworddifficultypercent", "difficulty", "kd");
  const weak = column("weakwebsites", "weakspots", "weakdomains", "weakwebsitescount", "weakspotscount");
  const intent = column("intent", "intents", "searchintent", "in");
  if (term === -1) throw new Error("Include a Keyword, Term, or Query column in the export.");
  const readNumber = (value?: string) => {
    const clean = value?.replace(/[,%\s]/g, "");
    return clean && /^\d+(\.\d+)?$/.test(clean) ? Math.round(Number(clean)) : undefined;
  };
  const rows = records.flatMap((record) => {
    if (record.length !== columns.length || !record[term]) return [];
    const row = keywordEvidenceSchema.safeParse({
      term: record[term], provider, market, added, volume: readNumber(record[volume]),
      difficulty: readNumber(record[difficulty]), weakSites: provider === "LowFruits" ? readNumber(record[weak]) : undefined,
      intent: keywordIntent(record[intent]),
    });
    return row.success ? [row.data] : [];
  });
  return { rows, skipped: records.length - rows.length };
}

const stopWords = new Set(["a", "an", "the", "is", "for", "to", "how", "what", "my", "in", "at", "and", "about", "can", "do", "you", "of", "it"]);
function terms(text: string) {
  return [...new Set((normalized(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !stopWords.has(t)))];
}

export function rankKeywords(rows: KeywordEvidence[], seed: string, audience: string, objective: KeywordObjective) {
  const topic = terms(seed);
  const audienceTerms = terms(audience);
  return rows.map((row) => {
    const words = terms(row.term);
    const topicMatches = topic.filter((t) => words.includes(t));
    const audienceMatches = audienceTerms.filter((t) => words.includes(t));
    const question = /^(how|why|what|when|can|does|is)\b|\?$/i.test(row.term);
    const comparison = /\b(vs\.?|versus|best|review|alternatives|comparison)\b/i.test(row.term);
    const useCase = /\b(example|demo|steps?|tutorial|checklist|setup)\b/i.test(row.term);
    const objectiveFit = { answer: question || row.intent === "informational", relate: audienceMatches.length > 0,
      compare: comparison || row.intent === "commercial", demonstrate: useCase || /^how\b/i.test(row.term) }[objective];
    const score = 10 * topicMatches.length / Math.max(1, topic.length) + (audienceMatches.length ? 2 : 0) + (objectiveFit ? 1.5 : 0);
    const reason = topicMatches.length ? `Matches ${topicMatches.slice(0, 3).join(", ")}` : "Adjacent idea · check fit";
    const angle = objective === "relate" ? "Build a skit around the situation a viewer recognizes."
      : objective === "compare" ? "Compare the options with one concrete example for each."
        : objective === "demonstrate" ? "Show one visible result, then walk through the steps."
          : "Answer the question upfront, then illustrate it with one example.";
    return { row, score, reason, angle };
  }).sort((a, b) => b.score - a.score || a.row.term.localeCompare(b.row.term));
}

export function selectedKeywordEvidence(board?: KeywordBoard) {
  if (!board?.shortlist.length) return "";
  const rows = board.shortlist.flatMap((id) => {
    const row = board.rows.find((candidate) => keywordId(candidate) === id);
    return row ? [row] : [];
  });
  if (!rows.length) return "";
  return `Creator-selected keyword evidence (Google, provider estimates). Purpose: ${keywordObjectives[board.objective]}. Use terms only where they fit the audience. These figures do not measure YouTube demand or verify factual claims. ${JSON.stringify(rows)}`;
}

export function suggestedSearches(topic: string, objective: KeywordObjective, language?: string) {
  const seed = topic.trim();
  if (seed.length < 2) return [];
  if (language && !/^(english|en)(\b|-)/i.test(language.trim())) return [seed];
  const refinements = {
    answer: ["questions", "explained", "common misconceptions"],
    relate: ["real experiences", "relatable stories", "comedy skit"],
    compare: ["alternatives", "comparison", "pros and cons"],
    demonstrate: ["examples", "demo", "step by step"],
  }[objective];
  return [seed, ...refinements.map((suffix) => `${seed} ${suffix}`)].filter((query) => query.length <= 180);
}
