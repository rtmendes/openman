import { z } from "zod";
import { after } from "next/server";
import { readBody } from "@/lib/agent/server/http";
import { recentStudioKeywordLookup, saveStudioKeywordLookup, studioDraft } from "@/lib/db/studio-drafts";
import { readJsonLimited } from "@/lib/net/body";
import { operatorFor } from "@/lib/observability/operator";
import { logEvent } from "@/lib/observability/log";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";
import { keywordBatchSize, keywordMarkets, type KeywordLookup } from "@/lib/studio/keyword-research";
import { readDataForSeoKeywords, readSubscribrChannelContext, readSubscribrChannels, readSubscribrNarration, readSubscribrScripts, subscribrResponseShape } from "@/lib/studio/provider-results";
import { consumeUsage, UsageLimitError } from "@/lib/usage";

const market = z.enum(["US", "GB", "CA", "AU"]);
const language = z.enum(["en", "es", "fr"]);
const demand = z.object({ video: z.uuid(), request: z.uuid(), seed: z.string().trim().min(2).max(180), market, language, confirmCharge: z.literal(true) });
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const page = z.coerce.number().int().min(1).max(1000).default(1);
const requests = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("keyword-activity"), q: z.string().trim().min(2).max(180) }),
  z.object({ action: z.literal("keyword-sandbox") }),
  z.object({ action: z.literal("keyword-result"), video: z.uuid(), request: z.uuid().optional() }),
  z.object({ action: z.literal("channels"), page, search: z.string().trim().max(180).default("") }),
  z.object({ action: z.literal("channel-context"), channel: id }),
  z.object({ action: z.literal("scripts"), channel: id, page, search: z.string().trim().max(180).default("") }),
  z.object({ action: z.literal("narration"), script: id }),
]);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const dfsAuth = () => process.env.DATAFORSEO_BASIC_AUTH?.trim().replace(/^Basic\s+/i, "");
const subscribrToken = () => process.env.SUBSCRIBR_API_TOKEN?.trim();
const dataForSeo = "https://api.dataforseo.com";
const dataSandbox = "https://sandbox.dataforseo.com";
const subscribr = "https://subscribr.ai";
const keywordPath = "/v3/dataforseo_labs/google/keyword_ideas/live";
const activitySchema = z.object({ status_code: z.number(), tasks: z.array(z.object({ status_code: z.number(),
  result: z.array(z.object({ url: z.string(), status: z.coerce.number(), cost: z.number().nonnegative(),
    metadata: z.object({ keywords: z.array(z.string()).optional() }).nullish() })).nullish() })).nullish() });

