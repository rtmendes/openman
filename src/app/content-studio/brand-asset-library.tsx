"use client";

import { ImagePlus, LibraryBig, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileStudioBrandAsset, getStudioBrandAssets, importStudioBrandImage, uploadStudioMedia } from "@/lib/agent/client";
import { studioMediaTypes, type StudioMedia } from "@/lib/studio/media-types";
import type { StudioFolder, StudioLocation } from "@/lib/studio/organization";
import { AssetPreview, AssetThumbnail, attachmentAsset } from "./asset-preview";
import { FolderOptions, type SidebarBrand } from "./project-sidebar";

export function BrandAssetLibrary({ initial, brands, folders, project, onAttach, onClose }: {
  initial: StudioLocation; brands: SidebarBrand[]; folders: StudioFolder[];
  project?: { title: string; media: StudioMedia[]; shots: number; selectedShot: number; locked: boolean };
  onAttach: (asset: StudioMedia, shot?: number) => boolean; onClose: () => void;
}) {
  const [location, setLocation] = useState(initial);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<{ assets: StudioMedia[]; hasMore: boolean }>();
  const [preview, setPreview] = useState<StudioMedia>();
  const [asset, setAsset] = useState<StudioMedia>();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [projectFile, setProjectFile] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    let current = true;
    void getStudioBrandAssets(location, page, search).then((result) => {
      if (current) setEntries(result);
    }).catch((error: unknown) => {
      if (current) { setEntries({ assets: [], hasMore: false }); setNote(error instanceof Error ? error.message : "Couldn’t open this brand folder."); }
    });
    return () => { current = false; };
  }, [location, page, search, refresh]);

  function navigate(destination: StudioLocation) {
    setLocation(destination); setEntries(undefined); setPage(1); setAsset(undefined); setPreview(undefined); setNote("");
  }

  async function mutate(action: () => Promise<string>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setNote("");
    try { setNote(await action()); setPage(1); setRefresh((value) => value + 1); }
    catch (error) { setNote(error instanceof Error ? error.message : "Couldn’t save the asset."); }
    finally { lock.current = false; setPending(false); }
  }

  function upload(files: File[]) {
    if (!files.length) return;
    void mutate(async () => {
      let saved = 0;
      const failed: string[] = [];
      for (const file of files.slice(0, 12)) {
        try { await fileStudioBrandAsset(location, await uploadStudioMedia(file)); saved++; }
        catch { failed.push(file.name); }
      }
      return [`${saved} saved to this brand folder.`, failed.length ? `Couldn’t save ${failed.join(", ")}.` : "",
        files.length > 12 ? "Add up to 12 files at a time." : ""].filter(Boolean).join(" ");
    });
  }

  return <section className="studio-brand-library" aria-label="Brand asset library">
    <header><h3><LibraryBig size={18} aria-hidden /> Brand assets</h3>
      <button type="button" onClick={onClose} aria-label="Close brand asset library"><X size={17} /></button>
    </header>
    <fieldset disabled={pending} className="production-fields">
      <label>Asset brand<select value={location.brandId} onChange={(event) => navigate({ brandId: event.target.value })}>
        {brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Asset folder<select value={location.folderId ?? ""} onChange={(event) => navigate({ brandId: location.brandId, folderId: event.target.value || undefined })}>
        <FolderOptions folders={folders} brandId={location.brandId} />
      </select></label>
      <form className="studio-library-filter" onSubmit={(event) => {
        event.preventDefault(); setPage(1); setSearch(filter.trim()); setRefresh((value) => value + 1);
      }}>
        <label>Search assets<input value={filter} maxLength={90} onChange={(event) => setFilter(event.target.value)} /></label>
        <button type="submit">Search</button>
      </form>
      <div className="production-wide production-drop" data-dragging={dragging} onDragOver={(event) => {
        if (pending || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); setDragging(true);
      }} onDragLeave={() => setDragging(false)} onDrop={(event) => {
        event.preventDefault(); setDragging(false); if (!pending) upload(Array.from(event.dataTransfer.files));
      }}>
        <label><span><ImagePlus size={15} aria-hidden /> Drop or upload design exports</span>
          <input type="file" multiple accept={Object.keys(studioMediaTypes).map((ext) => `.${ext}`).join(",")}
            onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; upload(files); }} />
        </label>
      </div>
      <details className="production-wide">
        <summary>Import an image URL or file a project attachment</summary>
        <div className="production-fields">
          <label>Direct image URL<input type="url" maxLength={1500} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          <label>Asset name<input maxLength={230} value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" /></label>
          <div className="content-studio-runActions"><button type="button" disabled={!url.trim()} onClick={() => void mutate(async () => {
            await importStudioBrandImage(location, url.trim(), name.trim() || undefined);
            setUrl(""); setName(""); return "Image saved privately.";
          })}>Import image</button></div>
          {project?.media.length ? <>
            <label>Project attachment<select value={projectFile} onChange={(event) => setProjectFile(event.target.value)}>
              <option value="">Choose an attachment</option>{project.media.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <div className="content-studio-runActions"><button type="button" disabled={!projectFile} onClick={() => {
              const item = project.media.find(({ id }) => id === projectFile);
              if (item) void mutate(async () => { await fileStudioBrandAsset(location, item); return "Attachment filed in this brand folder."; });
            }}>Save to brand folder</button></div>
          </> : null}
        </div>
      </details>
    </fieldset>
    {note && <p role="status">{note}</p>}
    {pending && <p role="status">Saving assets…</p>}
    {!entries && <p role="status">Opening brand folder…</p>}
    {entries?.assets.length === 0 && <p className="production-hint">No assets in this view.</p>}
    {!!entries?.assets.length && <ul className="studio-asset-grid" aria-label="Assets in brand folder">
      {entries.assets.map((item) => <li key={item.id}>
        <button type="button" className="studio-asset-tile" aria-pressed={asset?.id === item.id} onClick={() => {
          setAsset(item); setPreview(item); setTargetFolder(location.folderId ?? "");
        }}><AssetThumbnail asset={attachmentAsset(item)} /><strong title={item.name}>{item.name}</strong></button>
      </li>)}
    </ul>}
    {(page > 1 || entries?.hasMore) && <div className="content-studio-runActions">
      <button type="button" disabled={page === 1 || pending} onClick={() => { setEntries(undefined); setPage(page - 1); }}>Previous page</button>
      <button type="button" disabled={!entries?.hasMore || pending} onClick={() => { setEntries(undefined); setPage(page + 1); }}>Next page</button>
    </div>}
    {asset && <div className="studio-library-selection">
      {preview && <AssetPreview key={preview.id} asset={attachmentAsset(preview)} onClose={() => setPreview(undefined)} />}
      <div className="content-studio-runActions">
        {project && <button type="button" disabled={project.locked} onClick={() => {
          if (onAttach(asset)) setNote(`Added to ${project.title}.`);
        }}>Add to project references</button>}
        {project && project.shots > 0 && /^(image|video)\//.test(asset.type) && <button type="button" disabled={project.locked} onClick={() => {
          if (onAttach(asset, project.selectedShot)) setNote(`Assigned to shot ${project.selectedShot + 1}.`);
        }}>Use in shot {project.selectedShot + 1}</button>}
      </div>
      <label>Move asset to folder<select value={targetFolder} onChange={(event) => setTargetFolder(event.target.value)}>
        <FolderOptions folders={folders} brandId={location.brandId} />
      </select></label>
      <button type="button" disabled={pending || targetFolder === (location.folderId ?? "")} onClick={() => void mutate(async () => {
        await fileStudioBrandAsset({ brandId: location.brandId, folderId: targetFolder || undefined }, asset);
        setAsset(undefined); setPreview(undefined); return "Asset moved. Project references still point to the same file.";
      })}>Move asset</button>
    </div>}
  </section>;
}
