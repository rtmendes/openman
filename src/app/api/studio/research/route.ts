import { z } from "zod";
import { brand } from "@/config/brand";
import { safeFetch } from "@/lib/net/safe-fetch";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";

const query = z.string().trim().min(2).max(180);
const pages = z.object({ pages: z.array(z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable().optional(),
})).max(8) });
const headers = { "Cache-Control": "private, no-store" };

export const GET = withErrorReporting("studio.research", async (req) => {
  await requireSession();
  const topic = query.safeParse(req.nextUrl.searchParams.get("q"));
  if (!topic.success) return Response.json({ error: "Enter a search phrase between 2 and 180 characters." }, { status: 400, headers });
  const url = new URL("https://en.wikipedia.org/w/rest.php/v1/search/page");
  url.search = new URLSearchParams({ q: topic.data, limit: "8" }).toString();
  try {
    const upstream = await safeFetch(url, {
      timeoutMs: 7000, maxBytes: 90_000, maxRedirects: 0,
      headers: { Accept: "application/json", "User-Agent": `${brand.name}ContentStudio/1.0 (https://github.com/rtmendes/openman)` },
    });
    if (!upstream.ok) throw new Error("Search unavailable");
    const data = pages.parse(await upstream.json());
    return Response.json({ sources: data.pages.map((entry) => ({
      title: entry.title.slice(0, 180),
      description: entry.description?.slice(0, 200),
      url: `https://en.wikipedia.org/?curid=${entry.id}`,
    })) }, { headers });
  } catch {
    return Response.json({ error: "Wikipedia search is temporarily unavailable. Use the direct search links or try again." }, { status: 502, headers });
  }
});
