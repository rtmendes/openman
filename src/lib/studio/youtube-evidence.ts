import { readKeywordDelimitedRows } from "./keyword-research";

export function readYouTubeEvidence(raw: string) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const headerLine = lines.findIndex((line) => /^\s*"?title"?,/i.test(line) && /(?:source_?)?url/i.test(line));
  if (headerLine === -1) return [];
  const csv = lines.slice(headerLine).join("\n").split(/\n```/, 1)[0];
  try {
    const [header, ...rows] = readKeywordDelimitedRows(csv);
    const columns = header.map((column) => column.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const indexOf = (...names: string[]) => names.map((name) => columns.indexOf(name)).find((index) => index >= 0) ?? -1;
    const title = indexOf("title");
    const url = indexOf("sourceurl", "url", "link", "watchurl");
    const views = indexOf("displayedviewsatscan", "views", "viewcount");
    const median = indexOf("samplemedianviews", "baseline", "channelmedian");
    const multiple = indexOf("samplemultiple", "viewmultiple", "multiple");
    const posted = indexOf("publisheddateet", "publishedat", "date", "publisheddate");
    const creator = indexOf("creator", "channel", "handle");
    const review = indexOf("review", "notes", "caveat");
    return rows.flatMap((row) => {
      if (!row[title] || !row[url] || row.length !== header.length) return [];
      let target: URL;
      try { target = new URL(row[url]); } catch { return []; }
      if (target.protocol !== "https:" || target.username || target.password ||
        !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(target.hostname)) return [];
      return [{ title: row[title], url: target.href, views: row[views], median: row[median], multiple: row[multiple],
        posted: row[posted], creator: row[creator], review: row[review] }];
    }).slice(0, 60);
  } catch { return []; }
}
