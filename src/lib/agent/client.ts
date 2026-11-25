// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/** Browser-side client for the task API. The `api` builder owns the implementation; signatures are fixed. */
import type { AgentEvent, ComputerView, CreateTaskInput, Interaction, TaskAttachment, TaskSummary } from "./types";
import type { StudioMedia } from "@/lib/studio/media-types";
import type { ChangeStudioRun, StartStudioRun, StudioRun } from "@/lib/studio/runs";
import type { KeywordLookup } from "@/lib/studio/keyword-research";
import type { SubscribrChannelContext, SubscribrChannelEntry, SubscribrPage } from "@/lib/studio/subscribr";

const j = async <T,>(res: Response): Promise<T> => { if (!res.ok) throw new Error(`${res.status} ${await res.text()}`); return res.json() as Promise<T>; };

export interface StudioBrandContext {
  registry: { name: string; audience: string | null; voiceRules: string | null };
  commandCenter: { channels: string[] | null };
  kits: { tone: string | null; do: string[] | null; "don’t": string[] | null }[];
  assets: { name: string; type: string }[];
}

export const getSecondSpringContext = () => fetch("/api/admin/second-spring", { cache: "no-store" }).then((r) => j<StudioBrandContext>(r));

export type StudioVersion = { revision: number; created_at: string };
type StudioSnapshot<T> = StudioVersion & { items: T[] };
export const getStudioDrafts = <T>() => fetch("/api/studio/drafts", { cache: "no-store" })
  .then((r) => j<{ draft: StudioSnapshot<T> | null; versions: StudioVersion[] }>(r));
export const getStudioRevision = <T>(revision: number) => fetch(`/api/studio/drafts?revision=${revision}`, { cache: "no-store" })
  .then((r) => j<{ draft: StudioSnapshot<T> }>(r));
export async function saveStudioDrafts(expectedRevision: number, items: unknown[]) {
  const body = JSON.stringify({ expectedRevision, items });
  const response = await fetch("/api/studio/drafts", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body,
    keepalive: new TextEncoder().encode(body).length < 60_000,
  });
  if (response.status === 409) return null;
  return j<{ revision: number; savedAt: string }>(response);
}

async function studioRunRequest<T>(url: string, method = "GET", body?: StartStudioRun | ChangeStudioRun) {
  const response = await fetch(url, { method, cache: "no-store", headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? "Studio could not reach the workflow service.");
  }
  return response.json() as Promise<T>;
}

export const listStudioRuns = (videoId: string) => studioRunRequest<{ runs: StudioRun[] }>(`/api/studio/runs?videoId=${encodeURIComponent(videoId)}`);
export const startStudioRun = (input: StartStudioRun) => studioRunRequest<{ run: StudioRun }>("/api/studio/runs", "POST", input);
export const decideStudioRun = (input: ChangeStudioRun) => studioRunRequest<{ run: StudioRun }>("/api/studio/runs", "PATCH", input);
export type StudioResearchSource = { title: string; description?: string; url: string };
export const searchStudioTopic = (topic: string) =>
  studioRunRequest<{ sources: StudioResearchSource[] }>(`/api/studio/research?q=${encodeURIComponent(topic)}`);
export type StudioProviderStatus = { dataForSeo: boolean; subscribr: boolean };
type SubscribrScript = { id: number; title: string; hasScript?: boolean };
export type SubscribrNarration = { id: number; script: string; outline: string; version: number };
export const studioProviderStatus = () => studioRunRequest<StudioProviderStatus>("/api/studio/providers?action=status");
export const listSubscribrChannels = (page = 1, search = "") =>
  studioRunRequest<SubscribrPage<SubscribrChannelEntry>>(`/api/studio/providers?action=channels&page=${page}&search=${encodeURIComponent(search)}`);
export const getSubscribrChannelContext = (channel: number) =>
  studioRunRequest<SubscribrChannelContext>(`/api/studio/providers?action=channel-context&channel=${channel}`);
export const listSubscribrScripts = (channel: number, page: number, search: string) =>
  studioRunRequest<SubscribrPage<SubscribrScript>>(`/api/studio/providers?action=scripts&channel=${channel}&page=${page}&search=${encodeURIComponent(search)}`);
export const getSubscribrNarration = (script: number) =>
  studioRunRequest<SubscribrNarration>(`/api/studio/providers?action=narration&script=${script}`);
export const studioKeywordLookup = (video: string, request?: string) =>
  studioRunRequest<{ lookup: KeywordLookup | null }>(
    `/api/studio/providers?${new URLSearchParams({ action: "keyword-result", video, ...(request ? { request } : {}) })}`);
export async function lookupStudioKeywords(video: string, seed: string, market: string, language: string) {
  const response = await fetch("/api/studio/providers", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video, request: crypto.randomUUID(), seed, market, language, confirmCharge: true }),
  });
  const data = await response.json() as { error?: string; lookup?: KeywordLookup };
  if (!response.ok || !data.lookup) throw new Error(data.error || "Could not queue keyword research.");
  return data.lookup;
}

