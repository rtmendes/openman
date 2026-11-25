"use client";

import { useRef, useState } from "react";
import { readYouTubeEvidence } from "@/lib/studio/youtube-evidence";
import { AssetPreview, AssetThumbnail, linkAsset, type PreviewAsset } from "./asset-preview";

export function YouTubeEvidenceTable({ csv }: { csv: string }) {
  const [selected, setSelected] = useState<PreviewAsset>();
  const opener = useRef<HTMLButtonElement>(null);
  const rows = readYouTubeEvidence(csv);
  if (!rows.length) return null;
  const preview = rows.some(({ url }) => url === selected?.src) ? selected : undefined;
  return <div className="studio-asset-layout" data-open={Boolean(preview)}>
    <div className="studio-keyword-scroll" role="region" tabIndex={0} aria-label="YouTube performance evidence">
    <table>
      <thead><tr><th scope="col">YouTube video</th><th scope="col">Views in scan</th><th scope="col">Channel sample median</th><th scope="col">Multiple</th></tr></thead>
      <tbody>{rows.map(({ title, url, creator, posted, review, views, median, multiple }, i) => {
        const linked = linkAsset(url);
        const asset = linked?.videoId ? { ...linked, title, key: url + i } : undefined;
        return <tr key={url + i}>
          <th scope="row"><div className="studio-youtube-video">
            {asset && <button type="button" className="studio-youtube-thumbnail" aria-label={`Preview ${title}`} aria-expanded={preview?.key === asset.key}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(preview?.key === asset.key ? undefined : asset);
              }}><AssetThumbnail asset={asset} /></button>}
            <div><a href={url} target="_blank" rel="noreferrer">{title}</a><small>{[creator, posted, review].filter(Boolean).join(" · ")}</small></div>
          </div></th>
          <td>{views || "Unavailable"}</td><td>{median || "Unavailable"}</td>
          <td>{multiple ? (/^\d+(?:[.,]\d+)?$/.test(multiple) ? multiple + "×" : multiple) : "Unavailable"}</td>
        </tr>;
      })}</tbody>
    </table>
    </div>
    {preview && <AssetPreview key={preview.key} asset={preview} onClose={() => { setSelected(undefined); opener.current?.focus(); }} />}
  </div>;
}
