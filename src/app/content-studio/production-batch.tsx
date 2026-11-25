"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Clapperboard, CopyPlus, Download, LibraryBig, PanelLeft, PanelRight, Plus, X } from "lucide-react";
import { createTask, getSecondSpringContext, getTask, startStudioRun, studioMediaUrl, studioProviderStatus, uploadStudioMedia, type StudioProviderStatus } from "@/lib/agent/client";
import { studioMediaPerProject, type StudioMedia } from "@/lib/studio/media-types";
import { matchesStudioSource, type StudioAlternative, type StudioRun } from "@/lib/studio/runs";
import { brandBrief, chosenFrames, frameOptions, overlayPositions, parseVideoPlan, planningPrompt, productionTools, readVideoPlan, videoTypes, type VideoPlan, type VideoRatio, type VideoSpec } from "./production";
import { productionFiles, productionZip, videoDimensions, type ApprovedVideo } from "./production-package";
import { ReferenceInputs } from "./production-inputs";
import { NarrationOptions } from "./narration-options";
import { ProjectAgent } from "./project-agent";
import { StoryWorkflowPanel } from "./story-workflow-panel";
import { TopicResearch } from "./topic-research";
import { SubscribrPanel } from "./subscribr-panel";
import { OfferPlanning } from "./offer-planning";
import { savedContentInventory } from "@/lib/studio/campaign-input";
import type { KeywordBoard } from "@/lib/studio/keyword-research";
import { storyLabels, storyStyles } from "./story-workflow";
import type { StoryEdit } from "./story-timeline";
import { useStudioDrafts } from "./use-studio-drafts";
import { platforms } from "./workflow";
import { ProductionViewPanel, ShotBoard, VisualProduction } from "./visual-production";
import { productionViews, type ProductionView } from "./production-views";
import { BrandAssetLibrary } from "./brand-asset-library";
import { FolderOptions, ProjectSidebar, projectSidebarId, type ProjectNavigationEntry, type SidebarBrand } from "./project-sidebar";
import { useStudioOrganization } from "./use-studio-organization";
import { studioBatchLimit, studioFolderTrail, studioProjectLimit, studioProjectLocation, studioSecondSpring, studioStages, studioUnassigned,
  type StudioLocation, type StudioProjectOrganization, type StudioStage } from "@/lib/studio/organization";

type Item = {
  spec: VideoSpec;
  kit: "custom" | "second-spring";
  script: string;
  approved?: ApprovedVideo;
  taskId?: string;
  pending?: boolean;
  error?: string;
  context?: string;
  stale?: boolean;
  variationOf?: string;
  variationLabel?: string;
  renders?: StudioMedia[];
  storyEdit?: StoryEdit;
  shotReferences?: Record<number, string>;
  campaignCreative?: { runId: string; intent: string };
  organization?: StudioProjectOrganization;
};

const storageKey = "mahara:video-production:v1";
const limit = studioProjectLimit;

function blank(): Item {
  return { spec: { id: crypto.randomUUID(), keyword: "", brand: "", customContext: "", type: "skit", duration: 30, ratio: "9:16", reference: "" }, kit: "custom", script: "" };
}

const sampleShape = '{"title":"My video","caption":"Social caption","shots":[{"end":5,"narration":"Opening line","visual":"Describe the shot","overlay":"Opening text","sound":"Sound cue","asset":"Footage to record"}]}';
const blankKeywordBoard: KeywordBoard = { seed: "", objective: "answer", rows: [], shortlist: [] };

function projectTitle(item: Item, index: number) {
  return item.organization?.title || item.variationLabel || item.spec.keyword.trim() || `Video ${index + 1}`;
}

function completionStage(item: Item): StudioStage {
  if (item.organization?.stage) return item.organization.stage;
  if (item.pending) return "scripting";
  if (item.stale) return "brief";
  if (item.renders?.length) return "ready";
  if (item.approved) return "production";
  return item.script.trim() ? "review" : "brief";
}

function itemPlan(item: Item | undefined) {
  if (item?.approved) return item.approved.plan;
  if (!item?.script.trim()) return;
  try { return parseVideoPlan(item.script); } catch { /* The original draft can still be edited. */ }
}

