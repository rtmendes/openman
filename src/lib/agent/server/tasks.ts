// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/** Task operations used by the route handlers: create, list, read, and reach a task's live runtime. */
import { brand, type ModeId } from "@/config/brand";
import type { AgentEvent, CreateTaskInput, TaskReference, TaskRole } from "@/lib/agent/types";
import { CURATED_BY_SLUG, CUSTOM_PREFIX } from "@/lib/connectors/catalog";
import { getProjectConnectors, listCustomConnectors } from "@/lib/db/connectors";
import { listKnowledge } from "@/lib/db/knowledge";
import { listProjectFiles } from "@/lib/db/projects";
import { projectAccessById } from "@/lib/db/project-members";
import { getProjectSkills } from "@/lib/db/skills";
import { agentContextFor } from "@/lib/personalization/profile";
import { isValidTaskId, toSummary, type Store, type StoredFile, type TaskPatch, type TaskRecord, type TaskView } from "@/lib/store/types";
import { fileIdFor, type FileSource } from "./files";
import { remoteComputerId } from "./remote";
import { isHiddenChild } from "./derive";
import { createRuntime, forgetRuntime, isActiveStatus, liveRuntime, openRuntime, type TaskRuntime } from "./relay";
import { extOf, MAX_REFERENCES, mergeReferences, type ExtMeta } from "./task-meta";
import { newTaskId } from "./ids";

export { newTaskId };

/** What the task routes send for a task: the store's summary plus how it runs, where it came from and the caller's role. */
export type TaskViewExt = TaskView & { interaction: "agent" | "chat" | "plan"; parentTaskId: string | null; childKind: "parallel" | "side" | null; references: TaskReference[]; branchedFrom: { taskId: string; title: string; inherited?: boolean } | null; role: TaskRole; queued?: boolean };

export function viewOf(task: TaskRecord, role: TaskRole = "owner"): TaskViewExt {
  const m = extOf(task);
  return {
    ...toSummary(task),
    interaction: m.interaction ?? "agent",
    parentTaskId: m.parentTaskId ?? null,
    childKind: m.childKind ?? null,
    references: m.references ?? [],
    branchedFrom: m.branchedFrom ? { taskId: m.branchedFrom.taskId, title: m.branchedFrom.title, ...(m.branchedFrom.inherited ? { inherited: true } : {}) } : null,
    role,
    ...(m.queued ? { queued: true } : {}),
  };
}

/** The caller's own tasks named in `ids` (others and unknown ones are dropped), as references, at most 20. */
export async function resolveReferences(store: Store, ids: string[] | undefined, exclude?: string): Promise<TaskReference[]> {
  const unique = [...new Set((ids ?? []).filter((id) => isValidTaskId(id) && id !== exclude))].slice(-MAX_REFERENCES);
  const found = await Promise.all(unique.map((id) => store.getTask(id).catch(() => null)));
  return found.filter((t): t is TaskRecord => !!t).map((t) => ({ id: t.id, title: t.title }));
}