export const studioMediaUrl = (id: string, download = false) => `/api/studio/media?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
export async function uploadStudioMedia(file: File): Promise<StudioMedia> {
  const prepared = await j<{ id: string; type: string; signedUrl: string }>(await fetch("/api/studio/media", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }),
  }));
  const response = await fetch(prepared.signedUrl, {
    method: "PUT", body: file, headers: { "Content-Type": prepared.type, "x-upsert": "false" },
  });
  if (!response.ok) throw new Error(`Supabase Storage refused the upload (${response.status}).`);
  return { id: prepared.id, name: file.name, type: prepared.type, size: file.size };
}

export const listTasks = () => fetch("/api/tasks").then((r) => j<{ tasks: TaskSummary[] }>(r));
export const getTask = (id: string) => fetch(`/api/tasks/${id}`).then((r) => j<{ task: TaskSummary; events: AgentEvent[] }>(r));
export const createTask = (input: CreateTaskInput) => fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).then((r) => j<{ task: TaskSummary }>(r));
export const sendMessage = (id: string, body: { text: string; mode: "steer" | "queue" | "interrupt"; references?: string[]; interaction?: Exclude<Interaction, "chat">; attachments?: TaskAttachment[] }) => fetch(`/api/tasks/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => j<{ ok: true }>(r));
export const stopTask = (id: string) => fetch(`/api/tasks/${id}/stop`, { method: "POST" }).then((r) => j<{ ok: true }>(r));
export const respond = (id: string, body: { requestId: string; choice?: string; answer?: string }) => fetch(`/api/tasks/${id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => j<{ ok: true }>(r));
export const getComputerView = (id: string) => fetch(`/api/tasks/${id}/computer`).then((r) => j<ComputerView>(r));

/** Subscribe to a task's events from `afterSeq`. Returns an unsubscribe function. Server sends SSE `data: <AgentEvent json>`. */
export function subscribe(id: string, afterSeq: number, onEvent: (e: AgentEvent) => void, onError?: (e: unknown) => void): () => void {
  const es = new EventSource(`/api/tasks/${id}/events?after=${afterSeq}`);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as AgentEvent); } catch (e) { onError?.(e); } };
  es.onerror = (e) => onError?.(e);
  return () => es.close();
}

/* ---- task extras: modes, branch, continuation, side chats, parallel tasks, collaboration ---- */
const post = (url: string, body?: unknown, method = "POST") => fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const enc = encodeURIComponent;

export interface TaskMemberInfo { email: string; userId: string | null; role: "collaborator"; invitedBy: string; createdAt: string }
export type ChildTask = TaskSummary & { result?: string };

/** "Switch to Agent" on a Chat task, or Confirm on a plan card (with the plan text). */
export const switchToAgent = (id: string, plan?: string) => post(`/api/tasks/${enc(id)}/interaction`, { to: "agent", ...(plan ? { plan } : {}) }).then((r) => j<{ ok: true }>(r));
export const branchTask = (id: string, uptoSeq?: number) => post(`/api/tasks/${enc(id)}/branch`, uptoSeq ? { uptoSeq } : {}).then((r) => j<{ task: TaskSummary }>(r));
export const continueTask = (id: string) => post(`/api/tasks/${enc(id)}/continue`).then((r) => j<{ task: TaskSummary }>(r));
export const listSideChats = (id: string) => fetch(`/api/tasks/${enc(id)}/side-chats`).then((r) => j<{ sideChats: TaskSummary[] }>(r));
export const createSideChat = (id: string, prompt: string) => post(`/api/tasks/${enc(id)}/side-chats`, { prompt }).then((r) => j<{ task: TaskSummary }>(r));
export const listChildren = (id: string) => fetch(`/api/tasks/${enc(id)}/children`).then((r) => j<{ tasks: ChildTask[] }>(r));
export const listMembers = (id: string) => fetch(`/api/tasks/${enc(id)}/members`).then((r) => j<{ members: TaskMemberInfo[]; role: "owner" | "collaborator" }>(r));
export const inviteMember = (id: string, email: string) => post(`/api/tasks/${enc(id)}/members`, { email }).then((r) => j<{ member: TaskMemberInfo }>(r));
export const removeMember = (id: string, email: string) => post(`/api/tasks/${enc(id)}/members`, { email }, "DELETE").then((r) => j<{ ok: true }>(r));
/** Whether the user's agent uses their own Anthropic key from Orgo Secrets (no Orgo credits for model usage). */
export const getModelKey = () => fetch("/api/tasks/model-key").then((r) => j<{ ownKey: boolean; model: string | null; manageUrl: string }>(r));

/* ---- attachments: files go to the user's computer in parts of 8 MB (POST /api/tasks/uploads) ---- */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_PART = 8 * 1024 * 1024;

/** Uploads one file and returns the attachment to send with the task. `onProgress` gets 0..1. */
/**
 * Uploads a file for a message. `where` names the computer it must land on: an existing task's (`taskId`, which
 * may run on another computer), or the computer a new task will run on (`computerId`); the home computer otherwise.
 */
export async function uploadAttachment(file: File, onProgress?: (fraction: number) => void, where: { taskId?: string | null; computerId?: string | null } = {}): Promise<TaskAttachment> {
  if (file.size > UPLOAD_MAX_BYTES) throw new Error(`"${file.name}" is larger than 100 MB.`);
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const upload = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const parts = Math.max(1, Math.ceil(file.size / UPLOAD_PART));
  for (let part = 0; part < parts; part += 1) {
    const chunk = file.slice(part * UPLOAD_PART, Math.min(file.size, (part + 1) * UPLOAD_PART));
    const qs = new URLSearchParams({ upload, name: file.name, size: String(file.size), part: String(part), parts: String(parts) });
    if (where.taskId) qs.set("task", where.taskId);
    else if (where.computerId) qs.set("target", where.computerId);
    const res = await fetch(`/api/tasks/uploads?${qs}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: chunk });
    if (!res.ok) {
      const message = await res.json().then((b: { error?: string }) => b.error).catch(() => null);
      throw new Error(message || `"${file.name}" could not be uploaded.`);
    }
    onProgress?.((part + 1) / parts);
    if (part === parts - 1) return ((await res.json()) as { file: TaskAttachment }).file;
  }
  throw new Error(`"${file.name}" could not be uploaded.`);
}
