// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * The relay owns every live task on the server. For each run it consumes the agent's event
 * stream (Hermes or the mock), turns each event into an `AgentEvent` with an increasing `seq`,
 * stores it, and fans it out to whoever is subscribed. It keeps consuming when no browser is
 * connected, so a task finishes and is saved even if the tab was closed.
 */
import { modelFor, type AgentEvent, type Interaction, type TaskReference, type TaskStatus } from "@/lib/agent/types";
import { isValidTaskId, type QueuedMessage, type Store, type StoredFile, type TaskRecord } from "@/lib/store/types";
import { logEvent } from "@/lib/observability/log";
import { findFiles } from "./computer";
import { appPermission, setAppPermission } from "./computer-use";
import { computerFor } from "./connection";
import { cachedFile, fileIdFor, fileNameOf, mimeFor, prefetchFiles } from "./files";
import { TERMINAL_RUN_STATUSES, type HermesEvent, type HermesRunStatus, type HermesStep } from "./hermes";
import { CHAT_PROFILE } from "./agent-tools-mcp";
import { omtoolsName, serviceBridge } from "./bridge";
import { ext, transcriptText } from "./task-meta";
import { REMOTE_PROFILE, connectTarget, disconnectTarget, folderInstructions, forgetTaskFolder, remoteComputerId, remoteInstructions, targetComputerConfig, taskFolder } from "./remote";
import { pickUpstream, type Upstream } from "./upstream";
import { acquireSlot, cancelWait, claimSlot, releaseSlot } from "./slots";
import { prepareProjectFiles, projectInstructions, restoreSwept } from "./workspace";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the relay stamps it with `seq` and `at`. */
export type AgentEventBody = DistributiveOmit<AgentEvent, "seq" | "at">;
type Subscriber = (event: AgentEvent) => void;
type PlanStep = { id: string; title: string; status: "pending" | "active" | "done" };

type Outcome =
  | { kind: "completed"; output: string; usage?: { inputTokens: number; outputTokens: number } }
  | { kind: "failed"; error: string; output?: string }
  | { kind: "cancelled" };

interface ActiveRun {
  upstream: Upstream;
  /** What the user asked for in this run. Null for a run re-attached after a restart, which cannot be started again. */
  input: string | null;
  /** The model the current attempt asked for. */
  model: string;
  /** Set when the attempt failed only because that model is not available on the key; the run is then started again. */
  fallback: boolean;
  startedAt: number;
  /** Set once the backend has accepted the run. */
  runId: string | null;
  /** Last upstream sequence number seen, for resuming a dropped stream. */
  upstreamSeq: number;
  abort: AbortController;
  done: boolean;
  /** The run's last assistant message has been closed, ahead of the run itself. */
  closed: boolean;
  outcome?: Outcome["kind"];
  stopRequested: boolean;
  /** True when the stop is an interrupt: the next queued message starts right after. */
  interrupting: boolean;
  /** Assistant text streamed since the last `message.completed`. */
  text: string;
  /** A user message arrived while the current assistant message was still streaming, splitting it in two. */
  splitMidMessage: boolean;
  lastCompleted: string;
  lastWasReasoning: boolean;
  calls: Map<string, { tool: string; startedAt: number; preview?: string }>;
  /** Call ids we made up for backends that send none, oldest first per tool. */
  anonymous: Map<string, string[]>;
  /**
   * Every tool the backend says is running, hidden ones included. Unlike `calls` this is a list:
   * several tools can share one call id (a batched call), and none of them may go unnoticed.
   */
  open: { id?: string; tool: string }[];
  /** Model steps read from the transcript, by the id of each tool call they made. */
  steps: Map<string, HermesStep>;
  /** Steps whose reasoning has been emitted. */
  reasoned: Set<string>;
  /** Everything the assistant wrote in this run, searched for files it delivered. */
  said: string[];
  /** Files written during this run: path -> size when known. */
  written: Map<string, number | undefined>;
  /** The run works on another computer through the remote profile; its credential is removed when it ends. */
  remote: boolean;
  /** The task's own folder on the home computer, for a run there. */
  folder?: string;
  /** The desktop app the agent last named or captured, for Computer Use permissions. */
  lastApp?: string;
  /** Apps the user allowed for this run's task (Allow, as opposed to Always allow). */
  allowedApps: Set<string>;
  /** The relay is answering this run's `omtools` calls (see `bridge.ts`). */
  bridging: boolean;
  /** Waiting for a free run slot (the user's limit on tasks running at once). */
  queued?: boolean;
  /** The run holds one of the owner's run slots (released when it winds down). */
  slot?: boolean;
}

interface PendingRequest {
  kind: "approval" | "question";
  upstreamId?: string;
  generation?: number;
  /** Button label shown to the user -> the choice Hermes expects. */
  choiceMap: Record<string, string>;
  /** Set for a Computer Use question about one app: the answer is remembered for that app. */
  app?: string;
}

interface RelayState {
  runtimes: Map<string, TaskRuntime>;
  opening: Map<string, Promise<TaskRuntime>>;
  counter: number;
}

// On globalThis so dev-server module reloads keep the live runs.
const g = globalThis as typeof globalThis & { __openmanRelay?: RelayState };
const state: RelayState = (g.__openmanRelay ??= { runtimes: new Map(), opening: new Map(), counter: 0 });

const ACTIVE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["waking", "running", "waiting"]);
const DELTA_WINDOW_MS = 40;
const FLUSH_DELAY_MS = 250;
const STOP_GRACE_MS = 10_000;
const IDLE_EVICT_MS = 15 * 60_000;

const APPROVAL_LABELS: Record<string, string> = {
  once: "Allow once",
  session: "Allow for this session",
  always: "Always allow",
  deny: "Deny",
};

/** The three answers to "may the agent use this app?" and what each one tells Hermes. */
const APP_CHOICES = { allow: "Allow", always: "Always allow", never: "Never" } as const;

const AGENT_INSTRUCTIONS =
  "You are working inside a web app that shows your progress to the user live. " +
  "For any task with three or more steps, keep a task list with the todo_list tool and update it as you go. " +
  "Save deliverables as files and name each one by its full path in your final answer.";

const CHAT_INSTRUCTIONS =
  "You are in Chat mode inside a web app: a light question-and-answer conversation. Answer directly and concisely in Markdown. " +
  "You can search the web and read files the user gives you. You have no computer, terminal, browser or code execution here, so do not offer to act on a computer; " +
  "when the user needs real work done (building, running, editing things), say that switching this conversation to Agent mode will do it.";

const PLAN_INSTRUCTIONS =
  "You are in Plan mode inside a web app. Do NOT carry out the task and do not create files. " +
  "First check that the task is feasible (search the web if that helps). If something essential is missing, ask the user with the clarify tool (one question at a time, at most three). " +
  "Then reply with a short sentence followed by the plan as ONE fenced code block whose language tag is plan (```plan ... ```), written in Markdown with these sections: " +
  "## Goal, ## Steps (a numbered list), ## Constraints, ## Deliverables. Nothing runs until the user confirms the plan.";

/** How long the user has to answer an "Allow these actions?" card the app raised for a tool call. */
const LOCAL_APPROVAL_MS = 280_000;

/** The model the Max mode asks for at the two highest efforts, and what replaces it while the key cannot use it. */
const FABLE_MODEL = "claude-fable-5-2";
const FALLBACK_MODEL = "claude-opus-5-5";
const FALLBACK_BRIEF = "Running on Opus 5.5 because Fable 5.2 is not enabled on this key yet";
/** Anthropic's refusal for a model the key's organisation may not use. Nothing else triggers the fallback. */
const MODEL_UNAVAILABLE = /data retention|model_not_available|in order to access this model/i;

/**
 * Tools that act on the desktop or the browser. Their approvals are answered here, not by the user.
 * `browser_vault` is left out on purpose: it fills in saved logins and cards, which is the user's call.
 */
const isDesktopTool = (tool: string): boolean => tool === "computer_use" || tool === "computer" || (/^browser(_|$)/.test(tool) && tool !== "browser_vault");
/** How long the end of a run may wait for the computer to confirm the files the answer names. */
const DELIVERABLES_WAIT_MS = 5000;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function canonicalChoice(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (["approve", "approved", "allow", "allow once", "yes", "accept", "ok", "once"].includes(v)) return "once";
  if (["always", "always allow"].includes(v)) return "always";
  if (["session", "allow for this session"].includes(v)) return "session";
  if (["deny", "denied", "reject", "no", "cancel", "decline"].includes(v)) return "deny";
  return v;
}

/** Hermes' own tool-loading plumbing. Real calls, but noise in a task timeline. */
const PLUMBING_TOOLS = new Set(["tool_search", "tool_describe", "tool_call"]);
const PREVIEW_MAX = 1000;

/** Tool output can echo credentials; mask the common shapes before it reaches the browser or storage. */
function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{20,}/g, "[redacted key]")
    .replace(/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[redacted token]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted key]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted token]")
    .replace(/\b(Bearer|token=|password=|api[_-]?key=)\s*[A-Za-z0-9._~+/-]{16,}/gi, "$1[redacted]");
}

/**
 * Hermes wraps anything fetched from outside in `<untrusted_tool_result>` with a warning meant for
 * the model. The user should see the content, not the warning.
 */
function unwrapToolResult(raw: string): string {
  const open = /^\s*<untrusted_tool_result[^>]*>\s*/.exec(raw);
  if (!open) return raw;
  let body = raw.slice(open[0].length).replace(/\s*<\/untrusted_tool_result>\s*$/, "");
  const gap = body.indexOf("\n\n");
  if (gap >= 0 && /^The following content was retrieved/.test(body)) body = body.slice(gap + 2);
  return body;
}

