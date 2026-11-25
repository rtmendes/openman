"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Folder, FolderInput, LibraryBig, PanelLeftClose, PanelRightClose, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  studioFolderTrail, studioStages, studioUnassigned,
  type StudioFolder, type StudioLocation, type StudioOrganization, type StudioStage,
} from "@/lib/studio/organization";
import { SidebarResize } from "./sidebar-resize";

export const projectSidebarId = "studio-project-navigation";
export type ProjectNavigationEntry = { id: string; title: string; stage: StudioStage; useCase: string; tags: string[]; location: StudioLocation; variation: boolean; locked: boolean };
export type SidebarBrand = { id: string; name: string; context?: string };
type TreeTarget = { id: string; kind: "folder" | "project"; name: string; location: StudioLocation };
type EditMode = "rename" | "move" | "delete";
const projectMime = "application/x-mahara-studio-project";
const folderMime = "application/x-mahara-studio-folder";

function RenameEditor({ target, disabled, onSave, onClose }: {
  target: TreeTarget; disabled: boolean; onSave: (name: string) => Promise<boolean>; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(target.name);
  const maxLength = target.kind === "folder" ? 90 : 120;
  const name = value.trim();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return <form className="studio-nav-rename" onSubmit={async (event) => {
    event.preventDefault();
    if (disabled || !name || name.length > maxLength) return;
    if (name === target.name || await onSave(name)) onClose();
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && !disabled) { event.preventDefault(); onClose(); }
  }}>
    <label>{target.kind === "folder" ? "Folder name" : "Project name"}
      <input ref={input} value={value} maxLength={maxLength} required disabled={disabled} onChange={(event) => setValue(event.target.value)} />
    </label>
    <div className="studio-nav-rename-actions">
      <button type="submit" disabled={disabled || !name || name.length > maxLength}>Save</button>
      <button type="button" disabled={disabled} onClick={onClose}>Cancel</button>
    </div>
  </form>;
}

function MoveEditor({ target, brands, folders, disabled, onSave, onClose }: {
  target: TreeTarget; brands: SidebarBrand[]; folders: StudioFolder[]; disabled: boolean;
  onSave: (location: StudioLocation) => Promise<boolean>; onClose: () => void;
}) {
  const firstField = useRef<HTMLSelectElement>(null);
  const [destination, setDestination] = useState(target.location);
  const isFolder = target.kind === "folder";
  const changingBrand = destination.brandId !== target.location.brandId;
  const unchanged = !changingBrand && destination.folderId === target.location.folderId;

  useEffect(() => { firstField.current?.focus(); }, []);

  return <form className="studio-nav-rename" aria-label={`Move ${target.kind}`} onSubmit={async (event) => {
    event.preventDefault();
    if (!disabled && !unchanged && await onSave(destination)) onClose();
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && !disabled) { event.preventDefault(); onClose(); }
  }}>
    {!isFolder && <label>Destination brand<select ref={firstField} value={destination.brandId} disabled={disabled}
      onChange={(event) => setDestination({ brandId: event.target.value })}>
      {brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select></label>}
    <label>Destination folder<select ref={isFolder ? firstField : undefined} value={destination.folderId ?? ""} disabled={disabled}
      onChange={(event) => setDestination({ ...destination, folderId: event.target.value || undefined })}>
      <FolderOptions folders={folders} brandId={destination.brandId} excluded={isFolder ? target.id : undefined} />
    </select></label>
    {changingBrand && <p className="production-hint">Changing brands uses the destination brand’s context. Saved scripts go back to review.</p>}
    <div className="studio-nav-rename-actions">
      <button type="submit" disabled={disabled || unchanged}>Move</button>
      <button type="button" disabled={disabled} onClick={onClose}>Cancel</button>
    </div>
  </form>;
}

