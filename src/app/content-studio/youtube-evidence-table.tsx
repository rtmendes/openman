import { readYouTubeEvidence } from "@/lib/studio/youtube-evidence";

export function YouTubeEvidenceTable({ csv }: { csv: string }) {
  const rows = readYouTubeEvidence(csv);
  if (!rows.length) return null;
  return <div className="studio-keyword-scroll" role="region" tabIndex={0} aria-label="YouTube performance evidence">
    <table>
      <thead><tr><th scope="col">YouTube video</th><th scope="col">Views in scan</th><th scope="col">Channel sample median</th><th scope="col">Multiple</th></tr></thead>
      <tbody>{rows.map(({ title, url, creator, posted, review, views, median, multiple }, i) => <tr key={url + i}>
        <th scope="row"><a href={url} target="_blank" rel="noreferrer">{title}</a><small>{[creator, posted, review].filter(Boolean).join(" · ")}</small></th>
        <td>{views || "Unavailable"}</td><td>{median || "Unavailable"}</td>
        <td>{multiple ? (/^\d+(?:[.,]\d+)?$/.test(multiple) ? multiple + "×" : multiple) : "Unavailable"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