async function providerFetch(url: URL, authorization: string, body?: string) {
  // All destinations are app-owned constants with encoded query parameters and validated numeric IDs.
  if (url.origin !== dataForSeo && url.origin !== dataSandbox && url.origin !== subscribr) throw new Error("Unknown provider endpoint.");
  return fetch(url, {
    method: body ? "POST" : "GET", body,
    headers: { Authorization: authorization, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(url.origin === dataForSeo && url.pathname === keywordPath ? 180_000 : 15_000),
  });
}

function keywordPayload(seed: string, location: number, language: string) {
  return JSON.stringify([{ keywords: [seed], location_code: location, language_code: language,
    limit: keywordBatchSize, include_serp_info: false }]);
}

function safeIssues(error: z.ZodError) {
  return error.issues.slice(0, 4).map(({ path, code }) => `${path.join(".") || "response"}: ${code}`);
}

async function readKeywordActivity(q: string) {
  const auth = dfsAuth();
  if (!auth) return reply({ error: "DataForSEO is not connected." }, 503);
  const now = Date.now();
  const stamp = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ") + " +00:00";
  const response = await providerFetch(new URL("/v3/dataforseo_labs/id_list", dataForSeo), `Basic ${auth}`, JSON.stringify([{
    datetime_from: stamp(now - 90 * 60_000), datetime_to: stamp(now - 2000), limit: 100, sort: "desc", include_metadata: true,
  }]));
  if (!response.ok) return reply({ error: `DataForSEO activity could not be read (HTTP ${response.status}).` }, 502);
  const parsed = activitySchema.parse(await readJsonLimited(response, 800_000));
  const task = parsed.tasks?.[0];
  if (parsed.status_code !== 20000 || task?.status_code !== 20000) {
    return reply({ error: `DataForSEO activity is unavailable (code ${task?.status_code ?? parsed.status_code}).` }, 502);
  }
  const matches = (task.result ?? []).filter(({ url, metadata }) => "/" + url.replace(/^\//, "") === keywordPath &&
    metadata?.keywords?.some((word) => word.toLowerCase() === q.toLowerCase()));
  return reply({ activity: matches.map(({ status, cost }) => ({ status, cost })) });
}

export const GET = withErrorReporting("studio.providers.read", async (req) => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ error: "Provider tools are available to the Studio owner." }, 404);
  const input = requests.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!input.success) return reply({ error: "Choose a valid provider request." }, 400);
  if (input.data.action === "status") return reply({ dataForSeo: Boolean(dfsAuth()), subscribr: Boolean(subscribrToken()) });
  if (input.data.action === "keyword-result") return reply({
    lookup: await recentStudioKeywordLookup(session.userId, input.data.video, input.data.request),
  });
  if (input.data.action === "keyword-activity") {
    try { return await readKeywordActivity(input.data.q); }
    catch { return reply({ error: "Could not verify recent DataForSEO activity." }, 502); }
  }
  if (input.data.action === "keyword-sandbox") {
    const auth = dfsAuth();
    if (!auth) return reply({ error: "DataForSEO is not connected." }, 503);
    try {
      const response = await providerFetch(new URL(keywordPath, dataSandbox), `Basic ${auth}`,
        keywordPayload("perimenopause night sweats", keywordMarkets.US, "en"));
      if (!response.ok) return reply({ error: `DataForSEO Sandbox returned HTTP ${response.status}.` }, 502);
      const sample = readDataForSeoKeywords(await readJsonLimited(response, 2_000_000), "US", "en", new Date().toISOString().slice(0, 10));
      return reply({ sampleRows: sample.rows.length, cost: sample.cost, sandbox: true });
    } catch (error) {
      const detail = error instanceof z.ZodError ? safeIssues(error) : [];
      return reply({ error: "DataForSEO Sandbox did not return a usable sample.", detail }, 502);
    }
  }
  const token = subscribrToken();
  if (!token) return reply({ error: "Add a scoped Subscribr token to the server configuration." }, 503);
  const request = input.data;
  const path = request.action === "channels" ? "/channels" : request.action === "channel-context" ? `/channels/${request.channel}`
    : request.action === "scripts" ? `/channels/${request.channel}/scripts` : `/scripts/${request.script}/content`;
  const url = new URL("/api/v1" + path, subscribr);
  if ("page" in request) {
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("per_page", request.action === "channels" ? "100" : "30");
  }
  if ("search" in request && request.search) url.searchParams.set("search", request.search);
  try {
    const authorization = `Bearer ${token}`;
    async function readOptionalChannelInput(relation: "voices" | "templates") {
      try {
        const response = await providerFetch(new URL(`${url.pathname}/${relation}`, subscribr), authorization);
        if (!response.ok) return { issue: `HTTP ${response.status}` };
        return { data: await readJsonLimited(response, 800_000) };
      } catch { return { issue: "unreadable response" }; }
    }
    const [upstream, voices, templates] = await Promise.all([
      providerFetch(url, authorization),
      request.action === "channel-context" ? readOptionalChannelInput("voices") : undefined,
      request.action === "channel-context" ? readOptionalChannelInput("templates") : undefined,
    ]);
    if (upstream.status === 401 || upstream.status === 403) return reply({ error: "Subscribr denied access. Check the token’s channel and script read permissions." }, 502);
    if (upstream.status === 429) return reply({ error: "Subscribr’s request limit was reached. Try again shortly." }, 429);
    if (!upstream.ok) return reply({ error: `Subscribr returned HTTP ${upstream.status}.` }, 502);
    const data = await readJsonLimited(upstream, 800_000);
    if (request.action === "channels") return reply(readSubscribrChannels(data));
    if (request.action === "channel-context") {
      const context = readSubscribrChannelContext(data, voices?.data, templates?.data, request.channel);
      const readIssues = Object.fromEntries(context.unavailable.map((kind) => {
        const result = kind === "voices" ? voices : templates;
        return [kind, result?.issue || "unexpected response format"];
      }));
      for (const kind of context.unavailable) {
        const result = kind === "voices" ? voices : templates;
        if (result?.data !== undefined) await logEvent("warn", "studio.subscribr_catalogue_format", {
          userId: session.userId, data: { kind, shape: subscribrResponseShape(result.data) },
        });
      }
      return reply({ ...context, readIssues });
    }
    if (request.action === "scripts") return reply(readSubscribrScripts(data));
    return reply(readSubscribrNarration(data, request.script));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = safeIssues(error);
      await logEvent("warn", "studio.subscribr_format", { userId: session.userId, data: { action: request.action, detail } });
      return reply({ error: "Subscribr returned a response with an unexpected channel or script format.", detail }, 502);
    }
    return reply({ error: "Could not read that item from Subscribr. Try again or open it in Subscribr." }, 502);
  }
});