function RowActions({ target, portal, disabled, canMove, onEdit, onUp, onDown }: {
  target: TreeTarget; portal: HTMLDivElement | null; disabled: boolean; canMove: boolean;
  onEdit: (mode: EditMode, trigger: HTMLButtonElement | null) => void;
  onUp?: () => void; onDown?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingEditor = useRef(false);
  function edit(mode: EditMode) {
    openingEditor.current = mode !== "delete";
    onEdit(mode, trigger.current);
  }

  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger ref={trigger} className="studio-tree-rename" disabled={disabled}
      aria-label={`Actions for ${target.kind} ${target.name}`} title={`${target.kind === "folder" ? "Folder" : "Project"} actions`}>
      <Ellipsis size={16} aria-hidden />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal container={portal}>
      <DropdownMenu.Content className="studio-tree-menu" align="end" sideOffset={4} collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (openingEditor.current) event.preventDefault();
          openingEditor.current = false;
        }}>
        <DropdownMenu.Item onSelect={() => edit("rename")}><Pencil size={14} aria-hidden /> Rename</DropdownMenu.Item>
        {canMove && <DropdownMenu.Item onSelect={() => edit("move")}><FolderInput size={14} aria-hidden /> Move to…</DropdownMenu.Item>}
        {onUp && <DropdownMenu.Item onSelect={onUp}><ArrowUp size={14} aria-hidden /> Move up</DropdownMenu.Item>}
        {onDown && <DropdownMenu.Item onSelect={onDown}><ArrowDown size={14} aria-hidden /> Move down</DropdownMenu.Item>}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => edit("delete")}><Trash2 size={14} aria-hidden /> Delete {target.kind}</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export function FolderOptions({ folders, brandId, excluded }: { folders: StudioFolder[]; brandId: string; excluded?: string }) {
  return <><option value="">Brand root</option>{folders.filter((folder) => folder.brandId === brandId &&
    (!excluded || !studioFolderTrail(folder.id, folders).some(({ id }) => id === excluded))).map((folder) =>
    <option key={folder.id} value={folder.id}>{studioFolderTrail(folder.id, folders).map(({ name }) => name).join(" / ")}</option>)}</>;
}