export function ProductionBatch({ canLoadBrand, signedIn, draftKey, stage, onStage }: {
  canLoadBrand: boolean; signedIn: boolean; draftKey?: string; stage: number; onStage: (stage: number) => void;
}) {
  const drafts = useStudioDrafts<Item>(draftKey, storageKey + (canLoadBrand ? ":owner" : ":personal"), blank);
  const workspace = useStudioOrganization(Boolean(draftKey));
  const { items, setItems, hydrated } = drafts;
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState<{ name: string; context: string } | null>(null);
  const [brandStatus, setBrandStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [providers, setProviders] = useState<StudioProviderStatus>();
  const [version, setVersion] = useState("");
  const [versionPending, setVersionPending] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<ProductionView>("brief");
  const [selectedShot, setSelectedShot] = useState(0);
  const [activity, setActivity] = useState(0);
  const [savedResearch, setSavedResearch] = useState<{ videoId: string; csv?: string }>();
  const [libraryLocation, setLibraryLocation] = useState<StudioLocation>();
  const [sidebarWidthPreview, setSidebarWidthPreview] = useState<number>();
  const [sidebarCollapsedOverride, setSidebarCollapsedOverride] = useState<boolean>();
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const previewUrls = useRef(new Map<string, string>());
  const dispatchLock = useRef(false);
  const sidebar = workspace.data.sidebar;
  const sidebarCollapsed = sidebarCollapsedOverride ?? sidebar.collapsed;
  const sidebarWidth = sidebarWidthPreview ?? sidebar.width;
  const SidebarIcon = sidebar.side === "left" ? PanelLeft : PanelRight;
  const brands: SidebarBrand[] = [
    ...(canLoadBrand ? [{ id: studioSecondSpring, name: connected?.name ?? "Second Spring" }] : []),
    ...workspace.data.brands, { id: studioUnassigned, name: "Unassigned" },
  ];

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!canLoadBrand) return;
    let active = true;
    void studioProviderStatus().then((status) => { if (active) setProviders(status); }).catch(() => {});
    void getSecondSpringContext().then((source) => {
      if (!active || !source.registry?.name || !source.kits.length) {
        if (active) setBrandStatus("unavailable");
        return;
      }
      setConnected({ name: source.registry.name, context: brandBrief(source) });
      setBrandStatus("ready");
    }).catch(() => { if (active) setBrandStatus("unavailable"); });
    return () => { active = false; };
  }, [canLoadBrand]);

  const pendingTasks = items.filter((item) => item.pending && item.taskId)
    .map(({ spec, taskId }) => [spec.id, taskId!] as const);
  const pendingKey = JSON.stringify(pendingTasks);
  useEffect(() => {
    const tasks = JSON.parse(pendingKey) as [string, string][];
    if (!tasks.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await Promise.all(tasks.map(async ([id, taskId]) => {
        try {
          const { task, events } = await getTask(taskId);
          if (stopped || !["completed", "error", "stopped"].includes(task.status)) return;
          const result = events.findLast((event) => event.type === "message.completed");
          setItems((current) => current.map((item) => item.spec.id === id && item.taskId === taskId && item.pending
            ? { ...item, pending: false, stale: task.status !== "completed" && item.stale, script: task.status === "completed" ? result?.text ?? "" : item.script,
                error: task.status === "completed" ? undefined : "Open the script task to review its status before retrying." }
            : item));
        } catch { /* A transient poll failure should not submit another task. */ }
      }));
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pendingKey, setItems]);

  function patch(id: string, change: (item: Item) => Item) {
    setItems((rows) => rows.map((item) => item.spec.id === id ? change(item) : item));
  }

  function clearPreview(id: string) {
    const url = previewUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(id);
    setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  }

  function edit(id: string, change: Partial<VideoSpec> | ((spec: VideoSpec) => Partial<VideoSpec>)) {
    clearPreview(id);
    patch(id, (item) => {
      const changes = typeof change === "function" ? change(item.spec) : change;
      const spec = { ...item.spec, ...changes };
      if (spec.keyword.trim() !== item.spec.keyword.trim() || spec.brand !== item.spec.brand) spec.activeResearchBriefId = undefined;
      if (spec.brand.trim().toLowerCase() !== item.spec.brand.trim().toLowerCase()) spec.offer = undefined;
      if (Object.keys(changes).length === 1 && "media" in changes) {
        const approved = item.approved ? { ...item.approved, spec } : undefined;
        const storyEdit = item.storyEdit ? { ...item.storyEdit, storyboardApproved: undefined } : undefined;
        return { ...item, spec, approved, storyEdit };
      }
      return { ...item, spec, approved: undefined, storyEdit: undefined, stale: Boolean(item.script.trim()), context: undefined, error: undefined };
    });
  }

  async function contextFor(item: Item, cached?: string) {
    if (item.kit !== "second-spring") {
      const brand = workspace.data.brands.find(({ id }) => id === item.organization?.brandId);
      return (brand?.context ?? item.spec.customContext).trim();
    }
    if (!canLoadBrand) throw new Error("Sign in as owner to use the connected Second Spring kit.");
    return cached ?? connected?.context ?? brandBrief(await getSecondSpringContext());
  }

  async function generateScripts() {
    if (dispatchLock.current) return;
    const selected = items.filter((item) => completionStage(item) !== "archived" && item.spec.keyword.trim() &&
      (!item.script.trim() || item.stale) && !item.pending && !item.approved).slice(0, studioBatchLimit);
    if (!selected.length) return;
    dispatchLock.current = true;
    setDispatching(true);
    setNotice("");
    try {
      if (draftKey) {
        if (!drafts.savedRevision) { setNotice("Wait for the projects to save before queuing scripts."); return; }
        const revision = drafts.savedRevision;
        const results = await Promise.allSettled(selected.map(({ spec }) => startStudioRun({
          kind: "script", id: crypto.randomUUID(), videoId: spec.id, revision,
        })));
        const queued = results.filter(({ status }) => status === "fulfilled").length;
        setNotice(`${queued} of ${results.length} scripts queued. Open each project to review its run.${queued < results.length ? " Check projects with an existing run or unsaved changes." : ""}`);
        setActivity((count) => count + 1);
        return;
      }
      let connected: string | undefined;
      for (const item of selected) {
        const id = item.spec.id;
        try {
          const context = await contextFor(item, connected);
          if (item.kit === "second-spring") connected = context;
          const { task } = await createTask({ mode: "standard", interaction: "chat", prompt: planningPrompt(item.spec, context) });
          patch(id, (row) => ({ ...row, pending: true, taskId: task.id, context, error: undefined }));
        } catch {
          patch(id, (row) => ({ ...row, error: "The script task was not confirmed. Check your tasks before retrying." }));
          setNotice("Dispatch paused. Review the task status before submitting another batch.");
          break;
        }
      }
    } finally {
      dispatchLock.current = false;
      setDispatching(false);
    }
  }

  async function approve(item: Item) {
    try {
      const plan = readVideoPlan(item.script, item.spec.duration);
      const context = item.context ?? await contextFor(item);
      patch(item.spec.id, (row) => row.script === item.script && row.spec === item.spec && row.kit === item.kit
        ? { ...row, approved: { spec: row.spec, plan, brandContext: context }, error: undefined } : row);
    } catch (error) {
      patch(item.spec.id, (row) => ({ ...row, error: error instanceof Error ? error.message : "The script could not be approved." }));
    }
  }

  async function previewFile(item: Item, file: File) {
    const id = item.spec.id;
    clearPreview(id);
    const url = URL.createObjectURL(file);
    previewUrls.current.set(id, url);
    setPreviews((current) => ({ ...current, [id]: url }));
    patch(id, (row) => ({ ...row, error: undefined }));
    if (!draftKey) return;
    setUploading((current) => ({ ...current, [id]: true }));
    try {
      const media = await uploadStudioMedia(file);
      patch(id, (row) => ({ ...row, renders: [...(row.renders ?? []), media] }));
    } catch {
      patch(id, (row) => ({ ...row, error: "The preview is available in this tab. Private upload failed, so the file was not saved." }));
    } finally { setUploading((current) => ({ ...current, [id]: false })); }
  }

  function writeScript(id: string, script: string) {
    clearPreview(id);
    patch(id, (row) => ({ ...row, script, approved: undefined, stale: false, error: undefined }));
  }

  function copyDraft(item: Item, keepRender: boolean): Item {
    const { spec, kit, script, stale, variationLabel, storyEdit, campaignCreative } = item;
    const organization = item.organization ? { ...item.organization, stage: undefined,
      title: item.organization.title ? `${item.organization.title.slice(0, 107)} · Variation` : undefined } : undefined;
    return { spec: { ...spec, id: crypto.randomUUID() }, kit, script, stale, variationOf: item.variationOf ?? spec.id, variationLabel, campaignCreative,
      organization, shotReferences: item.shotReferences,
      ...(keepRender ? { renders: item.renders, storyEdit } : {}) };
  }

  function addCopies(source: Item[], keepRender: boolean) {
    if (!source.length || items.length + source.length > limit) {
      setNotice(`This workspace holds up to ${limit} projects. Free space before opening these copies.`);
      return false;
    }
    const copies = source.map((item) => copyDraft(item, keepRender));
    setItems((current) => current.length + copies.length > limit ? current : [...current, ...copies]);
    setProjectId(copies[0].spec.id);
    setSelectedShot(0);
    setNotice(keepRender ? "Saved revision opened as editable copies." : "Variation added. The original is still in your batch.");
    return true;
  }

  function applyLocation(item: Item, location: StudioLocation): Item {
    const prior = studioProjectLocation(item, workspace.data);
    const organization = { ...item.organization, ...location, folderId: location.folderId };
    if (prior.brandId === location.brandId) return { ...item, organization };
    const brand = brands.find(({ id }) => id === location.brandId);
    if (!brand) return item;
    const kit = location.brandId === studioSecondSpring ? "second-spring" : "custom";
    return { ...item, kit, organization: { ...organization, stage: item.organization?.stage === "archived" ? "archived" : undefined },
      approved: undefined, stale: Boolean(item.script.trim()), context: undefined,
      spec: { ...item.spec, brand: brand.id === studioUnassigned ? "" : brand.name, customContext: brand.context ?? "",
        activeResearchBriefId: undefined, offer: undefined, subscribrWriting: undefined, subscribrSource: undefined } };
  }

  function addVideo(location: StudioLocation = { brandId: studioUnassigned }) {
    if (!hydrated || dispatching || items.length >= limit) return;
    const item = blank();
    setItems((rows) => rows.length < limit ? [...rows, applyLocation(item, location)] : rows);
    setProjectId(item.spec.id);
    setSelectedShot(0);
  }

  function loadRunPlan(item: Item, run: StudioRun, copy: boolean) {
    if (!run.state.plan || run.phase !== "complete") return;
    const script = JSON.stringify(run.state.plan, null, 2);
    if (copy) {
      addCopies([{ spec: run.input.spec, kit: run.input.kit, script, variationLabel: run.state.plan.title }], false);
      return;
    }
    if (!matchesStudioSource(run, item, drafts.savedRevision)) return;
    patch(item.spec.id, (row) => ({ ...row, script, stale: false, error: undefined,
      approved: { spec: row.spec, plan: run.state.plan!, brandContext: run.input.brief.brandContext ?? "" } }));
  }

  function openCampaign(run: StudioRun) {
    const campaign = run.state.campaign;
    const strategy = campaign?.strategy;
    if (run.phase !== "complete" || !campaign?.creatives?.length || !strategy || !run.input.campaign) return;
    const { spec, kit } = run.input;
    const copies: Item[] = campaign.creatives.flatMap((creative) => {
      if (items.some(({ campaignCreative }) => campaignCreative?.runId === run.id && campaignCreative.intent === creative.intent)) return [];
      const slot = strategy.slots.find(({ intent }) => intent === creative.intent);
      if (!slot) return [];
      const notes = [`Editorial slot: ${slot.placement} · ${slot.intent}`, `Planned topic: ${slot.topic}`, `Audience question: ${slot.audienceQuestion}`, `First frame: ${creative.firstFrame}`,
        `Thumbnail: ${creative.thumbnail} · ${creative.thumbnailDirection}`, ...creative.assumptions, spec.reference].filter(Boolean).join("\n\n");
      return [{ spec: { ...spec, keyword: slot.topic.length <= 180 ? slot.topic : creative.plan.title, reference: notes.slice(0, 6000), activeResearchBriefId: undefined }, kit,
        script: JSON.stringify(creative.plan, null, 2), variationLabel: creative.plan.title, campaignCreative: { runId: run.id, intent: creative.intent } }];
    });
    if (!copies.length) { setNotice("These approved creatives are already in your projects."); return; }
    if (addCopies(copies, false)) setNotice(`${copies.length} approved campaign creatives opened as editable video variations.`);
  }

  function applySuggestion(item: Item, run: StudioRun, option: StudioAlternative, copy: boolean) {
    const selection = run.input.suggestion;
    if (!selection || selection.action === "review") return;
    if (selection.action === "angles" || selection.action === "story-pitches") {
      const direction = ["Creative direction: " + option.text, option.overlay && "Thumbnail text: " + option.overlay,
        option.sourceToCheck && "Source or assumption to check: " + option.sourceToCheck].filter(Boolean).join("\n");
      if (copy) addCopies([{ spec: { ...run.input.spec, reference: [direction, run.input.spec.reference].filter(Boolean).join("\n\n").slice(0, 6000) },
        kit: run.input.kit, script: "", variationLabel: option.label }], false);
      return;
    }
    if (!copy && !matchesStudioSource(run, item, drafts.savedRevision)) return;
    try {
      const original = parseVideoPlan(run.input.script);
      const plan = selection.action === "caption" ? { ...original, caption: option.text } : {
        ...original, shots: original.shots.map((entry, index) => index !== selection.shot ? entry : selection.action === "visual"
          ? { ...entry, visual: option.text, overlay: option.overlay ?? entry.overlay, overlayPosition: option.overlayPosition ?? entry.overlayPosition }
          : { ...entry, narration: option.text }),
      };
      const script = JSON.stringify(plan, null, 2);
      readVideoPlan(script, run.input.spec.duration);
      if (copy) addCopies([{ spec: run.input.spec, kit: run.input.kit, script, variationLabel: option.label }], false);
      else writeScript(item.spec.id, script);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The suggestion does not fit this plan.");
    }
  }

  async function openVersion() {
    if (!version) return;
    setVersionPending(true);
    try { addCopies(await drafts.readVersion(Number(version)), true); }
    catch { setNotice("Could not open this revision. Try again."); }
    finally { setVersionPending(false); }
  }

  function chooseKit(id: string, kit: Item["kit"], custom?: VideoSpec) {
    clearPreview(id);
    const brand = kit === "second-spring" ? connected?.name ?? "Second Spring" : custom?.brand ?? "";
    patch(id, (row) => ({ ...row, kit, approved: undefined, context: undefined, stale: Boolean(row.script.trim()),
      organization: { ...row.organization, brandId: undefined, folderId: undefined },
      spec: { ...row.spec, brand, customContext: kit === "custom" ? custom?.customContext ?? "" : "", activeResearchBriefId: undefined,
        offer: row.kit === kit && row.spec.brand === brand ? row.spec.offer : undefined } }));
  }

  const approved = items.flatMap((item) => !item.approved || completionStage(item) === "archived" || (item.kit === "second-spring" && !canLoadBrand) ? [] : [item.approved]);
  const activeId = items.find(({ spec }) => spec.id === projectId)?.spec.id ?? items[0]?.spec.id;
  const activeItem = items.find(({ spec }) => spec.id === activeId);
  const activePlan = itemPlan(activeItem);
  const projects: ProjectNavigationEntry[] = items.map((item, index) => ({
    id: item.spec.id, title: projectTitle(item, index), stage: completionStage(item), useCase: item.organization?.useCase ?? "",
    location: studioProjectLocation(item, workspace.data), variation: Boolean(item.variationOf),
  }));
  const ready = Math.min(studioBatchLimit, items.filter((item) => completionStage(item) !== "archived" && item.spec.keyword.trim() &&
    (!item.script.trim() || item.stale) && !item.pending && !item.approved).length);

  function moveProject(id: string, location: StudioLocation) {
    if (!workspace.available || !brands.some((brand) => brand.id === location.brandId)) return;
    if (location.folderId && !workspace.data.folders.some((folder) => folder.id === location.folderId && folder.brandId === location.brandId)) return;
    patch(id, (item) => item.pending || dispatching || uploading[id] ? item : applyLocation(item, location));
  }

  function orderProject(id: string, beforeId: string) {
    if (id === beforeId || dispatching) return;
    setItems((rows) => {
      const current = rows.find((row) => row.spec.id === id);
      if (!current || !rows.some((row) => row.spec.id === beforeId)) return rows;
      return rows.flatMap((row) => row.spec.id === id ? [] : row.spec.id === beforeId ? [current, row] : [row]);
    });
  }

  function attachLibraryAsset(asset: StudioMedia, shot?: number) {
    if (!activeItem || activeItem.pending || dispatching || uploading[activeItem.spec.id]) return false;
    const media = activeItem.spec.media ?? [];
    if (media.length >= studioMediaPerProject && !media.some(({ id }) => id === asset.id)) {
      setNotice("Remove a project attachment to make room for this asset.");
      return false;
    }
    patch(activeItem.spec.id, (item) => {
      const references = item.spec.media ?? [];
      const spec = references.some(({ id }) => id === asset.id) ? item.spec : { ...item.spec, media: [...references, asset] };
      const images = asset.type.startsWith("image/") && shot !== undefined
        ? { ...item.storyEdit?.images, [shot]: asset.id } : item.storyEdit?.images;
      return { ...item, spec, approved: item.approved ? { ...item.approved, spec } : undefined,
        shotReferences: shot === undefined ? item.shotReferences : { ...item.shotReferences, [shot]: asset.id },
        storyEdit: shot === undefined ? item.storyEdit : { ...item.storyEdit, images, storyboardApproved: undefined } };
    });
    return true;
  }

  async function toggleProjects(collapsed: boolean) {
    if (workspace.saving || workspace.loading) return;
    setSidebarCollapsedOverride(collapsed);
    if (collapsed) sidebarToggle.current?.focus({ preventScroll: true });
    if (workspace.available && await workspace.save({ ...workspace.data, sidebar: { ...sidebar, collapsed } })) {
      setSidebarCollapsedOverride(undefined);
    }
  }

  async function resizeProjects(width: number) {
    setSidebarWidthPreview(width);
    if (width !== sidebar.width) await workspace.save({ ...workspace.data, sidebar: { ...sidebar, width } });
    setSidebarWidthPreview(undefined);
  }
  function download(videos = approved) {
    const url = URL.createObjectURL(productionZip(productionFiles(videos)));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "video-production-batch.zip";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectView(next: ProductionView) {
    setView(next);
    const workflow = productionViews.find((entry) => entry.id === next);
    if (workflow && "agentStage" in workflow) onStage(workflow.agentStage);
  }

  return <section id="video-production" className="content-studio-pipeline production-batch" aria-labelledby="production-heading">
    <div className="content-studio-pipelineHeader">
      <div>
        <h2 id="production-heading"><Clapperboard size={19} aria-hidden /> Video production</h2>
        <p>Set the brand and keyword for each video. Review the scripts and shots before exporting editable projects.</p>
      </div>
    </div>
    <div className="production-actions content-studio-runActions">
      <button type="button" disabled={!hydrated || dispatching || items.length >= limit} onClick={() => addVideo(activeItem ? studioProjectLocation(activeItem, workspace.data) : undefined)}><Plus size={15} aria-hidden /> Add video</button>
      <button type="button" ref={sidebarToggle} aria-controls={projectSidebarId} aria-expanded={!sidebarCollapsed}
        aria-disabled={workspace.saving || workspace.loading} onClick={() => void toggleProjects(!sidebarCollapsed)}>
        <SidebarIcon size={15} aria-hidden /> {sidebarCollapsed ? "Show projects" : "Hide projects"}
      </button>
      {draftKey && workspace.available && sidebarCollapsed && <button type="button" onClick={() =>
        setLibraryLocation(activeItem ? studioProjectLocation(activeItem, workspace.data) : { brandId: studioUnassigned })}>
        <LibraryBig size={15} aria-hidden /> Brand assets</button>}
      {signedIn ? <button type="button" className="content-studio-runButton" disabled={!ready || dispatching || (Boolean(draftKey) && !drafts.savedRevision)}
        onClick={generateScripts}>{dispatching ? "Starting scripts…" : `Generate ${draftKey ? "batch " : ""}scripts${ready ? ` (${ready})` : ""}`}</button>
        : <Link href="/signin?next=%2Fcontent-studio">Sign in to generate scripts</Link>}
      {approved.length > 0 && <button type="button" onClick={() => download()}><Download size={15} aria-hidden /> Export approved ({approved.length})</button>}
    </div>
    {draftKey && <div className="production-sync">
      <p role="status">{({
        opening: "Opening saved drafts…", ready: "Autosave is on", saving: "Saving drafts…", saved: "Saved to Supabase",
        offline: "Cloud save unavailable. Your edits are kept in this tab.", conflict: "A newer revision exists. Open it before continuing.", local: "Saved in this tab",
      })[drafts.status]}</p>
      {drafts.status === "conflict" && <button type="button" onClick={() => void drafts.reopen()}>Open latest revision</button>}
      {drafts.status === "offline" && <button type="button" onClick={drafts.retry}>Retry cloud save</button>}
      {drafts.recovery && <button type="button" onClick={() => {
        if (drafts.recovery && addCopies(drafts.recovery, true)) drafts.clearRecovery();
      }}>Recover local edits as copies</button>}
      {!!drafts.versions.length && <details>
        <summary>Version history</summary>
        <label>Saved revision<select value={version} onChange={(event) => setVersion(event.target.value)}>
          <option value="">Choose a revision</option>
          {drafts.versions.map(({ revision, created_at }) => <option key={revision} value={revision}>Version {revision} · {new Date(created_at).toLocaleString()}</option>)}
        </select></label>
        <button type="button" disabled={!version || versionPending || dispatching} onClick={() => void openVersion()}>Open as copies</button>
      </details>}
    </div>}
    {canLoadBrand && <p className="production-hint">{brandStatus === "ready" ? `Connected brand kit: ${connected?.name} · Read-only`
      : brandStatus === "checking" ? "Checking connected brand kits…" : "Could not verify the Second Spring kit. Refresh to retry."}</p>}
    {signedIn && <p className="production-hint">Script generation uses your agent credits.</p>}
    {notice && <p role="alert">{notice}</p>}
    {sidebarCollapsed && workspace.status && <p role="status">{workspace.status}</p>}
    {libraryLocation && draftKey && workspace.available && <BrandAssetLibrary key={`${libraryLocation.brandId}:${libraryLocation.folderId ?? ""}:${activeId ?? ""}`}
      initial={libraryLocation} brands={brands} folders={workspace.data.folders}
      project={activeItem ? { title: projectTitle(activeItem, items.indexOf(activeItem)), media: activeItem.spec.media ?? [],
        shots: activePlan?.shots.length ?? 0, selectedShot: Math.min(selectedShot, Math.max(0, (activePlan?.shots.length ?? 1) - 1)),
        locked: Boolean(activeItem.pending || dispatching || uploading[activeItem.spec.id]) } : undefined}
      onAttach={attachLibraryAsset} onClose={() => setLibraryLocation(undefined)} />}
    <div className="studio-project-grid studio-organized-grid" data-dock={sidebar.side} data-collapsed={sidebarCollapsed}
      style={{ "--studio-navigation-width": `${sidebarWidth}px` } as CSSProperties}>
    <ProjectSidebar organization={workspace.data} brands={brands} available={workspace.available}
      saving={workspace.saving} status={workspace.status} cloud={Boolean(draftKey)} projects={projects} activeId={activeId}
      onSave={workspace.save} onReload={workspace.reload} onOpen={(id) => {
        setProjectId(id); setSelectedShot(0);
      }} onNew={addVideo} onAssets={setLibraryLocation} onMove={moveProject} onOrder={orderProject}
      sidebarWidth={sidebarWidth} onResize={(width) => void resizeProjects(width)}
      onHide={() => void toggleProjects(true)} />
    {items.map((item, index) => {
      const { spec } = item;
      const id = spec.id;
      if (id !== activeId) return null;
      const locked = dispatching || item.pending || uploading[id];
      const previewUrl = previews[id] || (item.renders?.length ? studioMediaUrl(item.renders.at(-1)!.id) : "");
      const plan = activePlan;
      const location = studioProjectLocation(item, workspace.data);
      const siblings = projects.filter(({ location: entry }) => entry.brandId === location.brandId && entry.folderId === location.folderId);
      const position = siblings.findIndex((entry) => entry.id === id);
      const path = [brands.find((brand) => brand.id === location.brandId)?.name, ...studioFolderTrail(location.folderId, workspace.data.folders).map(({ name }) => name)].filter(Boolean);
      return <div className={`studio-project-body${draftKey ? " studio-project-body-agent" : ""}`} key={id}>
      <VisualProduction view={view} onView={selectView} />
      <article className="production-item">
        <div className="production-itemHeading">
          <h3>{projectTitle(item, index)}</h3>
          <span>{studioStages[completionStage(item)]}</span>
          <button type="button" aria-label={`Create variation of video ${index + 1}`} title="Create variation" disabled={locked || items.length >= limit} onClick={() => { addCopies([item], false); }}><CopyPlus size={15} /></button>
          <button type="button" aria-label={`Remove video ${index + 1}`} disabled={locked} onClick={() => {
            clearPreview(id);
            setItems((rows) => rows.filter((row) => row.spec.id !== id));
          }}><X size={15} /></button>
        </div>
        <p className="production-hint">{spec.brand || "Unbranded"} · {spec.duration}s · {chosenFrames(spec).join(", ")}</p>
        {workspace.available && <details className="production-inputGroup studio-project-organize">
          <summary>Project details · {path.join(" / ")}</summary>
          <fieldset disabled={locked} className="production-fields">
            <label>Project name<input value={item.organization?.title ?? ""} maxLength={120} placeholder={projectTitle(item, index)}
              onChange={(event) => patch(id, (row) => ({ ...row, organization: { ...row.organization, title: event.target.value } }))} /></label>
            <label>Use case<input value={item.organization?.useCase ?? ""} maxLength={80} placeholder="e.g. Paid ad, organic social, tutorial"
              onChange={(event) => patch(id, (row) => ({ ...row, organization: { ...row.organization, useCase: event.target.value } }))} /></label>
            <label>Project stage<select value={item.organization?.stage ?? ""} onChange={(event) => {
              const stage = event.target.value as StudioStage | "";
              patch(id, (row) => ({ ...row, organization: { ...row.organization, stage: stage || undefined } }));
            }}><option value="">Automatic · {studioStages[completionStage({ ...item, organization: undefined })]}</option>
              {Object.entries(studioStages).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <label>Project brand<select value={location.brandId} onChange={(event) => moveProject(id, { brandId: event.target.value })}>
              {brands.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Project folder<select value={location.folderId ?? ""} onChange={(event) => moveProject(id, { brandId: location.brandId, folderId: event.target.value || undefined })}>
              <FolderOptions folders={workspace.data.folders} brandId={location.brandId} /></select></label>
            <div className="content-studio-runActions production-wide">
              {position > 0 && <button type="button" onClick={() => orderProject(id, siblings[position - 1].id)}>Move project up</button>}
              {position < siblings.length - 1 && <button type="button" onClick={() => orderProject(siblings[position + 1].id, id)}>Move project down</button>}
              {draftKey && <button type="button" onClick={() => setLibraryLocation(location)}>Open brand assets</button>}
            </div>
          </fieldset>
        </details>}
        <ProductionViewPanel id="brief" active={view}>
        <fieldset disabled={locked} className="production-fields">
          <legend className="production-visually-hidden">Brief for video {index + 1}</legend>
          <label>Keyword or topic<input value={spec.keyword} maxLength={180} onChange={(e) => edit(id, { keyword: e.target.value })} /></label>
          <OfferPlanning value={spec.offer} inventory={savedContentInventory(item, items)} canDispatch={Boolean(draftKey)}
            onChange={(offer) => patch(id, (row) => ({ ...row, spec: { ...row.spec, offer } }))} />
          <label>Brand kit<select value={item.kit} onChange={(e) => {
            const value = e.target.value;
            const reuse = items.find(({ spec: other }) => other.id === value);
            chooseKit(id, value === "second-spring" ? "second-spring" : "custom", reuse?.spec);
          }}><option value="custom">{item.kit === "custom" && spec.brand ? spec.brand : "Custom or unbranded"}</option>
            {canLoadBrand && <option value="second-spring">Second Spring{brandStatus === "ready" ? " · connected" : ""}</option>}
            {items.filter((other) => other.spec.id !== id && other.kit === "custom" && other.spec.brand.trim() && other.spec.customContext.trim())
              .map(({ spec: other }) => <option key={other.id} value={other.id}>Reuse {other.brand}</option>)}
          </select></label>
          {item.kit === "custom" && <label>Brand name<input value={spec.brand} maxLength={100} onChange={(e) => edit(id, { brand: e.target.value })} /></label>}
          <label>Video type<select value={spec.type} onChange={(e) => edit(id, { type: e.target.value as VideoSpec["type"] })}>
            {Object.entries(videoTypes).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
          </select></label>
          <label>Production workflow<select value={spec.storyStyle ?? ""} onChange={(e) => {
            const style = storyStyles.find((choice) => choice === e.target.value);
            edit(id, { storyStyle: style });
          }}>
            <option value="">Standard Studio</option>
            {storyStyles.map((style) => <option key={style} value={style}>{storyLabels[style]}</option>)}
          </select></label>
          <label>Runtime<select value={spec.duration} onChange={(e) => edit(id, { duration: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 180, 300].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} seconds` : seconds === 90 ? "90 seconds" : `${seconds / 60} min`}</option>)}
          </select></label>
          <label>Audience<input value={spec.audience ?? ""} placeholder={item.kit === "second-spring" ? "Use the brand kit audience" : "Who is this for?"} maxLength={300} onChange={(e) => edit(id, { audience: e.target.value })} /></label>
          <label>Research language<input value={spec.language ?? "English"} maxLength={80} onChange={(e) => edit(id, { language: e.target.value })} /></label>
          <fieldset className="production-wide production-frames"><legend>Platforms</legend>
            {platforms.map((channel) => {
              const chosen = spec.platforms ?? [...platforms];
              const checked = chosen.includes(channel);
              return <label key={channel}><input type="checkbox" checked={checked} disabled={checked && chosen.length === 1}
                onChange={() => edit(id, { platforms: checked ? chosen.filter((value) => value !== channel) : [...chosen, channel] })} />{channel}</label>;
            })}
          </fieldset>
          <fieldset className="production-wide production-frames"><legend>Export frames</legend>
            {Object.entries(frameOptions).map(([ratio, label]) => {
              const selected = chosenFrames(spec);
              const active = selected.includes(ratio as VideoRatio);
              return <label key={ratio}><input type="checkbox" checked={active} disabled={active && selected.length === 1} onChange={() => {
                const frames = active ? selected.filter((value) => value !== ratio) : [...selected, ratio as VideoRatio];
                edit(id, { ratio: frames[0], ratios: frames });
              }} />{label} · {ratio}</label>;
            })}
          </fieldset>
          {item.kit === "custom" && <label className="production-wide">Brand context<textarea rows={2} value={spec.customContext} maxLength={5000} onChange={(e) => edit(id, { customContext: e.target.value })} placeholder="Audience, voice, approved claims and available assets" /></label>}
        </fieldset>
        </ProductionViewPanel>
        <ProductionViewPanel id="research" active={view}>
          <fieldset className="production-fields" disabled={locked}>
            <TopicResearch videoId={id} keyword={spec.keyword} language={spec.language} audience={spec.audience || (item.kit === "second-spring" ? connected?.context?.split("\n")[0]?.replace(/^Audience:\s*/, "") ?? "" : "")}
              board={spec.keywordBoard ?? blankKeywordBoard} dataForSeo={Boolean(providers?.dataForSeo)}
              spec={spec} youtube={savedResearch?.videoId === id ? savedResearch.csv : undefined}
              onBriefs={(changes, affectsScript) => affectsScript ? edit(id, changes)
                : patch(id, (row) => ({ ...row, spec: { ...row.spec, ...changes } }))}
              onBoard={(update) => patch(id, (row) => ({ ...row, spec: { ...row.spec, keywordBoard: update(row.spec.keywordBoard ?? blankKeywordBoard) } }))}
              signedIn={signedIn} savedLinks={spec.referenceLinks ?? []}
              onSave={(url) => edit(id, (current) => ({ referenceLinks: [...new Set([...(current.referenceLinks ?? []), url])].slice(0, 15) }))} />
          </fieldset>
        </ProductionViewPanel>
        <ProductionViewPanel id="narration" active={view}>
          {view === "narration" && <fieldset className="production-fields" disabled={locked}>
            <NarrationOptions voice={spec.voice} line={plan?.shots.find((shot) => shot.narration)?.narration} onChange={(voice) => edit(id, { voice })} />
          </fieldset>}
        </ProductionViewPanel>
        <ProductionViewPanel id="shots" active={view}>
          <fieldset disabled={locked} className="production-fields">
            <ReferenceInputs spec={spec} cloud={Boolean(draftKey)} onChange={(change) => edit(id, change)} />
          </fieldset>
          {draftKey && workspace.available && <div className="content-studio-runActions">
            <button type="button" onClick={() => setLibraryLocation(location)}>Open brand assets</button>
          </div>}
          {plan && <ShotBoard plan={plan} spec={spec} pinned={{ ...item.storyEdit?.images, ...item.shotReferences }}
            shotIndex={selectedShot} onSelect={setSelectedShot} canSelect={Boolean(draftKey)} locked={Boolean(locked)}
            onPin={(index, assetId) => patch(id, (row) => ({ ...row, shotReferences: { ...row.shotReferences, [index]: assetId } }))} />}
          {spec.storyStyle && <StoryWorkflowPanel key={id} approved={item.approved} duration={spec.duration} edit={item.storyEdit}
            onEdit={(storyEdit) => patch(id, (row) => row.approved === item.approved ? { ...row, storyEdit } : row)}
            onRender={async (file) => { await previewFile(item, file); selectView("review"); }} cloud={Boolean(draftKey)} />}
          {!plan && <div className="content-studio-runActions"><button type="button" onClick={() => selectView("script")}>Open script and shots</button></div>}
        </ProductionViewPanel>
        <ProductionViewPanel id="packaging" active={view}>
          {!draftKey && <p className="production-hint">Save a project to run the titles and covers stage.</p>}
          <div className="content-studio-runActions"><button type="button" onClick={() => selectView("shots")}>Choose reference images</button></div>
        </ProductionViewPanel>
        <ProductionViewPanel id="script" active={view}>
        {canLoadBrand && (providers || spec.subscribrSource || spec.subscribrWriting) && <SubscribrPanel connected={Boolean(providers?.subscribr)} current={spec.subscribrSource}
          writing={spec.subscribrWriting} locked={Boolean(locked)}
          onWriting={(subscribrWriting) => patch(id, (row) => ({ ...row, spec: { ...row.spec, subscribrWriting } }))}
          onImport={(subscribrSource) => patch(id, (row) => ({ ...row, spec: { ...row.spec, subscribrSource } }))} />}
        {item.taskId && <Link href={`/app/task/${encodeURIComponent(item.taskId)}`}>Open script task</Link>}
        {plan && <details className="production-shots" open>
          <summary>{plan.title} · {plan.shots.length} shots</summary>
          <ol>{plan.shots.map((shot, i) => <li key={i} data-selected={i === selectedShot}>
            <strong>{i ? plan.shots[i - 1].end : 0}–{shot.end}s</strong>
            <p>{shot.visual}</p>
            {shot.narration && <q>{shot.narration}</q>}
            <p>Asset · {shot.asset}　 Sound · {shot.sound}　 Overlay · {shot.overlay}</p>
            {draftKey && <button type="button" aria-pressed={i === selectedShot} onClick={() => setSelectedShot(i)}>Select shot {i + 1} for AI</button>}
          </li>)}</ol>
          <p>{plan.caption}</p>
          {plan.titleOptions && <details><summary>Alternate titles</summary><ul>{plan.titleOptions.map((title, i) => <li key={i}>{title}</li>)}</ul></details>}
          {plan.description && <details><summary>Platform description</summary><p>{plan.description}</p></details>}
        </details>}
        {plan && <details className="production-edit">
          <summary>Edit narration and shots</summary>
          <fieldset className="production-fields" disabled={locked}>
            <legend className="production-visually-hidden">Edit draft for video {index + 1}</legend>
            <label className="production-wide">Video title<input value={plan.title} maxLength={100} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, title: e.target.value || "Untitled" }, null, 2))} /></label>
            <label className="production-wide">Social caption<textarea value={plan.caption} maxLength={400} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, caption: e.target.value || "Draft caption" }, null, 2))} /></label>
            <label className="production-wide">Platform description<textarea value={plan.description ?? ""} rows={3} maxLength={1500} onChange={(e) => writeScript(id, JSON.stringify({ ...plan, description: e.target.value || undefined }, null, 2))} /></label>
            {plan.shots.map((shot, shotIndex) => {
              function change(values: Partial<VideoPlan["shots"][number]>) {
                if (!plan) return;
                writeScript(id, JSON.stringify({ ...plan, shots: plan.shots.map((entry, i) => i === shotIndex ? { ...entry, ...values } : entry) }, null, 2));
              }
              return <div className="production-wide production-shotFields" key={shotIndex}>
                <label>Shot {shotIndex + 1} end time in seconds<input type="number" min="1" step="0.1" value={shot.end} onChange={(e) => change({ end: Number(e.target.value) || 1 })} /></label>
                <label>Shot {shotIndex + 1} narration<textarea rows={2} maxLength={700} value={shot.narration} onChange={(e) => change({ narration: e.target.value })} /></label>
                <label>Shot {shotIndex + 1} visual<textarea rows={2} maxLength={450} value={shot.visual} onChange={(e) => change({ visual: e.target.value || "Describe the shot" })} /></label>
                <label>Shot {shotIndex + 1} overlay<input maxLength={100} value={shot.overlay} onChange={(e) => change({ overlay: e.target.value || "On-screen text" })} /></label>
                <label>Overlay placement<select value={shot.overlayPosition ?? "lower"} onChange={(e) => change({ overlayPosition: e.target.value as (typeof overlayPositions)[number] })}>
                  {overlayPositions.map((position) => <option key={position}>{position}</option>)}
                </select></label>
              </div>;
            })}
          </fieldset>
        </details>}
        <details id="studio-script" className="production-edit">
          <summary>{item.script ? "View or replace script data" : "Import a script and shot plan"}</summary>
          <label>Script JSON<textarea rows={7} value={item.script} maxLength={40000} disabled={locked} placeholder={sampleShape} onChange={(e) => writeScript(id, e.target.value)} /></label>
        </details>
        {item.stale && <p className="production-hint">Generate a new script or update the draft to match this brief before approving it.</p>}
        {item.error && <p role="alert">{item.error}</p>}
        {item.script.trim() && !item.approved && <div className="content-studio-runActions">
          <button type="button" disabled={locked || item.stale || !spec.keyword.trim()} onClick={() => void approve(item)}>Approve script and shots</button>
        </div>}
        </ProductionViewPanel>
        <ProductionViewPanel id="review" active={view}>
        {item.approved && <div className="content-studio-runActions">
          <button type="button" onClick={() => item.approved && download([item.approved])}>Export this project</button>
        </div>}
        {!item.approved && !item.renders?.length && <div className="content-studio-runActions">
          <button type="button" onClick={() => selectView("script")}>Review the script</button>
          {spec.storyStyle && <button type="button" onClick={() => selectView("shots")}>Open storyboard</button>}
        </div>}
        {(item.approved || item.renders?.length) ? <div id="studio-video-preview" className="production-preview">
          {item.approved && <label>{draftKey ? "Save and preview a rendered video" : "Preview a rendered video"}<input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={locked} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void previewFile(item, file);
            e.target.value = "";
          }} /></label>}
          {uploading[id] && <p role="status">Saving video privately…</p>}
          {draftKey && !!item.renders?.length && <ul aria-label="Saved renders">
            {item.renders.map((asset) => <li className="production-sourceLine" key={asset.id}>
              <button type="button" onClick={() => {
                clearPreview(id);
                setPreviews((current) => ({ ...current, [id]: studioMediaUrl(asset.id) }));
              }}>Play {asset.name}</button>
              <a href={studioMediaUrl(asset.id, true)}>Download</a>
            </li>)}
          </ul>}
          <p>{draftKey ? "Saved renders are private. Review them here before sharing." : "Playback stays on this device."}</p>
          {previews[id] && <a href={previews[id]} download>Download current preview</a>}
          {previewUrl && view === "review" && <video controls playsInline preload="metadata" src={previewUrl} onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            const aspect = video.videoWidth / video.videoHeight;
            const ratios = chosenFrames(spec);
            const matches = (!Number.isFinite(video.duration) || Math.abs(video.duration - spec.duration) <= (spec.storyStyle ? 0.25 : 0.1)) && ratios.some((ratio) => {
              const [width, height] = videoDimensions[ratio];
              return Math.abs(aspect - width / height) < 0.01;
            });
            if (!matches) patch(id, (row) => ({ ...row, error: `Preview is ${video.duration.toFixed(2)}s at ${video.videoWidth} × ${video.videoHeight}. The brief calls for ${spec.duration}s at ${ratios.join(", ")}.` }));
          }} aria-label={`Private preview of ${item.approved?.plan.title ?? spec.keyword}`} />}
        </div> : null}
        {canLoadBrand && view === "review" && item.kit === "second-spring" && /thermostat|hostage talks/i.test(spec.keyword) && <details className="production-edit">
          <summary>Hostage Talks, 2 A.M. · reference cut</summary>
          <video className="studio-review-reference" controls playsInline preload="none" src="/api/admin/second-spring/video"
            aria-label="Hostage Talks, 2 A.M. reference cut" />
        </details>}
        </ProductionViewPanel>
      </article>
      {draftKey && <ProjectAgent view={view} spec={spec} kit={item.kit} script={item.script} plan={plan} shot={selectedShot} onShot={setSelectedShot}
        revision={drafts.savedRevision} stage={stage} onStage={onStage} activity={activity} canStart={Boolean(spec.keyword.trim()) && !locked && (item.kit !== "second-spring" || brandStatus === "ready")}
        canCopy={items.length < limit} onSavedResearch={setSavedResearch} onPlan={(run, copy) => loadRunPlan(item, run, copy)}
        onCampaign={openCampaign} onSuggestion={(run, option, copy) => applySuggestion(item, run, option, copy)} />}
      </div>;
    })}
    </div>
    <details className="production-toolchain">
      <summary>Production tools and handoffs</summary>
      <ul>{productionTools.map(({ name, url, role, input }) => <li key={name}><a href={url} target="_blank" rel="noreferrer">{name}</a> · {role}. {input}</li>)}</ul>
    </details>
  </section>;
}
