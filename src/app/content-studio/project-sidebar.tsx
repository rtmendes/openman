"use client";

import { ChevronDown, ChevronRight, Folder, LibraryBig, PanelLeftClose, Plus, Search } from "lucide-react";
import { useState, type DragEvent } from "react";
import {
  studioFolderTrail, studioStages, studioUnassigned,
  type StudioFolder, type StudioLocation, type StudioOrganization, type StudioStage,
} from "@/lib/studio/organization";

export type ProjectNavigationEntry = { id: string; title: string; stage: StudioStage; useCase: string; location: StudioLocation; variation: boolean };
export type SidebarBrand = { id: string; name: string; context?: string };
const projectMime = "application/x-mahara-studio-project";
const folderMime = "application/x-mahara-studio-folder";

export function FolderOptions({ folders, brandId, excluded }: { folders: StudioFolder[]; brandId: string; excluded?: string }) {
  return <><option value="">Brand root</option>{folders.filter((folder) => folder.brandId === brandId &&
    (!excluded || !studioFolderTrail(folder.id, folders).some(({ id }) => id === excluded))).map((folder) =>
    <option key={folder.id} value={folder.id}>{studioFolderTrail(folder.id, folders).map(({ name }) => name).join(" / ")}</option>)}</>;
}

export function ProjectSidebar({ organization, brands, projects, activeId, available, saving, status, cloud, onReload, onSave, onOpen,
  onMove, onOrder, onNew, onAssets }: {
  organization: StudioOrganization; brands: SidebarBrand[]; projects: ProjectNavigationEntry[]; activeId?: string;
  available: boolean; saving: boolean; status: string; cloud: boolean; onReload: () => void;
  onSave: (organization: StudioOrganization) => Promise<boolean>; onOpen: (id: string) => void;
  onMove: (id: string, location: StudioLocation) => void; onOrder: (id: string, beforeId: string) => void;
  onNew: (location: StudioLocation) => void; onAssets: (location: StudioLocation) => void;
}) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StudioStage | "">("");
  const [brandFilter, setBrandFilter] = useState("");
  const [useCaseFilter, setUseCaseFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState<StudioLocation>();
  const [brandName, setBrandName] = useState("");
  const [brandContext, setBrandContext] = useState("");
  const [folderName, setFolderName] = useState("");
  const [focusedFolder, setFocusedFolder] = useState<string>();
  const [manageBrand, setManageBrand] = useState<string>();
  const [editingName, setEditingName] = useState("");
  const [editingParent, setEditingParent] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const currentProject = projects.find(({ id }) => id === activeId);
  const target = location ?? currentProject?.location ?? { brandId: studioUnassigned };
  const selectedFolder = organization.folders.find(({ id }) => id === focusedFolder);
  const needle = search.toLocaleLowerCase().trim();
  const useCases = [...new Set(projects.map(({ useCase }) => useCase.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filtered = projects.filter((project) => (!stage || project.stage === stage) &&
    (!brandFilter || project.location.brandId === brandFilter) &&
    (!useCaseFilter || project.useCase.trim() === useCaseFilter) &&
    (needle ? `${project.title} ${project.useCase} ${studioStages[project.stage]}`.toLocaleLowerCase().includes(needle) : project.stage !== "archived" || stage === "archived"));
  const filterOn = Boolean(needle || stage || useCaseFilter);
  const locked = saving || !available;

  function toggle(id: string, fallback: boolean) {
    setExpanded((current) => ({ ...current, [id]: !(current[id] ?? fallback) }));
  }

  function moveFolder(id: string, parentId: string | null) {
    return onSave({ ...organization, folders: organization.folders.map((folder) => folder.id === id ? { ...folder, parentId } : folder) });
  }

  function orderFolder(folder: StudioFolder, offset: number) {
    const items = [...organization.folders];
    const siblings = items.filter(({ brandId, parentId }) => brandId === folder.brandId && parentId === folder.parentId);
    const adjacent = siblings[siblings.findIndex(({ id }) => id === folder.id) + offset];
    if (!adjacent) return;
    const from = items.findIndex(({ id }) => id === folder.id);
    const to = items.findIndex(({ id }) => id === adjacent.id);
    [items[from], items[to]] = [items[to], items[from]];
    void onSave({ ...organization, folders: items });
  }

  async function createBrand() {
    if (!brandName.trim()) return;
    const brand = { id: crypto.randomUUID(), name: brandName.trim(), context: brandContext.trim() };
    const editing = manageBrand && organization.brands.some(({ id }) => id === manageBrand) ? manageBrand : undefined;
    const saved = await onSave({ ...organization, brands: editing
      ? organization.brands.map((item) => item.id === editing ? { ...brand, id: editing } : item)
      : [...organization.brands, brand] });
    if (saved) { setLocation({ brandId: editing ?? brand.id }); setBrandName(""); setBrandContext(""); setManageBrand(undefined); }
  }

  async function createFolder() {
    if (!folderName.trim()) return;
    const folder = { id: crypto.randomUUID(), name: folderName.trim(), brandId: target.brandId, parentId: target.folderId ?? null };
    if (await onSave({ ...organization, folders: [...organization.folders, folder] })) {
      setFolderName("");
      setLocation({ brandId: folder.brandId, folderId: folder.id });
      setExpanded((current) => ({ ...current, [folder.brandId]: true, [folder.parentId ?? folder.brandId]: true, [folder.id]: true }));
    }
  }

  function allowDrop(event: DragEvent, key: string, allowFolder: boolean) {
    if (!available || !(event.dataTransfer.types.includes(projectMime) || (allowFolder && event.dataTransfer.types.includes(folderMime)))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  }

  function receive(event: DragEvent, destination: StudioLocation) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget("");
    const project = event.dataTransfer.getData(projectMime);
    if (project) onMove(project, destination);
    const folder = organization.folders.find(({ id }) => id === event.dataTransfer.getData(folderMime));
    if (folder && folder.brandId === destination.brandId && folder.id !== destination.folderId) void moveFolder(folder.id, destination.folderId ?? null);
  }

  function renderProjects(destination: StudioLocation) {
    return filtered.filter(({ location }) => location.brandId === destination.brandId && location.folderId === destination.folderId)
      .map((project) => <li key={project.id} className="studio-tree-project">
        <button type="button" aria-current={activeId === project.id ? "page" : undefined} draggable={available}
          data-drop={dropTarget === project.id} onDragOver={(event) => allowDrop(event, project.id, false)}
          onDragLeave={() => setDropTarget("")} onDrop={(event) => {
            event.preventDefault(); event.stopPropagation(); setDropTarget("");
            const from = projects.find(({ id }) => id === event.dataTransfer.getData(projectMime));
            if (from && from.location.brandId === project.location.brandId && from.location.folderId === project.location.folderId) onOrder(from.id, project.id);
          }} onDragStart={(event) => {
            event.dataTransfer.setData(projectMime, project.id); event.dataTransfer.effectAllowed = "move";
          }} onDragEnd={() => setDropTarget("")} onClick={() => { setLocation(project.location); onOpen(project.id); }}>
          <span>{project.title}</span><small>{[studioStages[project.stage], project.useCase, project.variation ? "Variation" : ""].filter(Boolean).join(" · ")}</small>
        </button>
      </li>);
  }

  function renderFolders(brandId: string, parentId: string | null): React.ReactNode {
    return organization.folders.filter((folder) => folder.brandId === brandId && folder.parentId === parentId &&
      (!filterOn || filtered.some((entry) => studioFolderTrail(entry.location.folderId, organization.folders).some(({ id }) => id === folder.id))))
      .map((folder) => {
        const open = expanded[folder.id] ?? filterOn;
        const destination = { brandId, folderId: folder.id };
        return <li key={folder.id}>
          <div className="studio-tree-row" data-location={target.folderId === folder.id} data-drop={dropTarget === folder.id}
            onDragOver={(event) => allowDrop(event, folder.id, true)} onDragLeave={() => setDropTarget("")} onDrop={(event) => receive(event, destination)}>
            <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={open} onClick={() => toggle(folder.id, filterOn)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button type="button" draggable={!locked} onDragStart={(event) => {
              event.dataTransfer.setData(folderMime, folder.id); event.dataTransfer.effectAllowed = "move";
            }} onDragEnd={() => setDropTarget("")} onClick={() => {
              setLocation(destination); setFocusedFolder(folder.id); setEditingName(folder.name); setEditingParent(folder.parentId ?? "");
              setExpanded((current) => ({ ...current, [folder.id]: true }));
            }}><Folder size={14} aria-hidden />{folder.name}</button>
          </div>
          {open && <ul>{renderFolders(brandId, folder.id)}{renderProjects(destination)}</ul>}
        </li>;
      });
  }

  return <nav className="studio-project-navigation" aria-label="Studio project navigation">
    <header><h3>Projects</h3>
      <button type="button" title="Collapse sidebar" aria-label="Collapse project sidebar" disabled={locked}
        onClick={() => void onSave({ ...organization, sidebar: { ...organization.sidebar, collapsed: true } })}><PanelLeftClose size={16} /></button>
    </header>
    {status && <p role="status">{status} <button type="button" onClick={onReload}>Reload</button></p>}
    <label className="studio-project-search"><Search size={15} aria-hidden /><input aria-label="Search projects" value={search} placeholder="Title, use case or stage" onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="studio-nav-filters">
      <label>Brand<select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
        <option value="">All brands</option>{brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Stage<select value={stage} onChange={(event) => setStage(event.target.value as StudioStage | "")}>
        <option value="">Active stages</option>{Object.entries(studioStages).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    {useCases.length > 0 && <label>Use case<select value={useCaseFilter} onChange={(event) => setUseCaseFilter(event.target.value)}>
      <option value="">All use cases</option>{useCases.map((name) => <option key={name}>{name}</option>)}</select></label>}
    <div className="studio-nav-tools">
      <button type="button" onClick={() => onNew(target)}><Plus size={14} /> New project</button>
      {cloud && available && <button type="button" onClick={() => onAssets(target)}><LibraryBig size={14} /> Brand assets</button>}
    </div>
    <ul className="studio-tree">
      {brands.filter(({ id }) => (!brandFilter || id === brandFilter) &&
        (!filterOn || filtered.some(({ location }) => location.brandId === id))).map(({ id, name }) => {
        const open = expanded[id] ?? true;
        const destination = { brandId: id };
        return <li key={id}>
          <div className="studio-tree-row studio-tree-brand" data-location={target.brandId === id && !target.folderId} data-drop={dropTarget === id}
            onDragOver={(event) => allowDrop(event, id, true)} onDragLeave={() => setDropTarget("")} onDrop={(event) => receive(event, destination)}>
            <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${name}`} aria-expanded={open} onClick={() => toggle(id, true)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button type="button" onClick={() => { setLocation(destination); setFocusedFolder(undefined); setExpanded((current) => ({ ...current, [id]: true })); }}>
              {name}<small>{filtered.filter(({ location }) => location.brandId === id).length}</small>
            </button>
          </div>
          {open && <ul>{renderFolders(id, null)}{renderProjects(destination)}</ul>}
        </li>;
      })}
    </ul>
    {!filtered.length && <p className="production-hint">No projects match this view.</p>}
    {available && <details className="studio-nav-settings">
      <summary>Organize workspace</summary>
      <fieldset disabled={locked}>
        <label>Folder name<input maxLength={90} value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
        <button type="button" disabled={!folderName.trim()} onClick={() => void createFolder()}>Add folder in {brands.find(({ id }) => id === target.brandId)?.name}{target.folderId ? ` / ${organization.folders.find(({ id }) => id === target.folderId)?.name}` : ""}</button>
        {selectedFolder && <div className="studio-nav-edit">
          <label>Rename folder<input maxLength={90} value={editingName} onChange={(event) => setEditingName(event.target.value)} /></label>
          <label>Move folder to<select value={editingParent} onChange={(event) => setEditingParent(event.target.value)}>
            <FolderOptions folders={organization.folders} brandId={selectedFolder.brandId} excluded={selectedFolder.id} /></select></label>
          <button type="button" disabled={!editingName.trim()} onClick={() => void onSave({ ...organization, folders: organization.folders.map((folder) => folder.id === selectedFolder.id
            ? { ...folder, name: editingName.trim(), parentId: editingParent || null } : folder) })}>Save folder</button>
          <button type="button" onClick={() => orderFolder(selectedFolder, -1)}>Move folder up</button>
          <button type="button" onClick={() => orderFolder(selectedFolder, 1)}>Move folder down</button>
        </div>}
        <label>Brand settings<select value={manageBrand ?? ""} onChange={(event) => {
          const item = organization.brands.find(({ id }) => id === event.target.value);
          setManageBrand(item?.id); setBrandName(item?.name ?? ""); setBrandContext(item?.context ?? "");
        }}><option value="">New brand</option>{organization.brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Brand name<input maxLength={100} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
        <label>Brand writing context<textarea rows={3} maxLength={5000} value={brandContext} placeholder="Audience, tone and claims" onChange={(event) => setBrandContext(event.target.value)} /></label>
        <button type="button" disabled={!brandName.trim()} onClick={() => void createBrand()}>{manageBrand ? "Save brand" : "Add brand"}</button>
        <label>Sidebar position<select value={organization.sidebar.side} onChange={(event) => void onSave({
          ...organization, sidebar: { ...organization.sidebar, side: event.target.value === "right" ? "right" : "left" },
        })}><option value="left">Left</option><option value="right">Right</option></select></label>
        <label>Sidebar width<select value={organization.sidebar.width} onChange={(event) => void onSave({
          ...organization, sidebar: { ...organization.sidebar, width: Number(event.target.value) },
        })}><option value={204}>Compact</option><option value={244}>Standard</option><option value={320}>Wide</option></select></label>
      </fieldset>
    </details>}
  </nav>;
}