/** A short, readable summary of a raw tool result (usually a JSON string). */
function resultPreview(raw: string): string {
  let text = unwrapToolResult(raw);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const r = parsed as Record<string, unknown>;
      const failure = str(r.error);
      const body = str(r.output) ?? str(r.content) ?? str(r.text) ?? str(r.result) ?? str(r.summary) ?? str(r.message);
      const data = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : undefined;
      const list = Array.isArray(r.results) ? r.results : Array.isArray(data?.web) ? data.web : Array.isArray(data?.results) ? data.results : undefined;
      if (failure) text = body ? `${body}\n${failure}` : failure;
      else if (body !== undefined) text = body;
      // A failed script says why on stderr; its last lines are the part worth reading.
      else if (str(r.stderr)) text = String(r.stderr).trim().split("\n").slice(-3).join("\n");
      else if (r.output === "" && num(r.exit_code) !== undefined) text = `Exit code ${r.exit_code}`;
      else if (list) {
        const lines = list
          .map((item) => {
            if (!item || typeof item !== "object") return typeof item === "string" ? item : undefined;
            const o = item as Record<string, unknown>;
            const label = str(o.title) ?? str(o.name);
            const link = str(o.url) ?? str(o.link);
            return label && link ? `${label} - ${link}` : label ?? link;
          })
          .filter((line): line is string => !!line);
        if (lines.length) text = lines.join("\n");
      } else if (num(r.bytes_written) !== undefined) {
        text = `Wrote ${r.bytes_written} bytes${str(r.resolved_path) ? ` to ${r.resolved_path}` : ""}`;
      }
    }
  } catch {
    // Not JSON: use the text as it is.
  }
  const clean = redactSecrets(text).trim();
  return clean.length > PREVIEW_MAX ? `${clean.slice(0, PREVIEW_MAX - 1)}…` : clean;
}

