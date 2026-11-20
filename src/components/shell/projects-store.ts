// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

/**
 * The signed-in user's projects, from `/api/projects`. One shared list for the sidebar, the composer's
 * "Choose project" chip, the create dialog and the project page. Changes are shown at once and taken back
 * if the server refuses them.
 */
import { useEffect } from "react";
import { create } from "zustand";

export interface Project {
  id: string;
  name: string;
  instructions: string;
  connectors: string[];
  skills: string[];
  folder: string;
  computer: "local" | "cloud" | null;
  pinned: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  /** The caller's role: their own project, or one shared with them as editor or member. */
  role?: "owner" | "editor" | "member";
  /** Set on projects other people shared with the caller. */
  shared?: boolean;
  /** Who shared it (the owner's email). */
  sharedBy?: string;
  /** How many people the owner shared it with. */
  memberCount?: number;
}

export const isOwnProject = (p: Project) => !p.shared;
export const canEditProject = (p: Project) => !p.shared || p.role === "editor";

export interface ProjectMember {
  email: string;
  memberId: string | null;
  role: "editor" | "member";
  createdAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  mime: string | null;
  size: number;
  createdAt: string;
}

export type ProjectPatch = Partial<Pick<Project, "name" | "instructions" | "pinned" | "folder" | "computer" | "connectors" | "skills">>;

interface ProjectsState {
  projects: Project[];
  status: "idle" | "ready" | "error";
  refresh: () => Promise<void>;
}

async function fail(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // Not JSON.
  }
  throw new Error(message);
}

/** The caller's own first (pinned first, then in their order: the server's own rule), then shared ones. */
const sorted = (list: Project[]) =>
  [...list].sort((a, b) => Number(!!a.shared) - Number(!!b.shared) || Number(b.pinned) - Number(a.pinned) || (a.shared ? 0 : a.order - b.order) || a.createdAt.localeCompare(b.createdAt));

let inFlight: Promise<void> | null = null;

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  status: "idle",
  refresh: () => {
    inFlight ??= fetch("/api/projects", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { projects?: Project[] };
        set({ projects: sorted(Array.isArray(body.projects) ? body.projects : []), status: "ready" });
      })
      .catch(() => set({ status: "error" }))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));

export function refreshProjects(): Promise<void> {
  return useProjectsStore.getState().refresh();
}

/** Load the list once per page (later calls reuse it). */
export function useProjectsSync(): void {
  useEffect(() => {
    if (useProjectsStore.getState().status === "idle") void refreshProjects();
  }, []);
}

export function useProjects(): Project[] {
  useProjectsSync();
  return useProjectsStore((s) => s.projects);
}

export function useProject(id: string | null | undefined): Project | null {
  const projects = useProjects();
  return id ? (projects.find((p) => p.id === id) ?? null) : null;
}

const replace = (project: Project) => useProjectsStore.setState((s) => ({ projects: sorted(s.projects.some((p) => p.id === project.id) ? s.projects.map((p) => (p.id === project.id ? project : p)) : [...s.projects, project]) }));

export async function createProject(input: { name: string; instructions?: string; folder?: string; computer?: "local" | "cloud" | null }): Promise<Project> {
  const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) await fail(res, "The project could not be created.");
  const { project } = (await res.json()) as { project: Project };
  replace(project);
  return project;
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const before = useProjectsStore.getState().projects;
  const current = before.find((p) => p.id === id);
  if (current) replace({ ...current, ...patch });
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) await fail(res, "The project could not be updated.");
    const { project } = (await res.json()) as { project: Project };
    replace(project);
    return project;
  } catch (err) {
    useProjectsStore.setState({ projects: before });
    throw err;
  }
}

export async function deleteProject(id: string): Promise<void> {
  const before = useProjectsStore.getState().projects;
  useProjectsStore.setState({ projects: before.filter((p) => p.id !== id) });
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  if (!res || !res.ok) {
    useProjectsStore.setState({ projects: before });
    if (res) await fail(res, "The project could not be deleted.");
    throw new Error("The project could not be deleted.");
  }
}

/** New order, first to last (every project id). */
export async function reorderProjects(ids: string[]): Promise<void> {
  const before = useProjectsStore.getState().projects;
  const byId = new Map(before.map((p) => [p.id, p]));
  useProjectsStore.setState({ projects: ids.flatMap((id, order) => (byId.has(id) ? [{ ...byId.get(id)!, order }] : [])) });
  try {
    const res = await fetch("/api/projects/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!res.ok) await fail(res, "The new order could not be saved.");
    const body = (await res.json()) as { projects?: Project[] };
    // The answer lists only the caller's own projects; shared ones stay as they are.
    if (Array.isArray(body.projects)) useProjectsStore.setState((s) => ({ projects: sorted([...body.projects!.map((p) => ({ ...byId.get(p.id), ...p })), ...s.projects.filter((p) => p.shared)]) }));
  } catch (err) {
    useProjectsStore.setState({ projects: before });
    throw err;
  }
}

/* ---------------------------------------------------------------- files */

export async function listProjectFiles(id: string): Promise<ProjectFile[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/files`, { cache: "no-store" });
  if (!res.ok) await fail(res, "The files could not be loaded.");
  return ((await res.json()) as { files: ProjectFile[] }).files;
}

export async function uploadProjectFile(id: string, file: File): Promise<ProjectFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/files`, { method: "POST", body: form });
  if (!res.ok) await fail(res, `"${file.name}" could not be uploaded.`);
  return ((await res.json()) as { file: ProjectFile }).file;
}

export async function deleteProjectFile(id: string, fileId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!res.ok) await fail(res, "The file could not be deleted.");
}

export const projectFileUrl = (id: string, fileId: string) => `/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

export async function readProjectFileText(id: string, fileId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(projectFileUrl(id, fileId), { cache: "no-store", signal });
  if (!response.ok) throw new Error("The file could not be opened. Try downloading it.");
  return response.text();
}
export const projectHref = (id: string) => `/app/project/${encodeURIComponent(id)}`;

/* ---------------------------------------------------------------- sharing */

export async function listProjectMembers(id: string): Promise<{ role: Project["role"]; members: ProjectMember[] }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/members`, { cache: "no-store" });
  if (!res.ok) await fail(res, "The members could not be loaded.");
  return (await res.json()) as { role: Project["role"]; members: ProjectMember[] };
}

/** Invites someone by email, or changes their role. */
export async function inviteProjectMember(id: string, email: string, role: ProjectMember["role"]): Promise<ProjectMember> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) });
  if (!res.ok) await fail(res, "The invitation could not be sent.");
  void refreshProjects();
  return ((await res.json()) as { member: ProjectMember }).member;
}

export async function removeProjectMember(id: string, email: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/members`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (!res.ok) await fail(res, "They could not be removed.");
  void refreshProjects();
}

/** Leaves a project shared with the caller. */
export async function leaveProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/leave`, { method: "POST" });
  if (!res.ok) await fail(res, "You could not leave the project.");
  useProjectsStore.setState((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
}