export function ProjectSidebar({ organization, brands, projects, activeId, openLocation, available, saving, status, cloud, onReload, onSave, onOpen, onFolder,
  onMove, onOrder, onRenameProject, onDeleteProject, onNew, onAssets, canDeleteFolder, sidebarWidth, onResize, onHide }: {
  organization: StudioOrganization; brands: SidebarBrand[]; projects: ProjectNavigationEntry[]; activeId?: string;
  openLocation?: StudioLocation;
  available: boolean; saving: boolean; status: string; cloud: boolean; onReload: () => void;
  onSave: (organization: StudioOrganization) => Promise<boolean>; onOpen: (id: string) => void;
  onFolder: (location: StudioLocation) => void;
  onMove: (id: string, location: StudioLocation) => boolean;
  onOrder: (id: string, anchorId: string, position?: "before" | "after") => void;
  onRenameProject: (id: string, name: string) => boolean;
  onDeleteProject: (id: string) => boolean; canDeleteFolder: boolean;
  onNew: (location: StudioLocation) => void; onAssets: (location: StudioLocation) => void;
  sidebarWidth: number; onResize: (width: number) => void; onHide: () => void;
}) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StudioStage | "">("");
  const [brandFilter, setBrandFilter] = useState("");
  const [useCaseFilter, setUseCaseFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState<StudioLocation>();
  const [brandName, setBrandName] = useState("");
  const [brandContext, setBrandContext] = useState("");
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [manageBrand, setManageBrand] = useState<string>();
  const [dropTarget, setDropTarget] = useState("");
  const [editing, setEditing] = useState<{ mode: EditMode; target: TreeTarget }>();
  const [menuPortal, setMenuPortal] = useState<HTMLDivElement | null>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const currentProject = projects.find(({ id }) => id === activeId);
  const target = openLocation ?? location ?? currentProject?.location ?? { brandId: studioUnassigned };
  const needle = search.toLocaleLowerCase().trim();
  const useCases = [...new Set(projects.map(({ useCase }) => useCase.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const tags = [...new Map(projects.flatMap((project) => project.tags).map((tag) => [tag.toLocaleLowerCase(), tag])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = projects.filter((project) => (!stage || project.stage === stage) &&
    (!brandFilter || project.location.brandId === brandFilter) &&
    (!useCaseFilter || project.useCase.trim() === useCaseFilter) &&
    (!tagFilter || project.tags.some((tag) => tag.toLocaleLowerCase() === tagFilter)) &&
    (needle ? `${project.title} ${project.useCase} ${project.tags.join(" ")} ${studioStages[project.stage]}`.toLocaleLowerCase().includes(needle) : project.stage !== "archived" || stage === "archived"));
  const filterOn = Boolean(needle || stage || useCaseFilter || tagFilter);
  const locked = saving || !available;

  function toggle(id: string, fallback: boolean) {
    setExpanded((current) => ({ ...current, [id]: !(current[id] ?? fallback) }));
  }

  function reveal(destination: StudioLocation) {
    const ancestors = studioFolderTrail(destination.folderId, organization.folders);
    setExpanded((current) => ({ ...current, [destination.brandId]: true, ...Object.fromEntries(ancestors.map(({ id }) => [id, true])) }));
  }

  async function moveEntry(entry: TreeTarget, destination: StudioLocation) {
    setFolderMessage("");
    if (entry.kind === "folder" && destination.brandId !== entry.location.brandId) {
      setFolderMessage("Move folders within their current brand.");
      return false;
    }
    const saved = entry.kind === "project" ? onMove(entry.id, destination)
      : await onSave({ ...organization, folders: organization.folders.map((folder) => folder.id === entry.id
        ? { ...folder, parentId: destination.folderId ?? null } : folder) });
    if (saved) {
      reveal(destination);
      if (entry.kind === "project" && entry.id === activeId) setLocation(destination);
    }
    return saved;
  }

  function beginEdit(mode: EditMode, entry: TreeTarget, trigger: HTMLButtonElement | null) {
    setFolderMessage("");
    if (mode === "delete" && entry.kind === "folder") {
      if (organization.folders.some(({ parentId }) => parentId === entry.id) || projects.some(({ location }) => location.folderId === entry.id)) {
        setFolderMessage("Move the projects and subfolders first, then delete this folder.");
        return;
      }
      if (!canDeleteFolder) {
        setFolderMessage("Wait for your project changes to finish saving before deleting this folder.");
        return;
      }
    }
    editTrigger.current = trigger;
    setEditing({ mode, target: entry });
  }

  function closeEditor() {
    const trigger = editTrigger.current;
    setEditing(undefined);
    requestAnimationFrame(() => trigger?.focus());
  }

  async function saveRename(entry: TreeTarget, name: string) {
    if (entry.kind === "project") return onRenameProject(entry.id, name);
    return onSave({ ...organization, folders: organization.folders.map((folder) => folder.id === entry.id ? { ...folder, name } : folder) });
  }

  function rowEditor(entry: TreeTarget, disabled: boolean) {
    if (editing?.target.id !== entry.id || editing.target.kind !== entry.kind) return null;
    if (editing.mode === "delete") return <div className="studio-nav-rename" role="group" aria-label={`Confirm deleting ${entry.name}`}>
      <p className="production-hint">Delete “{entry.name}”?</p>
      {entry.kind === "project" && cloud && <p className="production-hint">Saved revisions remain in Version history.</p>}
      <div className="studio-nav-rename-actions">
        <button type="button" disabled={disabled} onClick={closeEditor}>Cancel</button>
        <button type="button" disabled={disabled} onClick={async () => {
          if (entry.kind === "project" ? onDeleteProject(entry.id) : await deleteFolder(entry.id)) closeEditor();
        }}>Delete</button>
      </div>
    </div>;
    if (editing.mode === "move") return <MoveEditor target={entry} brands={brands} folders={organization.folders}
      disabled={disabled || locked} onClose={closeEditor} onSave={(destination) => moveEntry(entry, destination)} />;
    return <RenameEditor target={editing.target} disabled={disabled} onClose={closeEditor} onSave={(name) => saveRename(entry, name)} />;
  }

  function orderFolder(folder: StudioFolder, adjacent: StudioFolder) {
    const items = [...organization.folders];
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
      const destination = { brandId: folder.brandId, folderId: folder.id };
      openFolder(destination);
      setExpanded((current) => ({ ...current, [folder.brandId]: true, [folder.parentId ?? folder.brandId]: true, [folder.id]: true }));
    }
  }

  function openFolder(destination: StudioLocation) {
    setLocation(destination);
    setCreatingFolder(false);
    setFolderMessage("");
    setExpanded((current) => ({ ...current, [destination.folderId ?? destination.brandId]: true }));
    onFolder(destination);
  }

  async function deleteFolder(id: string) {
    const folder = organization.folders.find((entry) => entry.id === id);
    if (!folder) return false;
    if (organization.folders.some(({ parentId }) => parentId === folder.id) ||
        projects.some(({ location }) => location.folderId === folder.id)) {
      setFolderMessage("Move the projects and subfolders first, then delete this folder.");
      return false;
    }
    if (!canDeleteFolder) {
      setFolderMessage("Wait for your project changes to finish saving before deleting this folder.");
      return false;
    }
    if (await onSave({ ...organization, folders: organization.folders.filter(({ id }) => id !== folder.id) })) {
      if (target.folderId === folder.id) openFolder({ brandId: folder.brandId, folderId: folder.parentId ?? undefined });
      setFolderMessage("Folder deleted.");
      return true;
    }
    return false;
  }

  function allowDrop(event: DragEvent, key: string, allowFolder: boolean) {
    if (locked || !(event.dataTransfer.types.includes(projectMime) || (allowFolder && event.dataTransfer.types.includes(folderMime)))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  }

  function receive(event: DragEvent, destination: StudioLocation) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget("");
    if (locked) return;
    const project = projects.find(({ id }) => id === event.dataTransfer.getData(projectMime));
    if (project) void moveEntry({ id: project.id, kind: "project", name: project.title, location: project.location }, destination);
    const folder = organization.folders.find(({ id }) => id === event.dataTransfer.getData(folderMime));
    if (folder && folder.id !== destination.folderId && (folder.parentId !== (destination.folderId ?? null) || folder.brandId !== destination.brandId)) {
      void moveEntry({ id: folder.id, kind: "folder", name: folder.name,
        location: { brandId: folder.brandId, folderId: folder.parentId ?? undefined } }, destination);
    }
  }

  function renderProjects(destination: StudioLocation) {
    const siblings = filtered.filter(({ location }) => location.brandId === destination.brandId && location.folderId === destination.folderId);
    return siblings.map((project, index) => {
      const entry: TreeTarget = { id: project.id, kind: "project", name: project.title, location: project.location };
      const previous = siblings[index - 1];
      const next = siblings[index + 1];
      return <li key={project.id} className="studio-tree-project">
        <div className="studio-tree-project-row">
          <button className="studio-tree-project-label" type="button" aria-current={activeId === project.id ? "page" : undefined} draggable={!locked && !project.locked}
            data-drop={dropTarget === project.id} onDragOver={(event) => allowDrop(event, project.id, false)}
            onDragLeave={() => setDropTarget("")} onDrop={(event) => {
              event.preventDefault(); event.stopPropagation(); setDropTarget("");
              const from = projects.find(({ id }) => id === event.dataTransfer.getData(projectMime));
              if (!from || from.location.brandId !== project.location.brandId || from.location.folderId !== project.location.folderId) return;
              const anchor = event.currentTarget.getBoundingClientRect();
              onOrder(from.id, project.id, event.clientY < anchor.top + anchor.height / 2 ? "before" : "after");
            }} onDragStart={(event) => {
              event.dataTransfer.setData(projectMime, project.id); event.dataTransfer.effectAllowed = "move";
            }} onDragEnd={() => setDropTarget("")} onClick={() => { setLocation(project.location); onOpen(project.id); }}>
            <span>{project.title}</span><small>{[studioStages[project.stage], project.useCase, project.variation ? "Variation" : ""].filter(Boolean).join(" · ")}</small>
          </button>
          <RowActions target={entry} portal={menuPortal} disabled={project.locked} canMove={!locked}
            onEdit={(mode, trigger) => beginEdit(mode, entry, trigger)}
            onUp={previous ? () => onOrder(project.id, previous.id) : undefined}
            onDown={next ? () => onOrder(project.id, next.id, "after") : undefined} />
        </div>
        {rowEditor(entry, project.locked)}
      </li>;
    });
  }

  function renderFolders(brandId: string, parentId: string | null): React.ReactNode {
    const siblings = organization.folders.filter((folder) => folder.brandId === brandId && folder.parentId === parentId &&
      (!filterOn || filtered.some((entry) => studioFolderTrail(entry.location.folderId, organization.folders).some(({ id }) => id === folder.id))));
    return siblings.map((folder, index) => {
        const open = expanded[folder.id] ?? filterOn;
        const destination = { brandId, folderId: folder.id };
        const entry: TreeTarget = { id: folder.id, kind: "folder", name: folder.name, location: { brandId, folderId: parentId ?? undefined } };
        const previous = siblings[index - 1];
        const next = siblings[index + 1];
        return <li key={folder.id}>
          <div className="studio-tree-row" data-location={target.folderId === folder.id} data-drop={dropTarget === folder.id}
            onDragOver={(event) => allowDrop(event, folder.id, true)} onDragLeave={() => setDropTarget("")} onDrop={(event) => receive(event, destination)}>
            <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={open} onClick={() => toggle(folder.id, filterOn)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button className="studio-tree-label" type="button" draggable={!locked} onDragStart={(event) => {
              event.dataTransfer.setData(folderMime, folder.id); event.dataTransfer.effectAllowed = "move";
            }} onDragEnd={() => setDropTarget("")} onClick={() => openFolder(destination)}><Folder size={14} aria-hidden />{folder.name}</button>
            {available && <RowActions target={entry} portal={menuPortal} disabled={locked} canMove
              onEdit={(mode, trigger) => beginEdit(mode, entry, trigger)}
              onUp={previous ? () => orderFolder(folder, previous) : undefined}
              onDown={next ? () => orderFolder(folder, next) : undefined} />}
          </div>
          {rowEditor(entry, locked)}
          {open && <ul>{renderFolders(brandId, folder.id)}{renderProjects(destination)}</ul>}
        </li>;
      });
  }

  const CloseIcon = organization.sidebar.side === "left" ? PanelLeftClose : PanelRightClose;
  return <nav id={projectSidebarId} className="studio-project-navigation" aria-label="Studio project navigation">
    <header><h3>Projects</h3>
      <button type="button" title="Hide Projects sidebar" aria-label="Hide Projects sidebar" disabled={saving} onClick={onHide}>
        <CloseIcon size={16} aria-hidden /> Hide
      </button>
    </header>
    {saving && <p className="production-hint" role="status">Saving workspace…</p>}
    {status && <p role="status">{status} <button type="button" onClick={onReload}>Reload</button></p>}
    {folderMessage && <p role="status">{folderMessage}</p>}
    <label className="studio-project-search"><Search size={15} aria-hidden /><input aria-label="Search projects" value={search} placeholder="Title, tag or use case" onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="studio-nav-filters">
      <label>Brand<select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
        <option value="">All brands</option>{brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Stage<select value={stage} onChange={(event) => setStage(event.target.value as StudioStage | "")}>
        <option value="">Active stages</option>{Object.entries(studioStages).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    {useCases.length > 0 && <label>Use case<select value={useCaseFilter} onChange={(event) => setUseCaseFilter(event.target.value)}>
      <option value="">All use cases</option>{useCases.map((name) => <option key={name}>{name}</option>)}</select></label>}
    {tags.length > 0 && <label>Tag<select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
      <option value="">All tags</option>{tags.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>}
    <div className="studio-nav-tools">
      <button type="button" onClick={() => onNew(target)}><Plus size={14} /> New project</button>
      {available && <button type="button" disabled={locked} onClick={() => { setCreatingFolder(!creatingFolder); setFolderMessage(""); }}>New folder</button>}
      {cloud && available && <button type="button" onClick={() => onAssets(target)}><LibraryBig size={14} /> Brand assets</button>}
    </div>
    {creatingFolder && <form className="studio-nav-edit" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
      <fieldset disabled={locked}>
        <label>New folder name<input maxLength={90} value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
        <p className="production-hint">Inside {brands.find(({ id }) => id === target.brandId)?.name}{target.folderId ? ` / ${organization.folders.find(({ id }) => id === target.folderId)?.name}` : ""}</p>
        <button type="submit" disabled={!folderName.trim()}>Create folder</button>
      </fieldset>
    </form>}
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
            <button className="studio-tree-label" type="button" onClick={() => openFolder(destination)}>
              {name}<small>{filtered.filter(({ location }) => location.brandId === id).length}</small>
            </button>
          </div>
          {open && <ul>{renderFolders(id, null)}{renderProjects(destination)}</ul>}
        </li>;
      })}
    </ul>
    <div ref={setMenuPortal} />
    {!filtered.length && <p className="production-hint">No projects match this view.</p>}
    {available && <details className="studio-nav-settings">
      <summary>Organize workspace</summary>
      <fieldset disabled={locked}>
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
        <label>Sidebar width<select value={organization.sidebar.width} onChange={(event) => onResize(Number(event.target.value))}>
          {![204, 244, 320].includes(organization.sidebar.width) && <option value={organization.sidebar.width}>Custom · {organization.sidebar.width}px</option>}
          <option value={204}>Compact</option><option value={244}>Standard</option><option value={320}>Wide</option>
        </select></label>
      </fieldset>
    </details>}
    <SidebarResize width={sidebarWidth} side={organization.sidebar.side} disabled={locked} onCommit={onResize} />
  </nav>;
}