/** A short label for a desktop action, which Hermes sends with no preview at all. */
function computerUsePreview(args: Record<string, unknown>): string | undefined {
  const action = str(args.action);
  if (!action) return undefined;
  const point = (v: unknown) => (Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number") ? `(${v[0]}, ${v[1]})` : undefined);
  const quote = (v: unknown) => (str(v) ? `"${String(v).length > 80 ? `${String(v).slice(0, 79)}…` : v}"` : undefined);
  const where = point(args.coordinate) ?? (num(args.element) !== undefined ? `element ${args.element}` : undefined);
  const keys = Array.isArray(args.keys) ? args.keys.filter((k) => typeof k === "string").join("+") : str(args.keys);
  let detail: string | undefined;
  if (action === "type") detail = quote(args.text);
  else if (action === "key") detail = keys;
  else if (action === "scroll") detail = [str(args.direction), where ? `at ${where}` : undefined].filter(Boolean).join(" ") || undefined;
  else if (action === "drag") detail = [point(args.from_coordinate), point(args.to_coordinate)].filter(Boolean).join(" to ") || undefined;
  else if (action === "wait") detail = num(args.seconds) !== undefined ? `${args.seconds} s` : undefined;
  else if (action === "focus_app" || action === "list_apps") detail = str(args.app);
  else if (action === "set_value") detail = quote(args.value);
  else if (action !== "capture") detail = [str(args.button) && args.button !== "left" ? `${args.button} button` : undefined, where ? `at ${where}` : undefined].filter(Boolean).join(" ") || undefined;
  const verb = action === "capture" ? "Look at the screen" : action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return detail ? `${verb} ${detail}` : verb;
}

/** A readable row for one of the app's own task tools. */
function omtoolsPreview(name: string, args: Record<string, unknown>): string {
  const count = Array.isArray(args.tasks) ? args.tasks.length : 0;
  switch (name) {
    case "task_outline":
      return "Reading the outline of a referenced task";
    case "task_search":
      return str(args.query) ? `Searching referenced tasks for "${String(args.query).slice(0, 60)}"` : "Searching referenced tasks";
    case "task_read":
      return num(args.from) !== undefined ? `Reading part ${args.from}${num(args.to) !== undefined && args.to !== args.from ? `–${args.to}` : ""} of a referenced task` : "Reading a referenced task";
    case "create_parallel_tasks":
      return count ? `Starting ${count} parallel task${count === 1 ? "" : "s"}` : "Starting parallel tasks";
    case "parallel_tasks_status":
      return "Checking the parallel tasks";
    case "read_parallel_result":
      return "Reading a parallel task's result";
    default:
      return name.replace(/_/g, " ");
  }
}

const FILE_EXTENSIONS =
  "md|markdown|txt|csv|tsv|json|jsonl|html?|css|js|mjs|ts|tsx|jsx|py|ipynb|sh|sql|ya?ml|xml|tex|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|webp|mp3|wav|mp4|webm|mov|zip|tar|gz";
const ABSOLUTE_PATH = /(?<![\w/.:~`-])((?:~\/|\/)(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,8})(?![\w/])/g;
/** The same, with spaces allowed inside ("/root/out/My Chart.svg"); it stops at the first thing that looks like an extension. */
const SPACED_PATH = /(?<![\w/.:~`-])((?:~\/|\/)[\w.@+\-/ ]{0,200}?[\w.@+)-]\.[A-Za-z0-9]{1,8})(?![\w/])/g;
const CODE_SPAN = /`([^`\n]{1,400})`/g;
const BARE_NAME = new RegExp(`(?<![\\w/.@:-])([\\w-][\\w.-]{0,120}\\.(?:${FILE_EXTENSIONS}))(?![\\w/-])`, "gi");

/** Things in a piece of assistant text that could be a file it saved: paths, and bare file names. */
function fileCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CODE_SPAN)) {
    const span = m[1].trim();
    // A path may contain spaces only inside a code span, where its extent is unambiguous.
    if (/^(~\/|\/)[^*?<>|]+\.[A-Za-z0-9]{1,8}$/.test(span)) out.add(span);
  }
  for (const m of text.matchAll(ABSOLUTE_PATH)) out.add(m[1]);
  for (const m of text.matchAll(SPACED_PATH)) if (m[1].includes(" ")) out.add(m[1]);
  for (const m of text.matchAll(BARE_NAME)) out.add(m[1]);
  return [...out];
}

/**
 * Reads the task list out of a `todo_list` tool result. Hermes cuts result previews at 500
 * characters, so a long list arrives as broken JSON; complete items are still pulled out of it.
 */
function parseTodos(preview: string): { steps: PlanStep[]; complete: boolean } | null {
  const mapStatus = (s: string): PlanStep["status"] | null =>
    s === "completed" ? "done" : s === "in_progress" ? "active" : s === "cancelled" ? null : "pending";
  try {
    const parsed = JSON.parse(preview) as { todos?: { id?: unknown; content?: unknown; status?: unknown }[] };
    if (Array.isArray(parsed.todos)) {
      const steps: PlanStep[] = [];
      for (const t of parsed.todos) {
        const status = mapStatus(String(t.status ?? "pending"));
        if (status && str(t.content)) steps.push({ id: String(t.id ?? steps.length + 1), title: String(t.content), status });
      }
      return { steps, complete: true };
    }
  } catch {
    // Truncated or not JSON: fall through to the tolerant scan.
  }
  const item = /\{\s*"id"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"status"\s*:\s*"([a-z_]+)"/g;
  const steps: PlanStep[] = [];
  for (const m of preview.matchAll(item)) {
    const status = mapStatus(m[3]);
    if (!status) continue;
    let title = m[2];
    try {
      title = JSON.parse(`"${m[2]}"`) as string;
    } catch {
      // Keep the raw text.
    }
    steps.push({ id: m[1], title, status });
  }
  return steps.length ? { steps, complete: false } : null;
}

export class TaskRuntime {
  readonly id: string;
  store: Store;
  task: TaskRecord;
  lastTouched = Date.now();

  private seq: number;
  /** Events with `seq <= floor` were written before this runtime existed and live only in the store. */
  private readonly floor: number;
  private readonly log: AgentEvent[] = [];
  private unflushed: AgentEvent[] = [];
  private taskDirty = false;
  private flushing: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushFailures = 0;
  private readonly subscribers = new Set<Subscriber>();
  private run: ActiveRun | null = null;
  private pendingDelta: { type: "message.delta" | "reasoning.delta"; text: string } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  /** Approval cards raised by the app's own tools during a run (parallel tasks), answered here, not by Hermes. */
  private readonly localApprovals = new Map<string, (allowed: boolean) => void>();
  private plan: PlanStep[] = [];
  private lastPlanJson = "";

  constructor(store: Store, task: TaskRecord, lastSeq: number) {
    this.id = task.id;
    this.store = store;
    this.task = task;
    this.seq = lastSeq;
    this.floor = lastSeq;
    this.task.meta.queue ??= [];
  }

  private get queue(): QueuedMessage[] {
    return (this.task.meta.queue ??= []);
  }

  /** A run holds the task from its launch until it has fully wound down, which is a moment after its last event. */
  get isBusy(): boolean {
    return this.run !== null;
  }

  /** Nothing is running and nothing is about to: an open event stream has nothing more to wait for. */
  get atRest(): boolean {
    return this.run === null && this.queue.length === 0 && !ACTIVE.has(this.task.status);
  }

  get isIdle(): boolean {
    return !this.isBusy && this.subscribers.size === 0 && this.unflushed.length === 0 && !this.taskDirty && !this.flushing;
  }

  /** Drops a runtime whose task could not be created. */
  discard(): void {
    if (state.runtimes.get(this.id) === this) state.runtimes.delete(this.id);
  }

  /** Set once the task was deleted: nothing more is written for it. */
  deleted = false;

  // ---------------------------------------------------------------- events out

  private push(body: AgentEventBody): AgentEvent {
    const event = { ...body, seq: ++this.seq, at: new Date().toISOString() } as AgentEvent;
    this.log.push(event);
    this.unflushed.push(event);
    if (event.type === "status") this.task.status = event.status;
    this.task.updatedAt = event.at;
    this.taskDirty = true;
    this.lastTouched = Date.now();
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch {
        // One broken connection must not stop the others.
      }
    }
    this.scheduleFlush();
    return event;
  }

  /** Emits an event, after any text still held back for batching, so order is preserved. */
  private emit(body: AgentEventBody): AgentEvent {
    this.flushDelta();
    return this.push(body);
  }

  /** Token deltas arrive faster than is useful to store one by one; they are batched per ~40 ms. */
  private delta(type: "message.delta" | "reasoning.delta", text: string): void {
    if (this.pendingDelta && this.pendingDelta.type !== type) this.flushDelta();
    if (this.pendingDelta) {
      this.pendingDelta.text += text;
      return;
    }
    this.pendingDelta = { type, text };
    this.deltaTimer = setTimeout(() => this.flushDelta(), DELTA_WINDOW_MS);
  }

  private flushDelta(): void {
    if (!this.pendingDelta) return;
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    const { type, text } = this.pendingDelta;
    this.pendingDelta = null;
    this.push({ type, text });
  }

  private setStatus(status: TaskStatus, brief?: string, force = false): void {
    if (!force && this.task.status === status && !brief) return;
    this.emit(brief ? { type: "status", status, brief } : { type: "status", status });
  }

  // ---------------------------------------------------------------- persistence

  private scheduleFlush(delay = FLUSH_DELAY_MS): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  /** Writes buffered events and the task row. Failed writes stay buffered and are retried. */
  flush(): Promise<void> {
    this.flushing ??= this.flushLoop().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushLoop(): Promise<void> {
    while (this.unflushed.length > 0 || this.taskDirty) {
      if (this.deleted) {
        this.unflushed = [];
        this.taskDirty = false;
        return;
      }
      const batch = this.unflushed.slice(0, 500);
      const dirty = this.taskDirty;
      this.taskDirty = false;
      try {
        if (batch.length > 0) {
          await this.store.appendEvents(this.id, batch);
          this.unflushed = this.unflushed.slice(batch.length);
        }
        if (dirty) {
          await this.store.updateTask(this.id, {
            title: this.task.title,
            status: this.task.status,
            updatedAt: this.task.updatedAt,
            meta: this.task.meta,
          });
        }
        this.flushFailures = 0;
      } catch (err) {
        this.taskDirty ||= dirty;
        this.flushFailures++;
        console.error(`[relay] could not save task ${this.id} (attempt ${this.flushFailures}):`, errorText(err));
        this.scheduleFlush(Math.min(30_000, 1000 * 2 ** this.flushFailures));
        return;
      }
    }
  }

  /** A newer request from the same user carries a fresher access token; use it for later writes. */
  adoptStore(store: Store): void {
    if (store.kind !== this.store.kind || store.ownerId !== this.store.ownerId) return;
    this.store = store;
    if (this.unflushed.length > 0 || this.taskDirty) this.scheduleFlush(0);
  }

  // ---------------------------------------------------------------- reading

  private async storedEvents(after: number): Promise<AgentEvent[]> {
    if (after >= this.floor) return [];
    return (await this.store.listEvents(this.id, after)).filter((e) => e.seq <= this.floor);
  }

  /** Every event of the task so far: what is in the store plus what this runtime produced. */
  async allEvents(): Promise<AgentEvent[]> {
    const older = await this.storedEvents(0);
    return [...older, ...this.log];
  }

  /**
   * Replays events with `seq > after`, then delivers new ones as they happen.
   * The replay and the hand-over to live delivery happen in one synchronous step, so nothing
   * is missed or repeated in between.
   */
  async subscribe(after: number, subscriber: Subscriber): Promise<() => void> {
    const older = await this.storedEvents(after);
    for (const event of older) subscriber(event);
    for (const event of this.log) if (event.seq > after) subscriber(event);
    this.subscribers.add(subscriber);
    this.lastTouched = Date.now();
    return () => {
      this.subscribers.delete(subscriber);
      this.lastTouched = Date.now();
    };
  }

  // ---------------------------------------------------------------- user actions

  /** First turn of a new task. */
  begin(prompt: string, display: string): void {
    this.emit({ type: "user.message", text: display });
    this.setStatus("waking", "Starting the computer", true);
    this.launch(prompt, false);
  }

  /**
   * Records a user message that lands while a run is in flight. The assistant text streamed so
   * far is closed first, so the transcript reads: text, user message, rest of the text.
   */
  private echoMidRun(text: string): void {
    const run = this.run;
    if (run && !run.done && run.text.trim()) {
      this.completeMessage(run, run.text);
      run.splitMidMessage = true;
    }
    this.emit({ type: "user.message", text });
  }

  private enqueue(message: QueuedMessage, front = false): void {
    if (front) this.queue.unshift(message);
    else this.queue.push(message);
    this.taskDirty = true;
    this.scheduleFlush();
  }

  /**
   * Requests the agent is blocked on are settled before a new message goes in: an open question
   * takes the message as its answer (returns true, nothing more to send); an open approval is
   * denied, since the user chose to say something else instead of allowing it.
   */
  private async settleOpenRequests(text: string): Promise<boolean> {
    this.denyLocalApprovals();
    for (const [requestId, request] of [...this.pending]) {
      if (request.kind === "question") {
        this.echoMidRun(text);
        await this.respond(requestId, { answer: text });
        return true;
      }
      await this.respond(requestId, { choice: "deny" }).catch((err) => console.warn(`[relay] could not deny approval for task ${this.id}:`, errorText(err)));
    }
    return false;
  }

  /**
   * Switches how the agent works on this task. Moving between the agent and Chat/Plan changes the Hermes profile,
   * so the next run starts a fresh session there with the conversation so far carried over. Returns false when it
   * is already in that mode.
   */
  setInteraction(next: Interaction): boolean {
    const meta = ext(this.task.meta);
    const current = meta.interaction ?? "agent";
    if (current === next) return false;
    meta.interaction = next;
    if ((current === "agent") !== (next === "agent")) {
      meta.sessionId = `openman-${this.id}-${next}-${Date.now().toString(36)}`;
      meta.carryOver = true;
    }
    this.emit({ type: "interaction.changed", interaction: next });
    this.taskDirty = true;
    this.scheduleFlush();
    return true;
  }

  /** Records the earlier tasks the next message refers to (kept on the task, the 20 most recent). */
  addReferences(refs: TaskReference[], merged: TaskReference[]): void {
    if (!refs.length) return;
    ext(this.task.meta).references = merged;
    this.emit({ type: "references.added", tasks: refs });
    this.taskDirty = true;
  }

  /** `queue`: hold the message and send it when the current run ends. Its `user.message` is emitted when it is sent. */
  async queueMessage(text: string): Promise<void> {
    if (await this.settleOpenRequests(text)) return;
    this.submit(text, false);
  }

  /**
   * Starts a run with this message, or holds it until the task is free. One task never has two
   * runs at once: a second one would write into the same transcript and mix its events with the first's.
   */
  private submit(text: string, echoed: boolean): void {
    if (this.run) this.enqueue({ text, echoed });
    else this.launch(text, !echoed);
  }

  /** `steer`: hand the message to the running agent, which reads it at its next tool boundary. */
  async steer(text: string): Promise<void> {
    if (await this.settleOpenRequests(text)) return;
    const run = this.run;
    if (!run || run.done) return this.submit(text, false);
    this.echoMidRun(text);
    let accepted = false;
    if (run.runId) {
      accepted = await run.upstream.steer(run.runId, text).catch((err) => {
        console.warn(`[relay] steer failed for task ${this.id}:`, errorText(err));
        return false;
      });
    }
    if (accepted) return;
    // Not accepted (still starting, stopping, or just ended): it becomes the next turn instead.
    this.submit(text, true);
  }

  /** `interrupt`: stop the current run, then start a new one with this message in the same session. */
  async interrupt(text: string): Promise<void> {
    const run = this.run;
    if (!run || run.done) return this.submit(text, false);
    this.echoMidRun(text);
    this.enqueue({ text, echoed: true }, true);
    run.interrupting = true;
    await this.requestStop(run);
  }

  async stop(): Promise<void> {
    this.queue.length = 0;
    this.taskDirty = true;
    const run = this.run;
    if (!run || run.done) {
      if (ACTIVE.has(this.task.status)) this.setStatus("stopped");
      this.scheduleFlush();
      return;
    }
    run.interrupting = false;
    await this.requestStop(run);
  }

  private async requestStop(run: ActiveRun): Promise<void> {
    run.stopRequested = true;
    if (run.queued && cancelWait(this.store.ownerId, this.id)) {
      // Nothing started yet: settle at once.
      this.finishRun(run, { kind: "cancelled" });
      return;
    }
    if (run.runId) {
      await run.upstream.stop(run.runId).catch((err) => console.warn(`[relay] stop failed for task ${this.id}:`, errorText(err)));
    }
    // The backend normally confirms with a terminal event. If it never does, settle locally.
    setTimeout(() => {
      if (run.done) return;
      run.abort.abort();
      this.finishRun(run, { kind: "cancelled" });
      this.afterRun(run);
    }, STOP_GRACE_MS).unref?.();
  }

  /** Answers an approval request or a question. Returns false when the request is no longer open. */
  async respond(requestId: string, input: { choice?: string; answer?: string }): Promise<boolean> {
    const local = this.localApprovals.get(requestId);
    if (local) {
      const raw = (input.choice ?? input.answer ?? "").trim().toLowerCase();
      local(raw.startsWith("allow"));
      return true;
    }
    if (isExternalRequestId(requestId)) return this.answerExternal(requestId, (input.choice ?? input.answer ?? "").trim(), true);
    const request = this.pending.get(requestId);
    const run = this.run;
    if (!request || !run || run.done || !run.runId) return false;
    if (request.kind === "approval" && request.app) {
      const raw = (input.choice ?? input.answer ?? "").trim();
      const lower = raw.toLowerCase();
      const never = lower === APP_CHOICES.never.toLowerCase() || lower === "deny" || lower === "never";
      const always = lower === APP_CHOICES.always.toLowerCase() || lower === "always";
      await run.upstream.approval(run.runId, request.upstreamId, never ? "deny" : "once", request.generation);
      if (never || always) {
        await setAppPermission(this.store.ownerId, request.app, never ? "never" : "always").catch((err) => console.warn(`[relay] could not save the permission for ${request.app}:`, errorText(err)));
      } else run.allowedApps.add(request.app.toLowerCase());
    } else if (request.kind === "approval") {
      const raw = input.choice ?? input.answer ?? "";
      const choice = request.choiceMap[raw] ?? canonicalChoice(raw);
      await run.upstream.approval(run.runId, request.upstreamId, choice, request.generation);
    } else {
      const answer = input.answer ?? input.choice ?? "";
      if (!request.upstreamId) throw new Error("This question cannot be answered: the agent sent no request id.");
      await run.upstream.clarify(run.runId, request.upstreamId, answer, request.generation);
    }
    this.pending.delete(requestId);
    if (this.pending.size === 0 && !run.done) this.setStatus("running");
    return true;
  }

  // ---------------------------------------------------------------- approvals raised by the app

  /** Shows an approval card that another part of the app raised. Raising the same one twice shows it once. */
  raiseExternal(input: ExternalApprovalInput): string {
    const requestId = externalRequestId(input.kind, input.ref);
    const waits = (this.task.meta.externalApprovals ??= []);
    if (waits.some((w) => w.requestId === requestId)) return requestId;
    waits.push({ requestId, prior: waits[0]?.prior ?? this.task.status });
    const choices = input.choices?.length ? input.choices : ["Deny", "Allow"];
    this.emit({ type: "approval.request", requestId, kind: input.kind, title: input.title, ...(input.detail ? { detail: input.detail } : {}), choices });
    this.setStatus("waiting", (input.brief ?? input.title).slice(0, 200), true);
    this.taskDirty = true;
    this.scheduleFlush();
    return requestId;
  }

  /**
   * Closes an app-raised approval. With `deliver`, the answer first goes to the handler registered for its kind
   * (an error there leaves the card open and is thrown); without, it was already acted on elsewhere.
   * False when the card is not open.
   */
  async answerExternal(requestId: string, choice: string, deliver: boolean): Promise<boolean> {
    const open = () => (this.task.meta.externalApprovals ?? []).find((w) => w.requestId === requestId);
    const wait = open();
    if (!wait) return false;
    if (deliver) {
      const { kind, ref } = parseExternalRequestId(requestId);
      const handler = await approvalHandlerFor(kind);
      if (!handler) throw new Error(`Nothing can act on a "${kind}" approval.`);
      await handler({ userId: this.store.ownerId, taskId: this.id, ref, choice });
      // The handler may have closed the card itself (it reports decisions made anywhere).
      if (!open()) return true;
    }
    const rest = (this.task.meta.externalApprovals ?? []).filter((w) => w.requestId !== requestId);
    this.task.meta.externalApprovals = rest;
    this.emit({ type: "approval.resolved", requestId, choice });
    if (rest.length === 0 && this.pending.size === 0 && this.task.status === "waiting") {
      const running = this.run !== null && !this.run.done;
      const back: TaskStatus = running ? "running" : ACTIVE.has(wait.prior) ? "completed" : wait.prior;
      this.setStatus(back, undefined, true);
    }
    this.taskDirty = true;
    this.scheduleFlush();
    return true;
  }

  // ---------------------------------------------------------------- run lifecycle

  private newRun(upstream: Upstream, input: string | null, runId: string | null, upstreamSeq: number): ActiveRun {
    return {
      upstream,
      input,
      model: modelFor(this.task.meta.mode, this.task.meta.effort),
      fallback: false,
      startedAt: Date.now(),
      runId,
      upstreamSeq,
      abort: new AbortController(),
      done: false,
      closed: false,
      stopRequested: false,
      interrupting: false,
      text: "",
      splitMidMessage: false,
      lastCompleted: "",
      lastWasReasoning: false,
      calls: new Map(),
      anonymous: new Map(),
      open: [],
      steps: new Map(),
      reasoned: new Set(),
      said: [],
      written: new Map(),
      remote: remoteComputerId(this.task.meta.target) !== null,
      allowedApps: new Set(),
      bridging: false,
    };
  }

  /** The Hermes profile this task's runs use: the remote one when it was given another computer. */
  private get profile(): string | undefined {
    if (remoteComputerId(this.task.meta.target)) return REMOTE_PROFILE;
    const interaction = ext(this.task.meta).interaction;
    return interaction === "chat" || interaction === "plan" ? CHAT_PROFILE : undefined;
  }

  private activeWork: Promise<void> | undefined;

  async waitForActiveRun(): Promise<void> {
    try {
      await this.activeWork;
    } finally {
      await this.flush();
    }
  }

  /** Starts a run. `echo` emits the `user.message` for it first (false when it was emitted earlier). */
  private launch(text: string, echo: boolean): void {
    if (this.run) {
      // Never two runs at once; see `submit`.
      this.enqueue({ text, echoed: !echo });
      return;
    }
    if (echo) this.emit({ type: "user.message", text });
    const run = this.newRun(pickUpstream(this.store.ownerId, undefined, this.profile), text, null, -1);
    this.run = run;
    // Every run opens with an explicit status, even when the task never left "running" in between.
    if (this.task.status !== "waking") this.setStatus("running", undefined, true);
    this.activeWork = this.takeSlot(run, text)
      .then((granted) => (granted && !run.done ? this.drive(run, text) : undefined))
      .finally(() => this.afterRun(run));
  }

  /**
   * Waits for one of the owner's run slots. While it waits the task shows as queued ("waking" with a "Queued" brief
   * and `meta.queued`), and its prompt is kept in meta so a restart puts it back in the queue. False when it was
   * stopped while waiting.
   */
  private async takeSlot(run: ActiveRun, text: string): Promise<boolean> {
    const meta = ext(this.task.meta);
    const granted = await acquireSlot(this.store.ownerId, this.id, (ahead) => {
      if (run.done) return;
      if (!run.queued) {
        run.queued = true;
        meta.queued = true;
        meta.pendingStart = text;
        this.taskDirty = true;
      }
      this.setStatus("waking", ahead === 0 ? "Queued: starts as soon as a running task finishes" : `Queued: ${ahead} ${ahead === 1 ? "task" : "tasks"} ahead`, true);
    });
    if (run.queued) {
      run.queued = false;
      delete meta.queued;
      delete meta.pendingStart;
      this.taskDirty = true;
    }
    if (!granted || run.done) {
      if (granted) releaseSlot(this.store.ownerId, this.id);
      return false;
    }
    run.slot = true;
    if (this.task.status === "waking") this.setStatus("waking", "Starting the computer", true);
    return true;
  }

  private async drive(run: ActiveRun, text: string): Promise<void> {
    const meta = this.task.meta;
    try {
      const where = await this.prepareWhere(run);
      if (run.done) return;
      const extra = await this.contextInstructions(run);
      if (run.done) return;
      let busyTries = 0;
      for (;;) {
        const requested = modelFor(meta.mode, meta.effort);
        // A task that was moved off a model it cannot use stays off it, so its follow-ups do not fail first.
        run.model = requested === FABLE_MODEL && meta.fallbackModel ? meta.fallbackModel : requested;
        run.fallback = false;
        if (run.model !== requested) this.setStatus(this.task.status === "waking" ? "waking" : "running", FALLBACK_BRIEF, true);
        const connectorNames = meta.connectorLabels?.length ? meta.connectorLabels : meta.connectors;
        const connectors = connectorNames?.length ? ` The user enabled these connectors: ${connectorNames.join(", ")}.` : "";
        const skills = meta.skills?.length ? ` Load and follow these skills (skill_view) before starting: ${meta.skills.join(", ")}.` : "";
        let started: { runId: string };
        try {
          started = await run.upstream.start({
            input: text,
            sessionId: meta.sessionId,
            mode: meta.mode,
            effort: meta.effort,
            speed: meta.speed,
            model: run.model,
            instructions: this.baseInstructions() + (where ? ` ${where}` : "") + connectors + skills + (meta.instructions ? `\n\n${meta.instructions}` : "") + extra,
            idempotencyKey: `om-${this.id}-${Date.now().toString(36)}-${(++state.counter).toString(36)}`,
          });
        } catch (err) {
          // Hermes' own cap on runs at once (set to the same limit at setup) was hit by work outside the relay:
          // stay queued and try again.
          if (!run.done && /too many concurrent runs|\b429\b/i.test(errorText(err)) && (busyTries += 1) <= 120) {
            this.setStatus(this.task.status === "waking" ? "waking" : "running", "Queued: your computer is busy with other runs", true);
            await new Promise((r) => setTimeout(r, 5000));
            if (run.done) return;
            continue;
          }
          if (run.done || !this.modelUnavailable(run, errorText(err))) throw err;
          this.fallBack(run);
          continue;
        }
        const runId = started.runId;
        run.runId = runId;
        run.upstreamSeq = -1;
        // A stop that arrived while the run was still being created is delivered now, even if the
        // task already settled locally, so no run is left working unattended on the agent.
        if (run.stopRequested) await run.upstream.stop(runId).catch(() => undefined);
        if (run.done) return;
        meta.runId = runId;
        meta.upstreamSeq = -1;
        meta.driver = run.upstream.kind;
        this.taskDirty = true;
        if (!run.stopRequested) this.setStatus("running");
        await this.consume(run);
        if (run.done || !run.fallback) return;
        this.fallBack(run);
      }
    } catch (err) {
      if (!run.done) this.finishRun(run, { kind: "failed", error: errorText(err) });
    }
  }

  /** The instructions for how the agent works on this task: the full agent, Chat mode or Plan mode. */
  private baseInstructions(): string {
    const interaction = ext(this.task.meta).interaction;
    return interaction === "chat" ? CHAT_INSTRUCTIONS : interaction === "plan" ? PLAN_INSTRUCTIONS : AGENT_INSTRUCTIONS;
  }

  /**
   * Per-run context: the task handle for the app's tools, the tasks the user referenced, the parallel-task tools,
   * a side chat's view of its main task (read fresh every run), and a conversation carried over from another mode
   * or task (once, on the first run after the switch).
   */
  private async contextInstructions(run: ActiveRun): Promise<string> {
    const meta = ext(this.task.meta);
    const parts: string[] = [];
    // The project's instructions as they are now: an edit applies from the next message on.
    if (this.store.kind === "supabase" && this.task.projectId) {
      const project = await projectInstructions(this.store.ownerId, this.task.projectId);
      if (project) parts.push(project);
      if (run.upstream.kind === "hermes" && !remoteComputerId(meta.target)) {
        parts.push("This task is in a project. When the user asks you to update the project (its instructions, knowledge files or skills) from what was learned here, review the conversation and call omtools propose_project_update once with the full new text; the user approves the changes on a card.");
      }
    }
    if (run.upstream.kind === "hermes" && !remoteComputerId(meta.target)) {
      parts.push(`Your task handle for the omtools tools is ${this.id} (always pass it as task).`);
      // Cloud browser: whether sign-ins are kept between tasks, and to ask before keeping one (src/lib/browser).
      if (this.store.kind === "supabase") {
        const browser = await import("@/lib/browser").then((m) => m.browserInstructions(this.store.ownerId)).catch(() => "");
        if (browser) parts.push(browser);
      }
      if (this.store.kind === "supabase" && !meta.parentTaskId) {
        parts.push(`When the user asks for something on a schedule or a trigger, create it with omtools create_automation (list_automations, update_automation, delete_automation, run_automation_now manage them); for a relative time ("in 5 minutes") use repeat {freq:"once"} in UTC; it is now ${new Date().toISOString().slice(0, 16)} UTC.`);
      }
      if (meta.references?.length) {
        parts.push(
          "The user referenced these earlier tasks. Do not guess what they contain: read what you need with the omtools tools task_outline, task_search and task_read (ref = the task id), on demand.\n" +
            meta.references.map((r) => `- ${r.id}: ${r.title}`).join("\n"),
        );
      }
      if ((meta.interaction ?? "agent") === "agent" && !meta.parentTaskId) {
        parts.push("Only when the user asks for work to be split into parallel tasks: start them with omtools create_parallel_tasks (each with a complete, self-contained brief), check on them with parallel_tasks_status and read their answers with read_parallel_result before you write the combined result.");
      }
    }
    if (meta.childKind === "side" && meta.parentTaskId) {
      const parent = await this.store.getTask(meta.parentTaskId).catch(() => null);
      if (parent) {
        const events = await this.store.listEvents(parent.id).catch(() => []);
        parts.push(
          `This is a side chat next to the user's main task "${parent.title}" (status now: ${parent.status}). You cannot change, steer or interrupt the main task; ` +
            `answer questions about it and talk ideas through. The main task so far:\n<main_task>\n${transcriptText(events, 30_000)}\n</main_task>`,
        );
      }
    }
    if (meta.carryOver) {
      const text = meta.carryOverText ?? transcriptText(await this.allEvents(), 40_000, { dropLastUser: true });
      if (text.trim()) parts.push(`This conversation continues from earlier (another mode, or the task it was branched or continued from). The conversation so far:\n<conversation>\n${text}\n</conversation>`);
      meta.carryOver = false;
      delete meta.carryOverText;
      this.taskDirty = true;
    }
    return parts.length ? `\n\n${parts.join("\n\n")}` : "";
  }

  /** Answers this run's `omtools` calls while one is open (see `bridge.ts`). */
  private startBridge(run: ActiveRun): void {
    run.bridging = true;
    const open = () => !run.done && this.run === run && run.open.some((o) => omtoolsName(o.tool) !== null);
    void serviceBridge(this.store.ownerId, { store: this.store, taskId: this.id, askApproval: (title, detail) => this.askLocalApproval(run, title, detail) }, open)
      .catch((err) => console.warn(`[relay] task tools failed for task ${this.id}:`, errorText(err)))
      .finally(() => {
        run.bridging = false;
      });
  }

  /** Shows "Allow these actions?" for something the app's own tools want to do, and waits for the answer. */
  private askLocalApproval(run: ActiveRun, title: string, detail: string): Promise<boolean> {
    if (run.done) return Promise.resolve(false);
    const requestId = `local_${Date.now().toString(36)}${(++state.counter).toString(36)}`;
    return new Promise<boolean>((resolve) => {
      const settle = (allowed: boolean) => {
        if (!this.localApprovals.has(requestId)) return;
        this.localApprovals.delete(requestId);
        clearTimeout(timer);
        this.emit({ type: "approval.resolved", requestId, choice: allowed ? "Allow in this task" : "Deny" });
        if (!run.done && this.pending.size === 0 && this.localApprovals.size === 0 && this.task.status === "waiting") this.setStatus("running");
        resolve(allowed);
      };
      const timer = setTimeout(() => settle(false), LOCAL_APPROVAL_MS);
      this.localApprovals.set(requestId, settle);
      this.emit({ type: "approval.request", requestId, kind: "parallel", title: "Allow these actions?", detail: `${title}\n${detail}`, choices: ["Allow in this task", "Deny"] });
      this.setStatus("waiting", title.slice(0, 200));
    });
  }

  private denyLocalApprovals(): void {
    for (const settle of [...this.localApprovals.values()]) settle(false);
  }

  /** Reports a compaction Hermes made during this run in the work log (once per summary). */
  private async checkCompaction(run: ActiveRun): Promise<void> {
    if (!run.upstream.compactions) return;
    const meta = ext(this.task.meta);
    const found = await run.upstream.compactions(meta.sessionId).catch(() => null);
    if (!found || run.done || found.count <= (meta.compactions ?? 0)) return;
    meta.compactions = found.count;
    meta.longOffered = true;
    this.taskDirty = true;
    this.emit({ type: "context.compacted", long: true, ...(found.summary ? { summary: found.summary.slice(0, 600) } : {}) });
  }

  /**
   * Where the run works. A task given another computer is connected to it (its credential written on the
   * home computer for this run); any other task gets its own folder on the home computer.
   */
  private async prepareWhere(run: ActiveRun): Promise<string> {
    if (run.upstream.kind !== "hermes") return "";
    const owner = this.store.ownerId;
    const remoteId = remoteComputerId(this.task.meta.target);
    if (remoteId) {
      const target = await connectTarget(owner, this.id, remoteId, (brief) => {
        if (!run.done) this.setStatus(this.task.status === "waking" ? "waking" : "running", brief, true);
      });
      const files = await prepareProjectFiles(owner, ext(this.task.meta), { remote: { computerId: target.computerId, os: target.os }, taskId: this.id });
      if (files) this.taskDirty = true;
      return remoteInstructions(target) + (files ? ` ${files}` : "");
    }
    const meta = ext(this.task.meta);
    if (meta.sweptAt) forgetTaskFolder(this.id);
    const folder = await taskFolder(owner, this.id);
    if (!folder) return "";
    run.folder = folder;
    if (meta.sweptAt) {
      // The idle sweep removed this folder: put back what the task delivered or was given, from the file cache.
      const files = Object.values(meta.files ?? {});
      if (files.length) {
        this.setStatus(this.task.status === "waking" ? "waking" : "running", "Restoring the task's files", true);
        await restoreSwept(owner, files, (f) => cachedFile(this.id, f)).catch(() => 0);
      }
      delete meta.sweptAt;
      delete meta.projectFilesAt;
      this.taskDirty = true;
    }
    const files = await prepareProjectFiles(owner, meta, { folder });
    if (files) this.taskDirty = true;
    return folderInstructions(folder) + (files ? ` ${files}` : "");
  }

  /** True when a failure means only "this key may not use that model", and the run can be started again on another. */
  private modelUnavailable(run: ActiveRun, error: string): boolean {
    return run.input !== null && run.model === FABLE_MODEL && !run.stopRequested && MODEL_UNAVAILABLE.test(error);
  }

  /** Points the task at the replacement model. `drive` then starts the same run again and says so in a status event. */
  private fallBack(run: ActiveRun): void {
    const meta = this.task.meta;
    meta.fallbackModel = FALLBACK_MODEL;
    // The refused attempt left a "request was not processed" turn behind. A task that has nothing
    // else in its session yet starts the replacement on a clean one.
    if (!meta.turns) meta.sessionId = `openman-${this.id}-${Date.now().toString(36)}`;
    meta.runId = null;
    run.runId = null;
    run.upstreamSeq = -1;
    this.taskDirty = true;
    console.warn(`[relay] task ${this.id}: ${FABLE_MODEL} is not available on this key, running on ${FALLBACK_MODEL}`);
  }

  /** Reads the backend's event stream to the end, reconnecting from the last sequence number on a drop. */
  private async consume(run: ActiveRun): Promise<void> {
    const runId = run.runId!;
    let failures = 0;
    while (!run.done) {
      try {
        for await (const event of run.upstream.events(runId, { lastSeq: run.upstreamSeq, signal: run.abort.signal })) {
          failures = 0;
          if (typeof event.seq === "number") {
            run.upstreamSeq = event.seq;
            this.task.meta.upstreamSeq = event.seq;
          }
          await this.handle(run, event);
          if (run.done || run.fallback) return;
        }
      } catch (err) {
        if (run.done || run.abort.signal.aborted) return;
        console.warn(`[relay] event stream dropped for task ${this.id}:`, errorText(err));
      }
      if (run.done || run.abort.signal.aborted) return;
      // The stream ended without a terminal event. Ask the backend where the run stands.
      const status = await run.upstream.status(runId).catch(() => undefined);
      if (run.done || run.fallback) return;
      if (status === null) return this.finishRun(run, { kind: "failed", error: "The agent no longer knows this run." });
      if (status && TERMINAL_RUN_STATUSES.has(status.status)) return void (await this.finishFromStatus(run, status));
      if (++failures > 8) return this.finishRun(run, { kind: "failed", error: "Lost the connection to the agent." });
      await new Promise((r) => setTimeout(r, Math.min(15_000, 500 * 2 ** failures)));
    }
  }

  private async finishFromStatus(run: ActiveRun, status: HermesRunStatus): Promise<void> {
    if (status.status === "completed") {
      await this.complete(run, status.output ?? "", this.usageOf(status.usage));
    } else if (status.status === "cancelled") {
      this.finishRun(run, { kind: "cancelled" });
    } else {
      const error = str(status.error) ?? `The run ended as ${status.status}.`;
      if (this.modelUnavailable(run, `${error}\n${status.output ?? ""}`)) run.fallback = true;
      else this.finishRun(run, { kind: "failed", error, output: status.output });
    }
  }

  private usageOf(usage: unknown): { inputTokens: number; outputTokens: number } | undefined {
    if (!usage || typeof usage !== "object") return undefined;
    const u = usage as Record<string, unknown>;
    const inputTokens = num(u.input_tokens);
    const outputTokens = num(u.output_tokens);
    return inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
  }

  /** Closes the assistant message in progress. Skips an exact repeat of the one just closed. */
  private completeMessage(run: ActiveRun, text: string): void {
    const trimmed = text.trim();
    const streamed = run.text.trim();
    run.text = "";
    if (!trimmed) return;
    if (trimmed === run.lastCompleted && !streamed) return;
    this.emit({ type: "message.completed", text });
    run.lastCompleted = trimmed;
    run.said.push(trimmed);
  }

  /**
   * Closes the last assistant message of a run that is ending. The backend's final text is the
   * whole last message; if a user message split that message, its first part is already in the
   * transcript, so only what streamed after the split is closed here.
   */
  private closeFinalMessage(run: ActiveRun, outcome: Outcome): void {
    if (run.closed) return;
    run.closed = true;
    const finalText = outcome.kind === "cancelled" || (run.splitMidMessage && run.text.trim()) ? run.text : str(outcome.output) ?? run.text;
    this.completeMessage(run, finalText);
  }

  /** Tool calls still open when a run ends would spin forever in the UI; close them. */
  private closeOpenCalls(run: ActiveRun, label: string): void {
    for (const [callId, call] of run.calls) {
      this.emit({ type: "tool.completed", callId, tool: call.tool, error: true, preview: label, durationMs: Date.now() - call.startedAt });
    }
    run.calls.clear();
    run.open.length = 0;
  }

  /** A run that ended well: its answer first, then the files that answer delivers, then the end of the run. */
  private async complete(run: ActiveRun, output: string, usage?: { inputTokens: number; outputTokens: number }): Promise<void> {
    this.closeOpenCalls(run, "Interrupted");
    this.closeFinalMessage(run, { kind: "completed", output });
    await this.collectDeliverables(run, output);
    await this.checkCompaction(run);
    this.finishRun(run, { kind: "completed", output, usage });
  }

  private finishRun(run: ActiveRun, outcome: Outcome): void {
    if (run.done) return;
    run.done = true;
    run.outcome = outcome.kind;
    this.flushDelta();

    this.closeOpenCalls(run, outcome.kind === "cancelled" ? "Stopped" : "Interrupted");
    this.pending.clear();
    this.denyLocalApprovals();

    this.closeFinalMessage(run, outcome);

    this.task.meta.runId = null;
    this.task.meta.turns = (this.task.meta.turns ?? 0) + 1;
    ext(this.task.meta).lastRunAt = new Date().toISOString();
    // Keep a copy of what this run wrote, while it is certain to still be there.
    const wrote = [...run.written.keys()].map((path) => this.task.meta.files?.[fileIdFor(path)]).filter((f): f is StoredFile => !!f);
    if (wrote.length) prefetchFiles(this.id, wrote, this.store.ownerId, this.task.meta.target);
    if (run.remote) void disconnectTarget(this.store.ownerId, this.id);
    const more = this.queue.length > 0;
    // A card the app raised during the run (project changes, say) is still open: the task waits for it.
    const externalOpen = (this.task.meta.externalApprovals ?? []).length > 0;
    if (outcome.kind === "completed") {
      if (!more) this.setStatus(externalOpen ? "waiting" : "completed", externalOpen ? "Waiting for your approval" : undefined);
      this.emit(outcome.usage ? { type: "run.completed", usage: outcome.usage } : { type: "run.completed" });
    } else if (outcome.kind === "failed") {
      if (!more) this.setStatus("error", outcome.error.slice(0, 200));
      this.emit({ type: "run.failed", error: outcome.error });
      void logEvent("warn", "task.run_failed", { userId: this.store.ownerId, taskId: this.id, data: { reason: outcome.error.slice(0, 120) } });
    } else {
      // A plain stop drops whatever was queued; an interrupt moves straight on to the new message.
      if (!run.interrupting) this.queue.length = 0;
      if (!(run.interrupting && this.queue.length > 0)) this.setStatus("stopped");
    }
    this.taskDirty = true;
    void this.flush();
  }

  /** Starts the next queued message once a run has fully wound down. */
  private afterRun(run: ActiveRun): void {
    if (run.slot) {
      run.slot = false;
      releaseSlot(this.store.ownerId, this.id);
    }
    if (this.run !== run) return;
    this.run = null;
    // A plain stop emptied the queue when it settled, so whatever is here now arrived after it.
    const next = this.queue.shift();
    if (!next) return;
    this.taskDirty = true;
    this.launch(next.text, !next.echoed);
  }

  /** Picks up a run that was in flight when the server restarted, or marks the task stopped. */
  async resume(): Promise<void> {
    if (this.run || !ACTIVE.has(this.task.status)) return;
    // Waiting on an approval the app raised after the run ended: nothing was interrupted.
    if (this.task.status === "waiting" && !this.task.meta.runId && this.task.meta.externalApprovals?.length) return;
    const { runId, driver, upstreamSeq } = this.task.meta;
    const upstream = pickUpstream(this.store.ownerId, undefined, this.profile);
    const canReattach = !!runId && driver === "hermes" && upstream.kind === "hermes";
    // Queued when the server stopped: back in the queue with its prompt (its user message was already shown).
    const pendingStart = ext(this.task.meta).pendingStart;
    if (!runId && pendingStart) {
      delete ext(this.task.meta).queued;
      delete ext(this.task.meta).pendingStart;
      this.launch(pendingStart, false);
      return;
    }
    const run = canReattach ? this.newRun(upstream, null, runId!, upstreamSeq ?? -1) : null;
    // Claimed before the first await so a second caller cannot resume the same task twice.
    this.run = run;
    if (run) {
      claimSlot(this.store.ownerId, this.id);
      run.slot = true;
    }

    // Tool calls that were open when the old process died, read back from the stored events.
    const open = new Map<string, { tool: string; startedAt: number; preview?: string }>();
    try {
      for (const event of await this.store.listEvents(this.id)) {
        if (event.type === "tool.started") open.set(event.callId, { tool: event.tool, startedAt: Date.parse(event.at), preview: event.preview });
        else if (event.type === "tool.completed") open.delete(event.callId);
      }
    } catch (err) {
      console.warn(`[relay] could not read back events for task ${this.id}:`, errorText(err));
    }

    if (run) {
      for (const [callId, call] of open) {
        run.calls.set(callId, call);
        run.open.push({ id: callId, tool: call.tool });
      }
      void this.consume(run)
        .catch((err) => {
          if (!run.done) this.finishRun(run, { kind: "failed", error: errorText(err) });
        })
        .finally(() => {
          // Every way out of `consume` settles the run; this is the guard for one that did not.
          if (!run.done) this.finishRun(run, { kind: "failed", error: "Lost track of the agent run." });
          this.afterRun(run);
        });
      return;
    }
    for (const [callId, call] of open) {
      this.emit({ type: "tool.completed", callId, tool: call.tool, error: true, preview: "Interrupted", durationMs: Math.max(0, Date.now() - call.startedAt) });
    }
    this.task.meta.runId = null;
    this.queue.length = 0;
    this.setStatus("stopped", "Interrupted by a server restart");
  }

  // ---------------------------------------------------------------- event mapping

  /** Maps one backend event onto zero or more `AgentEvent`s. */
  private async handle(run: ActiveRun, ev: HermesEvent): Promise<void> {
    // Only the run that holds the task may write to its event log.
    if (run.done || this.run !== run) return;
    const wasReasoning = run.lastWasReasoning;
    run.lastWasReasoning = false;

    switch (ev.event) {
      case "message.delta": {
        let text = str(ev.delta) ?? str(ev.text);
        // Hermes separates steps with blank lines; a message should not start with them.
        if (text && !run.text) text = text.replace(/^\s+/, "");
        if (!text) return;
        run.text += text;
        this.delta("message.delta", text);
        return;
      }

      case "reasoning.available":
      case "reasoning.delta": {
        const text = str(ev.text) ?? str(ev.delta);
        if (!text) return;
        // `reasoning.available` carries a whole block; keep consecutive blocks apart.
        this.delta("reasoning.delta", ev.event === "reasoning.available" && wasReasoning ? `\n\n${text}` : text);
        run.lastWasReasoning = ev.event === "reasoning.available";
        return;
      }

      case "message.interim": {
        // Commentary the model wrote next to its tool calls. It may or may not have been streamed already.
        const text = str(ev.text);
        if (run.splitMidMessage) {
          // Only the part streamed after the user message is still open.
          if (run.text.trim()) this.completeMessage(run, run.text);
        } else if (text) this.completeMessage(run, text);
        run.splitMidMessage = false;
        return;
      }

      case "tool.started": {
        const tool = str(ev.tool) ?? "tool";
        run.open.push({ id: str(ev.tool_call_id), tool });
        if (!run.bridging && omtoolsName(tool)) this.startBridge(run);
        if (run.text.trim()) this.completeMessage(run, run.text);
        run.splitMidMessage = false;
        if (PLUMBING_TOOLS.has(tool)) return;
        let callId = str(ev.tool_call_id);
        // The step behind the call: its reasoning goes out before the call it led to.
        const step = callId ? await this.stepFor(run, callId) : undefined;
        if (run.done) return;
        if (step?.reasoning && !run.reasoned.has(step.messageId)) {
          run.reasoned.add(step.messageId);
          // Blocks that end up back to back (nothing visible follows a todo call) are kept apart.
          const adjacent = this.pendingDelta ? this.pendingDelta.type === "reasoning.delta" : this.log[this.log.length - 1]?.type === "reasoning.delta";
          this.delta("reasoning.delta", adjacent ? `\n\n${step.reasoning}` : step.reasoning);
        }
        if (/^todo/.test(tool)) return; // todo calls surface as plan.updated on completion
        if (!callId) {
          callId = `call_${(++state.counter).toString(36)}`;
          const ids = run.anonymous.get(tool) ?? [];
          ids.push(callId);
          run.anonymous.set(tool, ids);
        }
        const args = (step?.calls.find((c) => c.id === callId && c.tool === tool) ?? step?.calls.find((c) => c.id === callId))?.args;
        if (tool === "computer_use" && typeof args?.app === "string" && args.app.trim()) run.lastApp = args.app.trim();
        const bridged = omtoolsName(tool);
        const preview = str(ev.preview) ?? (args && tool === "computer_use" ? computerUsePreview(args) : bridged ? omtoolsPreview(bridged, args ?? {}) : undefined);
        run.calls.set(callId, { tool, startedAt: Date.now(), preview });
        this.emit(preview ? { type: "tool.started", callId, tool, preview } : { type: "tool.started", callId, tool });
        return;
      }

      case "tool.completed":
      case "tool.failed": {
        const tool = str(ev.tool) ?? "tool";
        const upstreamCallId = str(ev.tool_call_id);
        const at = run.open.findIndex((o) => o.tool === tool && (!upstreamCallId || !o.id || o.id === upstreamCallId));
        if (at >= 0) run.open.splice(at, 1);
        if (PLUMBING_TOOLS.has(tool)) return;
        const failed = ev.event === "tool.failed" || ev.error === true;
        // Some gateways send the result preview inline; others leave it empty and the
        // result has to be read from the session transcript.
        let result = str(ev.preview);
        if (!result && upstreamCallId && run.upstream.toolResult) {
          result = await run.upstream.toolResult(this.task.meta.sessionId, upstreamCallId).catch(() => undefined);
          if (run.done) return;
        }
        const preview = result ? resultPreview(result) || undefined : undefined;
        if (/^todo/.test(tool)) {
          if (result && !failed) this.updatePlan(result);
          return;
        }
        const callId = upstreamCallId ?? run.anonymous.get(tool)?.shift() ?? `call_${(++state.counter).toString(36)}`;
        const started = run.calls.get(callId);
        run.calls.delete(callId);
        const seconds = num(ev.duration);
        // A zero duration means the gateway did not measure it; fall back to our own clock.
        const durationMs = seconds ? Math.round(seconds * 1000) : started ? Date.now() - started.startedAt : undefined;
        this.emit({
          type: "tool.completed",
          callId,
          tool,
          ...(preview ? { preview } : {}),
          ...(failed ? { error: true } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
        if (tool === "computer_use" && result) {
          const app = /"app"\s*:\s*"([^"]{1,80})"/.exec(result)?.[1];
          if (app) run.lastApp = app;
        }
        const remoteWrite = tool === "mcp__omtarget__write_file";
        if (!failed && (tool === "write_file" || tool === "patch" || remoteWrite)) this.filesWritten(run, tool === "write_file" || remoteWrite ? started?.preview : undefined, result);
        return;
      }

      case "subagent.start": {
        const callId = `sub_${str(ev.subagent_id) ?? str(ev.child_session_id) ?? str(ev.delegation_id) ?? (++state.counter).toString(36)}`;
        const preview = str(ev.goal) ?? str(ev.preview);
        run.calls.set(callId, { tool: "subagent", startedAt: Date.now(), preview });
        this.emit(preview ? { type: "tool.started", callId, tool: "subagent", preview } : { type: "tool.started", callId, tool: "subagent" });
        return;
      }

      case "subagent.complete": {
        const key = str(ev.subagent_id) ?? str(ev.child_session_id) ?? str(ev.delegation_id);
        const callId = key ? `sub_${key}` : ([...run.calls].find(([, c]) => c.tool === "subagent")?.[0] ?? `sub_${(++state.counter).toString(36)}`);
        const started = run.calls.get(callId);
        run.calls.delete(callId);
        const preview = str(ev.summary) ?? str(ev.preview) ?? str(ev.output_tail);
        const status = str(ev.status);
        const seconds = num(ev.duration_seconds);
        const failed = status !== undefined && !["completed", "success", "ok", "done"].includes(status);
        this.emit({
          type: "tool.completed",
          callId,
          tool: "subagent",
          ...(preview ? { preview } : {}),
          ...(failed ? { error: true } : {}),
          durationMs: seconds !== undefined ? Math.round(seconds * 1000) : started ? Date.now() - started.startedAt : 0,
        });
        return;
      }

      case "approval.request": {
        const upstreamId = str(ev.request_id) ?? str(ev.prompt_id) ?? str(ev.approval_id);
        const requestId = upstreamId ?? `apr_${(++state.counter).toString(36)}`;
        const raw = Array.isArray(ev.choices) ? ev.choices.filter((c): c is string => typeof c === "string") : [];
        const choices = raw.length ? raw : ["once", "deny"];
        const choiceMap: Record<string, string> = {};
        const labels = choices.map((choice) => {
          const label = APPROVAL_LABELS[choice] ?? choice;
          choiceMap[label] = choice;
          return label;
        });
        const command = str(ev.command);
        const title = str(ev.description) ?? str(ev.title) ?? "The agent needs your approval to continue";
        // Clicks, typing and key presses on the desktop are the work itself, not a decision for the user:
        // they are allowed for the whole session here and never become a card.
        if (run.runId && this.isDesktopApproval(run, ev)) {
          const app = this.computerUseApp(run, ev);
          if (app) {
            // Computer Use: the user's stored choice for this app decides; an app they never decided on is asked about.
            const stored = run.allowedApps.has(app.toLowerCase()) ? "always" : await appPermission(this.store.ownerId, app);
            if (run.done) return;
            if (stored && (await this.answerApproval(run, upstreamId, stored === "never" ? "deny" : "once", num(ev.execution_generation)))) return;
            if (run.done) return;
            if (!stored) {
              this.pending.set(requestId, { kind: "approval", upstreamId, generation: num(ev.execution_generation), choiceMap: {}, app });
              const ask = `Allow the agent to use ${app}?`;
              this.emit({ type: "approval.request", requestId, kind: "app", title: ask, detail: command ?? title, choices: [APP_CHOICES.allow, APP_CHOICES.always, APP_CHOICES.never] });
              this.setStatus("waiting", ask);
              return;
            }
          } else {
            // The browser is the agent's own tool, not a desktop app: its actions are the work itself.
            const choice = ["session", "once", "always"].find((c) => choices.includes(c));
            if (choice && (await this.answerApproval(run, upstreamId, choice, num(ev.execution_generation)))) return;
            if (run.done) return;
          }
        }
        this.pending.set(requestId, { kind: "approval", upstreamId, generation: num(ev.execution_generation), choiceMap });
        this.emit({
          type: "approval.request",
          requestId,
          kind: command ? "command" : "action",
          title,
          ...(command ? { detail: command } : {}),
          choices: labels,
        });
        this.setStatus("waiting", title.slice(0, 200));
        return;
      }

      case "clarify.request": {
        const upstreamId = str(ev.prompt_id) ?? str(ev.request_id) ?? str(ev.clarify_id);
        const requestId = upstreamId ?? `clr_${(++state.counter).toString(36)}`;
        const text = str(ev.question) ?? str(ev.text) ?? str(ev.content) ?? str(ev.prompt) ?? "The agent has a question for you.";
        const rawOptions = Array.isArray(ev.choices) ? ev.choices : Array.isArray(ev.options) ? ev.options : [];
        const options = rawOptions
          .map((o) => (typeof o === "string" ? o : o && typeof o === "object" ? str((o as Record<string, unknown>).label) : undefined))
          .filter((o): o is string => !!o);
        this.pending.set(requestId, { kind: "question", upstreamId, generation: num(ev.execution_generation), choiceMap: {} });
        this.emit({
          type: "question",
          requestId,
          text,
          ...(options.length ? { options } : {}),
          ...(ev.multiple === true ? { multiple: true } : {}),
        });
        this.setStatus("waiting", text.slice(0, 200));
        return;
      }

      case "approval.responded":
      case "approval.settled":
      case "clarify.settled": {
        // Also arrives when someone answered from another surface, so the request is closed here too.
        const id = str(ev.request_id) ?? str(ev.prompt_id);
        if (id) this.pending.delete(id);
        else this.pending.clear();
        if (this.pending.size === 0 && this.task.status === "waiting") this.setStatus("running");
        return;
      }

      case "run.completed": {
        this.takePendingSteer(ev);
        await this.complete(run, str(ev.output) ?? "", this.usageOf(ev.usage));
        return;
      }

      case "run.cancelled": {
        if (run.interrupting) this.takePendingSteer(ev);
        this.finishRun(run, { kind: "cancelled" });
        return;
      }

      case "run.failed":
      case "run.interrupted": {
        const reason = str(ev.error) ?? str(ev.turn_exit_reason) ?? "The agent run failed.";
        if (ev.event === "run.failed" && this.modelUnavailable(run, reason)) {
          // Not a failure of the task: `drive` starts the same run again on the replacement model.
          run.fallback = true;
          return;
        }
        this.takePendingSteer(ev);
        this.finishRun(run, { kind: "failed", error: reason, output: str(ev.output) });
        return;
      }

      default:
        // run.steered, run.queued, replay.truncated and anything newer need no UI event.
        return;
    }
  }

  /** Steer text Hermes accepted but never delivered comes back on the terminal event; run it as the next turn. */
  private takePendingSteer(ev: HermesEvent): void {
    const text = str(ev.pending_steer);
    if (text) this.queue.unshift({ text, echoed: true });
  }

  private updatePlan(preview: string): void {
    const parsed = parseTodos(preview);
    if (!parsed) return;
    if (parsed.complete) {
      this.plan = parsed.steps;
    } else {
      // A cut-off list only shows its first items; keep what is known about the rest.
      const byId = new Map(parsed.steps.map((s) => [s.id, s]));
      const merged = this.plan.map((s) => byId.get(s.id) ?? s);
      const known = new Set(this.plan.map((s) => s.id));
      this.plan = [...merged, ...parsed.steps.filter((s) => !known.has(s.id))];
    }
    const steps = this.plan.map(({ title, status }) => ({ title, status }));
    const json = JSON.stringify(steps);
    if (json === this.lastPlanJson) return;
    this.lastPlanJson = json;
    this.emit({ type: "plan.updated", steps });
  }

  /** The model step that made a tool call, from the transcript. One read covers every call of the step. */
  private async stepFor(run: ActiveRun, callId: string): Promise<HermesStep | undefined> {
    const known = run.steps.get(callId);
    if (known || !run.upstream.step) return known;
    const step = await run.upstream.step(this.task.meta.sessionId, callId).catch(() => undefined);
    if (step) for (const call of step.calls) run.steps.set(call.id, step);
    return step;
  }

  /**
   * True for an approval that only asks whether the agent may act on the desktop or in the browser.
   * The runs stream sends just the prompt's text (`command`, `description`), which a shell command
   * could imitate, so the request is judged by what is running instead: it qualifies only if every
   * tool the backend has open is a desktop or browser one. When an event does carry Hermes' own
   * `pattern_key` (`cua:<action>:<mode>` for desktop actions), that decides.
   */
  private isDesktopApproval(run: ActiveRun, ev: HermesEvent): boolean {
    const keys = [ev.pattern_key, ...(Array.isArray(ev.pattern_keys) ? ev.pattern_keys : [])].filter((k): k is string => typeof k === "string" && k.length > 0);
    if (keys.length > 0) return keys.every((k) => /^(cua|computer_use|browser)[:_]/.test(k));
    // Tool loading and the task list never ask for approval, so they do not count either way.
    const open = run.open.filter((o) => !PLUMBING_TOOLS.has(o.tool) && !/^todo/.test(o.tool));
    return open.length > 0 && open.every((o) => isDesktopTool(o.tool));
  }

  /**
   * The desktop app a Computer Use approval is about, or undefined when it is not a Computer Use one (the
   * browser). Read from the open call's arguments, else the app the agent last named or captured.
   */
  private computerUseApp(run: ActiveRun, ev: HermesEvent): string | undefined {
    const keys = [ev.pattern_key, ...(Array.isArray(ev.pattern_keys) ? ev.pattern_keys : [])].filter((k): k is string => typeof k === "string");
    const cuaKey = keys.some((k) => /^(cua|computer_use)[:_]/.test(k));
    const open = run.open.find((o) => o.tool === "computer_use" || o.tool === "computer");
    if (!cuaKey && !open) return undefined;
    const call = open?.id ? run.steps.get(open.id)?.calls.find((c) => c.id === open.id) : undefined;
    const named = typeof call?.args.app === "string" ? call.args.app.trim() : "";
    return named || run.lastApp || "Desktop";
  }

  /** Answers an approval on the user's behalf. False when it could not be delivered and the user has to see it after all. */
  private async answerApproval(run: ActiveRun, upstreamId: string | undefined, choice: string, generation?: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await run.upstream.approval(run.runId!, upstreamId, choice, generation);
        return true;
      } catch (err) {
        const status = (err as { status?: unknown }).status;
        // 409: answered already, or the turn moved on. Either way there is nothing left to ask.
        if (status === 409) return true;
        console.warn(`[relay] could not auto-approve a desktop action for task ${this.id}:`, errorText(err));
        if (run.done) return true;
      }
    }
    return false;
  }

  /** Records a file and announces it once. Writing it again only marks the stored copy as out of date. */
  private noteFile(run: ActiveRun, path: string, size?: number): void {
    const name = fileNameOf(path);
    if (!path.startsWith("/") || !name || name.startsWith(".") || /\/\.[^/]+\//.test(path)) return;
    const files = (this.task.meta.files ??= {});
    const fileId = fileIdFor(path);
    const known = files[fileId];
    const mime = mimeFor(name);
    const version = `${Date.now().toString(36)}${(++state.counter).toString(36)}`;
    files[fileId] = {
      fileId,
      path,
      name,
      ...(mime ? { mime } : {}),
      ...(size !== undefined ? { size } : known?.size !== undefined ? { size: known.size } : {}),
      version,
      at: known?.at ?? new Date().toISOString(),
    };
    run.written.set(path, size);
    this.taskDirty = true;
    if (known) {
      this.scheduleFlush();
      return;
    }
    this.emit({ type: "file.created", fileId, name, ...(mime ? { mime } : {}), ...(size !== undefined ? { size } : {}) });
  }

  /** Files named by the result of a `write_file` or `patch` call. */
  private filesWritten(run: ActiveRun, startedPath: string | undefined, resultText: string | undefined): void {
    let size: number | undefined;
    const paths: string[] = [];
    try {
      const result = JSON.parse(resultText ?? "") as Record<string, unknown>;
      size = num(result.bytes_written) ?? num(result.size) ?? num(result.bytes);
      if (Array.isArray(result.files_modified)) paths.push(...result.files_modified.filter((f): f is string => typeof f === "string"));
      // The call preview can be cut short; the result names the file in full.
      const named = str(result.resolved_path) ?? str(result.path);
      if (named && !paths.includes(named)) paths.push(named);
    } catch {
      // The result is free text for some backends.
    }
    if (paths.length === 0 && startedPath?.trim()) paths.push(startedPath.trim());
    for (const path of paths) this.noteFile(run, path, paths.length === 1 ? size : undefined);
  }

  /**
   * Files the agent made without a file tool (a script's output, a download, a document it
   * converted) are only known from what it says. Every path or file name in the run's messages is
   * checked on the computer, and those that changed during the run are announced. Called before
   * the run is closed so the files land inside the turn; it gives up rather than hold the end back.
   */
  private async collectDeliverables(run: ActiveRun, output: string): Promise<void> {
    const remoteId = remoteComputerId(this.task.meta.target);
    const cfg =
      run.upstream.kind !== "hermes" ? null : remoteId ? await targetComputerConfig(this.store.ownerId, remoteId).catch(() => null) : computerFor(this.store.ownerId);
    if (!cfg || run.done) return;
    const candidates = [...new Set([...run.said, output].flatMap(fileCandidates))];
    if (candidates.length === 0) return;
    const dirs = [...new Set([...(run.folder ? [run.folder] : []), ...[...run.written.keys()].map((path) => path.slice(0, path.lastIndexOf("/"))).filter(Boolean)])];
    const ageSec = (Date.now() - run.startedAt) / 1000 + 15;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const found = await Promise.race([
        findFiles(cfg, candidates, ageSec, dirs),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), DELIVERABLES_WAIT_MS);
        }),
      ]);
      if (run.done || !found) return;
      for (const file of found) {
        // Written by a file tool and unchanged since: already announced.
        if (run.written.has(file.path) && (run.written.get(file.path) === undefined || run.written.get(file.path) === file.size)) continue;
        this.noteFile(run, file.path, file.size);
      }
    } catch (err) {
      console.warn(`[relay] could not check the files of task ${this.id}:`, errorText(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

// -------------------------------------------------------------------- registry

function evictIdle(): void {
  const now = Date.now();
  for (const [id, runtime] of state.runtimes) {
    if (runtime.isIdle && now - runtime.lastTouched > IDLE_EVICT_MS) state.runtimes.delete(id);
  }
}

// ---------------------------------------------------------------- approvals raised from outside the agent

/** An approval card another part of the app shows in a task, such as "allow this SMS?" from the phone feature. */
export interface ExternalApprovalInput {
  /** Who acts on the answer, e.g. "sms". Letters, digits and dashes. */
  kind: string;
  /** The raiser's own id for the thing being approved, e.g. the pending SMS row. */
  ref: string;
  title: string;
  detail?: string;
  /** Button labels; refusals ("Deny", "Don't send") read as no. Default: Deny, Allow. */
  choices?: string[];
  /** Status line while the card is open. Default: the title. */
  brief?: string;
}

/** Called with the user's answer from the card. Throw to keep the card open and show the error. */
export type ExternalApprovalHandler = (answer: { userId: string; taskId: string; ref: string; choice: string }) => Promise<void>;

const EXTERNAL_PREFIX = "ext:";
const KIND = /^[a-z0-9-]{1,32}$/;
const isExternalRequestId = (id: string) => id.startsWith(EXTERNAL_PREFIX);
function externalRequestId(kind: string, ref: string): string {
  if (!KIND.test(kind)) throw new Error(`Invalid approval kind: ${kind}`);
  return `${EXTERNAL_PREFIX}${kind}:${ref}`;
}
function parseExternalRequestId(id: string): { kind: string; ref: string } {
  const rest = id.slice(EXTERNAL_PREFIX.length);
  const cut = rest.indexOf(":");
  return { kind: rest.slice(0, cut), ref: rest.slice(cut + 1) };
}

const gh = globalThis as typeof globalThis & { __omApprovalHandlers?: Map<string, ExternalApprovalHandler> };
const approvalHandlers: Map<string, ExternalApprovalHandler> = (gh.__omApprovalHandlers ??= new Map());
/** Modules that register a handler, loaded on first use so an answer works even before they were imported. */
const HANDLER_MODULES: Record<string, () => Promise<unknown>> = {
  sms: () => import("@/lib/phone/approvals"),
  "project-update": () => import("./project-updates"),
};

/** Registers who acts on answers to approvals of `kind`. */
export function registerApprovalHandler(kind: string, handler: ExternalApprovalHandler): void {
  approvalHandlers.set(kind, handler);
}

async function approvalHandlerFor(kind: string): Promise<ExternalApprovalHandler | undefined> {
  if (!approvalHandlers.has(kind)) await HANDLER_MODULES[kind]?.();
  return approvalHandlers.get(kind);
}

async function runtimeOf(store: Store, taskId: string): Promise<TaskRuntime | null> {
  if (!isValidTaskId(taskId)) return null;
  const live = liveRuntime(store, taskId);
  if (live) return live;
  const task = await store.getTask(taskId);
  return task ? openRuntime(store, task) : null;
}

/**
 * Shows an approval card in a task, raised by the app rather than the agent (the task need not be running).
 * The user's answer goes to the handler registered for `input.kind`. Returns the request id, or null when the
 * task does not exist for the store's owner.
 */
export async function raiseApproval(store: Store, taskId: string, input: ExternalApprovalInput): Promise<string | null> {
  const runtime = await runtimeOf(store, taskId);
  return runtime ? runtime.raiseExternal(input) : null;
}

/** Closes an app-raised card that was answered somewhere else (by text message, say). False when it was not open. */
export async function settleApproval(store: Store, taskId: string, kind: string, ref: string, choice: string): Promise<boolean> {
  const runtime = await runtimeOf(store, taskId);
  return runtime ? runtime.answerExternal(externalRequestId(kind, ref), choice, false) : false;
}

/** The live runtime for a task, if one exists and belongs to the same owner. */
export function liveRuntime(store: Store, id: string): TaskRuntime | null {
  const runtime = state.runtimes.get(id);
  if (!runtime || runtime.store.kind !== store.kind || runtime.store.ownerId !== store.ownerId) return null;
  // A dev-server reload leaves runtimes built from the previous version of this module. One that
  // is doing nothing is dropped, so the task is reopened with the current code.
  const built: object = runtime;
  if (!(built instanceof TaskRuntime) && runtime.isIdle) {
    state.runtimes.delete(id);
    return null;
  }
  runtime.adoptStore(store);
  return runtime;
}

/** Registers the runtime for a task that was just created. */
export function createRuntime(store: Store, task: TaskRecord): TaskRuntime {
  evictIdle();
  const runtime = new TaskRuntime(store, task, 0);
  state.runtimes.set(task.id, runtime);
  return runtime;
}

/**
 * The runtime for an existing task, created on demand. The caller must have loaded `task`
 * through `store`, which is what proves the requester may see it.
 */
export async function openRuntime(store: Store, task: TaskRecord): Promise<TaskRuntime> {
  const live = liveRuntime(store, task.id);
  if (live) return live;
  const inFlight = state.opening.get(task.id);
  if (inFlight) return inFlight;
  evictIdle();
  const opening = (async () => {
    const lastSeq = await store.lastSeq(task.id);
    const runtime = new TaskRuntime(store, task, lastSeq);
    state.runtimes.set(task.id, runtime);
    await runtime.resume();
    return runtime;
  })().finally(() => state.opening.delete(task.id));
  state.opening.set(task.id, opening);
  return opening;
}

/** Drops a deleted task's runtime for good; its pending writes are abandoned. */
export function forgetRuntime(id: string): void {
  const runtime = state.runtimes.get(id);
  if (!runtime) return;
  runtime.deleted = true;
  runtime.discard();
}

/** Hands a fresh store (and with it a fresh access token) to every live task of the same owner. */
export function refreshOwner(store: Store): void {
  if (store.kind !== "supabase") return;
  for (const runtime of state.runtimes.values()) runtime.adoptStore(store);
}

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE.has(status);
}