async function completeKeywordLookup(userId: string, request: z.infer<typeof demand>, auth: string, started: KeywordLookup) {
  let result: NonNullable<KeywordLookup["result"]>;
  try {
    await consumeUsage(userId, "studio_keyword_lookups");
    const upstream = await providerFetch(new URL(keywordPath, dataForSeo), `Basic ${auth}`,
      keywordPayload(request.seed, keywordMarkets[request.market], request.language));
    if (!upstream.ok) result = { error: `DataForSEO lookup failed (HTTP ${upstream.status}). Check account activity before retrying.` };
    else result = readDataForSeoKeywords(await readJsonLimited(upstream, 2_000_000), request.market, request.language, new Date().toISOString().slice(0, 10));
  } catch (error) {
    if (error instanceof UsageLimitError) result = { error: error.message };
    else {
      const detail = error instanceof z.ZodError ? safeIssues(error) : undefined;
      await logEvent("warn", "studio.dataforseo_failed", { userId, data: { detail, failureType: error instanceof Error ? error.name : "unknown" } });
      result = { error: "Studio could not capture the returned report. Check DataForSEO activity before retrying." };
    }
  }
  try { await saveStudioKeywordLookup(userId, request.video, { ...started, result }); }
  catch { await logEvent("error", "studio.dataforseo_save", { userId }); }
}

export const POST = withErrorReporting("studio.providers.keywordLookup", async (req) => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ error: "Paid keyword lookup is available to the Studio owner." }, 404);
  const auth = dfsAuth();
  if (!auth) return reply({ error: "DataForSEO is not connected. You can still import keyword reports." }, 503);
  const input = await readBody(req, demand, 2500);
  if ("error" in input) return input.error;
  const draft = await studioDraft(session.userId);
  if (!(draft?.items as { spec?: { id?: string } }[] | undefined)?.some((item) => item.spec?.id === input.data.video)) {
    return reply({ error: "Save this Studio project before requesting paid research." }, 409);
  }
  const active = await recentStudioKeywordLookup(session.userId, input.data.video);
  if (active && !active.result) return reply({ lookup: active }, 202);
  const lookup: KeywordLookup = { id: input.data.request, requestedAt: Date.now(), seed: input.data.seed, market: input.data.market, language: input.data.language };
  if (await saveStudioKeywordLookup(session.userId, input.data.video, lookup)) {
    after(() => completeKeywordLookup(session.userId, input.data, auth, lookup));
  }
  return reply({ lookup }, 202);
});