/** A task title from the first prompt: first line, cleaned up, cut to about 60 characters. */
export function deriveTitle(prompt: string): string {
  const firstLine =
    prompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  let title = firstLine
    .replace(/^[#>*\-\s]+/, "")
    .replace(/[`*~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "New task";
  if (title.length > 60) {
    title = title.slice(0, 60);
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 30) title = title.slice(0, lastSpace);
    title = `${title.replace(/[\s,.;:!?-]+$/, "")}…`;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(brand.modes, value);
}

/** What the agent receives: the prompt plus a note about any attached files. */
function agentPrompt(input: CreateTaskInput): string {
  return input.attachments?.length ? `${input.prompt}${attachmentNote(input.attachments, !!remoteComputerId(input.target))}` : input.prompt;
}

/** The lines a message gets about its attached files: links as they are, uploaded files by path with a short text preview. */
export function attachmentNote(attachments: NonNullable<CreateTaskInput["attachments"]>, remote = false): string {
  if (!attachments.length) return "";
  const size = (n?: number) => (n === undefined ? "" : n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const list = attachments
    .map((a) => {
      if (!a.path) return `- ${a.name}: ${a.url ?? ""}`;
      // Uploaded files are on the computer already: the agent gets the path and, for text, a short preview only.
      const facts = [a.mime, size(a.size)].filter(Boolean).join(", ");
      const preview = a.preview?.trim() ? `\n  Start of the file:\n  <<<\n${a.preview.trim().slice(0, 1500)}\n  >>>` : "";
      return `- ${a.name}${facts ? ` (${facts})` : ""}: ${remote ? "on the task's computer" : "on your computer"} at ${a.path}${preview}`;
    })
    .join("\n");
  return `\n\nAttached files (open them from their paths when you need them):\n${list}`;
}

/** A readable name for a connector id: curated apps by name, custom ones by their saved name and MCP server. */
function connectorLabel(id: string, custom: Map<string, string>): string {
  if (id.startsWith(CUSTOM_PREFIX)) {
    const server = id.slice(CUSTOM_PREFIX.length);
    const name = custom.get(server);
    return name ? `${name} (custom MCP server \`${server}\`)` : `custom MCP server \`${server}\``;
  }
  return CURATED_BY_SLUG.get(id)?.name ?? id;
}

const uniq = (items: (string | undefined | null)[]) => [...new Set(items.map((x) => x?.trim()).filter((x): x is string => !!x))];

interface TaskContext {
  projectId: string | null;
  /** The project's knowledge files at creation time (file changes apply to tasks created afterwards). */
  projectFiles?: { owner: string; project: string; files: { id: string; name: string; size: number }[] };
  instructions?: string;
  connectors?: string[];
  connectorLabels?: string[];
  skills?: string[];
}

/**
 * The user's personalization, the project (when it is the user's, with its attached skills and connectors) and
 * the user's enabled knowledge, as text for the agent. The file store has none of these, so it gets the input as is.
 */
async function contextFor(store: Store, input: CreateTaskInput): Promise<TaskContext> {
  const projectId = input.projectId;
  if (store.kind !== "supabase") return { projectId: projectId ?? null, connectors: input.connectors, skills: input.skills };
  const owner = store.ownerId;
  const [profile, access, knowledge, custom] = await Promise.all([
    agentContextFor(owner),
    projectId ? projectAccessById(owner, projectId).catch(() => null) : Promise.resolve(null),
    listKnowledge(owner, { enabledOnly: true }).catch(() => []),
    listCustomConnectors(owner).catch(() => []),
  ]);
  const project = access?.project ?? null;
  // Skills and connectors attached to the project are the owner's; members use their own sign-ins and computer.
  const [projectSkills, projectConnectors, projectFiles] = access && project
    ? await Promise.all([getProjectSkills(access.ownerId, project.id).catch(() => []), getProjectConnectors(access.ownerId, project.id).catch(() => []), listProjectFiles(access.ownerId, project.id).catch(() => [])])
    : [[], [], []];
  const connectors = uniq([...(input.connectors ?? []), ...projectConnectors]);
  const skills = uniq([...(input.skills ?? []), ...projectSkills]);
  const customNames = new Map(custom.map((c) => [c.serverName, c.name]));
  const parts: string[] = [];
  if (profile.instructions) parts.push(profile.instructions);
  // Project instructions are read fresh on every run (edits apply on the next message); see the relay.
  if (profile.useKnowledge && knowledge.length) {
    parts.push(
      "Knowledge the user saved. Apply an entry only when its condition fits the task:\n" +
        knowledge.map((k) => `- ${k.name}${k.whenToUse ? ` (use when: ${k.whenToUse})` : ""}: ${k.content}`).join("\n"),
    );
  }
  // A project id the user does not own (or a stale one from the browser) is dropped rather than failing the task.
  return {
    projectId: project ? project.id : null,
    ...(access && project && projectFiles.length ? { projectFiles: { owner: access.ownerId, project: project.id, files: projectFiles.map((f) => ({ id: f.id, name: f.name, size: f.size })) } } : {}),
    ...(parts.length ? { instructions: parts.join("\n\n") } : {}),
    ...(connectors.length ? { connectors, connectorLabels: connectors.map((id) => connectorLabel(id, customNames)) } : {}),
    ...(skills.length ? { skills } : {}),
  };
}

export interface CreateOptions {
  /** A preallocated task ID lets a durable dispatcher recover the same task after interruption. */
  id?: string;
  /** A title instead of one derived from the prompt. */
  title?: string;
  /** Extra fields for the task's meta (a parallel task's parent, a side chat's kind). */
  meta?: Partial<ExtMeta>;
}

/** `/skill-name rest of the prompt` (picked from the composer's / menu): the skill the task must load first. */
export function slashSkill(prompt: string): string | null {
  return /^\/([a-z0-9][a-z0-9_-]{1,63})(?:\s|$)/i.exec(prompt.trim())?.[1]?.toLowerCase() ?? null;
}

export async function createTask(store: Store, input: CreateTaskInput, opts: CreateOptions = {}): Promise<TaskViewExt> {
  const now = new Date().toISOString();
  // Hermes' API server does not expand a leading "/skill" itself: pass it on as a skill to load (skill_view).
  const slash = slashSkill(input.prompt);
  if (slash && !input.skills?.includes(slash)) input = { ...input, skills: [...(input.skills ?? []), slash] };
  const id = opts.id ?? newTaskId();
  const context = await contextFor(store, input);
  const references = await resolveReferences(store, input.references);
  const interaction = input.interaction === "chat" || input.interaction === "plan" ? input.interaction : undefined;
  // Uploaded attachments show in the task's Files from the start (they live on the home computer).
  const uploaded: StoredFile[] = (input.attachments ?? [])
    .filter((a): a is typeof a & { path: string } => !!a.path)
    .map((a) => ({ fileId: fileIdFor(a.path), path: a.path, name: a.name, ...(a.mime ? { mime: a.mime } : {}), ...(a.size !== undefined ? { size: a.size } : {}), version: `upload-${a.size ?? 0}`, at: now }));
  const task: TaskRecord = {
    id,
    title: opts.title?.trim() || deriveTitle(input.prompt),
    status: "waking",
    createdAt: now,
    updatedAt: now,
    projectId: context.projectId,
    favorite: false,
    archived: false,
    meta: {
      ...(context.instructions ? { instructions: context.instructions } : {}),
      ...(context.projectFiles ? { projectFiles: context.projectFiles } : {}),
      mode: input.mode,
      effort: input.effort,
      speed: input.speed,
      target: input.target,
      connectors: context.connectors,
      ...(context.connectorLabels ? { connectorLabels: context.connectorLabels } : {}),
      ...(context.skills ? { skills: context.skills } : {}),
      sessionId: `openman-${id}`,
      runId: null,
      queue: [],
      ...(interaction ? { interaction } : {}),
      ...(references.length ? { references } : {}),
      ...(uploaded.length && !remoteComputerId(input.target) ? { files: Object.fromEntries(uploaded.map((f) => [f.fileId, f])) } : {}),
      ...opts.meta,
    } as ExtMeta,
  };
  // The runtime is registered before the row is written, so a concurrent list request can
  // never mistake the brand-new task for one orphaned by a restart.
  const runtime = createRuntime(store, task);
  try {
    await store.createTask(task);
  } catch (err) {
    runtime.discard();
    throw err;
  }
  if (references.length) runtime.addReferences(references, references);
  runtime.begin(agentPrompt(input), input.prompt);
  return viewOf(runtime.task);
}

export async function listTasks(store: Store, opts: { archived?: boolean | "all" } = {}): Promise<TaskViewExt[]> {
  const tasks = (await store.listTasks(opts)).filter((t) => !isHiddenChild(t));
  const summaries = tasks.map((task) => {
    const live = liveRuntime(store, task.id);
    if (live) return viewOf(live.task);
    // Left "running" by a previous server process: reopen it in the background so it resumes or settles.
    if (isActiveStatus(task.status)) void openRuntime(store, task).catch(() => undefined);
    return viewOf(task);
  });
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/**
 * Loads a task through the caller's store (which is what enforces access) and returns its
 * runtime, creating one if needed. Null when the task does not exist or is not the caller's.
 */
export async function runtimeFor(store: Store, id: string): Promise<TaskRuntime | null> {
  if (!isValidTaskId(id)) return null;
  const live = liveRuntime(store, id);
  if (live) return live;
  const task = await store.getTask(id);
  if (!task) return null;
  return openRuntime(store, task);
}

export async function getTask(store: Store, id: string, role: TaskRole = "owner"): Promise<{ task: TaskViewExt; events: AgentEvent[] } | null> {
  if (!isValidTaskId(id)) return null;
  let runtime = liveRuntime(store, id);
  if (!runtime) {
    const task = await store.getTask(id);
    if (!task) return null;
    // A finished task needs no runtime just to be read.
    if (!isActiveStatus(task.status)) return { task: viewOf(task, role), events: await store.listEvents(id) };
    runtime = await openRuntime(store, task);
  }
  // A runtime kept in memory after its run, with everything written: the store is complete and also has events
  // written to the task since by something else (another server, a repair), which the runtime's log would miss.
  const events = runtime.isIdle && !isActiveStatus(runtime.task.status) ? await store.listEvents(id) : await runtime.allEvents();
  return { task: viewOf(runtime.task, role), events };
}

/** Adds references to the next message of a task (owner-scoped ids only). Returns those added. */
export async function referenceTasks(store: Store, runtime: TaskRuntime, ids: string[] | undefined): Promise<TaskReference[]> {
  const refs = await resolveReferences(store, ids, runtime.id);
  if (refs.length) runtime.addReferences(refs, mergeReferences(extOf(runtime.task).references, refs));
  return refs;
}

/**
 * What the file routes need to know about a task, read through the caller's store. A task with a
 * live run answers from memory, so a file written a moment ago is already there.
 */
export async function fileSourceFor(store: Store, id: string): Promise<FileSource | null> {
  if (!isValidTaskId(id)) return null;
  const live = liveRuntime(store, id);
  if (live) return { task: live.task, ownerId: store.ownerId, events: () => live.allEvents() };
  const task = await store.getTask(id);
  return task ? { task, ownerId: store.ownerId, events: () => store.listEvents(id) } : null;
}

export interface TaskChanges {
  title?: string;
  favorite?: boolean;
  archived?: boolean;
  /** Null takes the task out of its project. */
  projectId?: string | null;
  /** Lists the task under "Pinned" in the sidebar. */
  pinned?: boolean;
  /** Shows the unread dot until the task is opened. */
  unread?: boolean;
}

/**
 * Rename, favourite, archive or move a task. Applied to the live runtime too when one exists, so
 * its next save does not undo the change. Returns null when the task is not the caller's, or
 * `"no-project"` when the target project is not theirs.
 */
export async function changeTask(store: Store, id: string, changes: TaskChanges): Promise<TaskView | null | "no-project"> {
  if (!isValidTaskId(id)) return null;
  const live = liveRuntime(store, id);
  const current = live?.task ?? (await store.getTask(id));
  if (!current) return null;
  const patch: TaskPatch = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.favorite !== undefined) patch.favorite = changes.favorite;
  if (changes.archived !== undefined) patch.archived = changes.archived;
  if (changes.pinned !== undefined) patch.pinnedAt = changes.pinned ? (current.pinnedAt ?? new Date().toISOString()) : null;
  if (changes.unread !== undefined) patch.unread = changes.unread;
  if (changes.projectId !== undefined) {
    if (changes.projectId === null) patch.projectId = null;
    else if (store.kind !== "supabase") patch.projectId = changes.projectId;
    else {
      const access = await projectAccessById(store.ownerId, changes.projectId).catch(() => null);
      if (!access) return "no-project";
      patch.projectId = access.project.id;
    }
  }
  // The live copy first, so a save of its own in between carries the change too.
  if (live) Object.assign(live.task, patch);
  // Keep the task where it is in the list: these are not activity.
  await store.updateTask(id, { ...patch, updatedAt: current.updatedAt });
  return toSummary({ ...current, ...patch });
}

/** Stops anything running, then deletes the task and everything stored with it. */
export async function deleteTask(store: Store, id: string): Promise<boolean> {
  if (!isValidTaskId(id)) return false;
  const live = liveRuntime(store, id);
  if (live) {
    await live.stop().catch(() => undefined);
    forgetRuntime(id);
  } else if (!(await store.getTask(id))) return false;
  return store.deleteTask(id);
}
