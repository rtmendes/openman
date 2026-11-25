"use client";

import { Folder, Plus } from "lucide-react";
import { studioFolderTrail, studioStages, type StudioFolder, type StudioLocation } from "@/lib/studio/organization";
import type { ProjectNavigationEntry } from "./project-sidebar";

export function FolderBrowser({ location, brand, folders, projects, onFolder, onProject, onNew, children }: {
  location: StudioLocation; brand: string; folders: StudioFolder[]; projects: ProjectNavigationEntry[];
  onFolder: (location: StudioLocation) => void; onProject: (id: string, campaign?: boolean) => void;
  onNew: () => void; children?: React.ReactNode;
}) {
  const trail = studioFolderTrail(location.folderId, folders);
  const nested = folders.filter(({ brandId, parentId }) => brandId === location.brandId && parentId === (location.folderId ?? null));
  const files = projects.filter((project) => project.location.brandId === location.brandId && project.location.folderId === location.folderId);
  return <section className="studio-folder-browser" aria-label="Project folder">
    <nav className="studio-folder-trail" aria-label="Folder path">
      <button type="button" onClick={() => onFolder({ brandId: location.brandId })}>{brand}</button>
      {trail.map(({ id, name }) => <button type="button" key={id} aria-current={id === location.folderId ? "page" : undefined}
        onClick={() => onFolder({ brandId: location.brandId, folderId: id })}>{name}</button>)}
    </nav>
    <header><h3>{trail.at(-1)?.name ?? brand}</h3><button type="button" onClick={onNew}><Plus size={15} aria-hidden /> New project here</button></header>
    {!!nested.length && <ul className="studio-folder-entries" aria-label="Subfolders">
      {nested.map(({ id, name }) => <li key={id}><button type="button" onClick={() => onFolder({ brandId: location.brandId, folderId: id })}>
        <Folder size={16} aria-hidden /> {name}
      </button></li>)}
    </ul>}
    {!!files.length && <ul className="studio-folder-entries" aria-label="Projects in this folder">
      {files.map(({ id, title, stage, useCase, tags }) => <li key={id} className="studio-folder-project">
        <div><strong>{title}</strong><small>{[studioStages[stage], useCase, ...tags].filter(Boolean).join(" · ")}</small></div>
        <div className="content-studio-runActions"><button type="button" onClick={() => onProject(id)}>Open project</button>
          <button type="button" onClick={() => onProject(id, true)}>Open campaign</button></div>
      </li>)}
    </ul>}
    {!nested.length && !files.length && <p className="production-hint">No projects in this folder yet.</p>}
    {children}
  </section>;
}
