import { z } from "zod";
import { readBody } from "@/lib/agent/server/http";
import { safeFetch } from "@/lib/net/safe-fetch";
import { operatorFor } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";
import { keywordBatchSize, keywordMarkets } from "@/lib/studio/keyword-research";
import { readDataForSeoKeywords, readSubscribrChannels, readSubscribrNarration, readSubscribrScripts } from "@/lib/studio/provider-results";
import { consumeUsage, UsageLimitError } from "@/lib/usage";

const market = z.enum(["US", "GB", "CA", "AU"]);
const language = z.enum(["en", "es", "fr"]);
const demand = z.object({ seed: z.string().trim().min(2).max(180), market, language, confirmCharge: z.literal(true) });
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const page = z.coerce.number().int().min(1).max(1000).default(1);
const requests = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("channels"), page }),
  z.object({ action: z.literal("scripts"), channel: id, page, search: z.string().trim().max(180).default("") }),
  z.object({ action: z.literal("narration"), script: id }),
]);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const dfsAuth = () => process.env.DATAFORSEO_BASIC_AUTH?.trim().replace(/^Basic\s+/i, "");
const subscribrToken = () => process.env.SUBSCRIBR_API_TOKEN?.trim();
const timeout = { maxRedirects: 0, timeoutMs: 10_000, maxBytes: 800_000 };

export const GET = withErrorReporting("studio.providers.read", async (req) => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ error: "Provider tools are available to the Studio owner." }, 404);
  const input = requests.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!input.success) return reply({ error: "Choose a valid provider request." }, 400);
  if (input.data.action === "status") return reply({ dataForSeo: Boolean(dfsAuth()), subscribr: Boolean(subscribrToken()) });
  const token = subscribrToken();
  if (!token) return reply({ error: "Add a scoped Subscribr token to the server configuration." }, 503);
  const request = input.data;
  const base = "https://subscribr.ai/api/v1";
  const path = request.action === "channels" ? "/channels" : request.action === "scripts" ? `/channels/${request.channel}/scripts` : `/scripts/${request.script}/content`;
  const url = new URL(base + path);
  if ("page" in request) {
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("per_page", "30");
  }
  if (request.action === "scripts" && request.search) url.searchParams.set("search", request.search);
  try {
    const upstream = await safeFetch(url, { ...timeout, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (upstream.status === 401 || upstream.status === 403) return reply({ error: "Subscribr denied access. Check the token’s channel and script read permissions." }, 502);
    if (upstream.status === 429) return reply({ error: "Subscribr’s request limit was reached. Try again shortly." }, 429);
    if (!upstream.ok) throw new Error("Subscribr read failed");
    const data = await upstream.json();
    if (request.action === "channels") return reply(readSubscribrChannels(data));
    if (request.action === "scripts") return reply(readSubscribrScripts(data));
    return reply(readSubscribrNarration(data, request.script));
  } catch {
    return reply({ error: "Could not read that item from Subscribr. Try again or open it in Subscribr." }, 502);
  }
});

export const POST = withErrorReporting("studio.providers.keywordLookup", async (req) => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ error: "Paid keyword lookup is available to the Studio owner." }, 404);
  const auth = dfsAuth();
  if (!auth) return reply({ error: "DataForSEO is not connected. You can still import keyword reports." }, 503);
  const input = await readBody(req, demand, 2500);
  if ("error" in input) return input.error;
  try { await consumeUsage(session.userId, "studio_keyword_lookups"); }
  catch (err) { if (err instanceof UsageLimitError) return reply({ error: err.message }, err.status); throw err; }
  try {
    const upstream = await safeFetch("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live", {
      ...timeout, method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keywords: [input.data.seed], location_code: keywordMarkets[input.data.market],
        language_code: input.data.language, limit: keywordBatchSize, include_serp_info: false }]),
    });
    if (!upstream.ok) throw new Error("DataForSEO lookup failed");
    return reply(readDataForSeoKeywords(await upstream.json(), input.data.market, input.data.language, new Date().toISOString().slice(0, 10)));
  } catch {
    return reply({ error: "DataForSEO did not return a usable report. Check the connection and account activity before retrying." }, 502);
  }
});
