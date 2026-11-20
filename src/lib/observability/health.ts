// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * The deep health check (`GET /api/health/deep`, `/app/admin`). Every figure is a count or an age; no row content,
 * no personal data, no secret values (configuration is reported by name only). Server only.
 */
import { db, dbConfigured } from "@/lib/db/client";
import { SETUP_VERSION } from "@/lib/provision";
import { GLOBAL_PER_HOUR } from "@/lib/session/signin-limit";
import { readHeartbeat, TICK, TICK_LATE_MS } from "./heartbeat";

export type CheckState = "ok" | "warn" | "fail" | "off";

export interface DeepHealth {
  ok: boolean;
  at: string;
  environment: string;
  checks: {
    database: { state: CheckState; ms: number | null; detail?: string };
    gate: { state: CheckState; detail: string };
    scheduler: { state: CheckState; lastTickAt: string | null; ageSeconds: number | null; lastErrors: number | null };
    webhooks: { state: CheckState; pending: number | null; overdue: number | null; failedLast24h: number | null };
    automations: { state: CheckState; enabled: number | null; failing: number | null; paused: number | null; overdue: number | null; openRuns: number | null };
    provisioning: { state: CheckState; latestSetupVersion: number; behind: number | null; stuck: number | null; failedLast24h: number | null };
    signIn: { state: CheckState; startsThisHour: number | null; budgetPerHour: number };
    errors: { state: CheckState; lastHour: number | null; last24h: number | null };
  };
  config: { required: Record<string, boolean>; optional: Record<string, boolean> };
}

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "APP_DB_SECRET", "SESSION_SECRET", "APP_ENCRYPTION_KEY", "CRON_SECRET", "APP_PUBLIC_URL"] as const;
const OPTIONAL = ["ELEVENLABS_API_KEY", "AGENTMAIL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "AGENTPHONE_API_KEY", "AGENTPHONE_WEBHOOK_SECRET", "OPS_ALERT_WEBHOOK_URL", "OPERATOR_USER_IDS", "INVITE_GATE"] as const;

const present = (name: string) => !!process.env[name]?.trim();
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3600_000;

/** The few PostgREST filters the counts use, typed loosely so one helper serves every table. */
interface CountQuery extends PromiseLike<{ count: number | null; error: unknown }> {
  eq(column: string, value: unknown): CountQuery;
  lt(column: string, value: unknown): CountQuery;
  gt(column: string, value: unknown): CountQuery;
  gte(column: string, value: unknown): CountQuery;
  in(column: string, values: unknown[]): CountQuery;
  is(column: string, value: null): CountQuery;
  not(column: string, operator: string, value: unknown): CountQuery;
}

async function count(table: string, build: (q: CountQuery) => CountQuery): Promise<number | null> {
  try {
    const q = db().from(table).select("*", { count: "exact", head: true }) as unknown as CountQuery;
    const { count: n, error } = await build(q);
    return error ? null : (n ?? 0);
  } catch {
    return null;
  }
}

/** Current global sign-in window (signin-limit.ts uses fixed one-hour windows on `api_rate_limits`). */
export async function signInStartsThisHour(): Promise<number | null> {
  try {
    const start = new Date(Math.floor(Date.now() / HOUR) * HOUR).toISOString();
    const { data, error } = await db().from("api_rate_limits").select("count").eq("bucket", "signin:global").eq("window_start", start).maybeSingle();
    if (error) return null;
    return Number((data as { count?: number } | null)?.count ?? 0);
  } catch {
    return null;
  }
}

export async function deepHealth(): Promise<DeepHealth> {
  const at = new Date().toISOString();
  const shared = process.env.APP_DB_SCHEMA === "mahara";
  const requiredNames = shared
    ? [...REQUIRED.filter((name) => name !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "APP_DB_API_KEY", "APP_DB_ACCESS_TOKEN"]
    : REQUIRED;
  const required = Object.fromEntries(requiredNames.map((n) => [n, present(n)]));
  const optional = Object.fromEntries(OPTIONAL.map((n) => [n, present(n)]));

  // Database reachable, and the gate working: the server header gets a row; an anonymous client gets none.
  let database: DeepHealth["checks"]["database"] = { state: "fail", ms: null, detail: "not configured" };
  let gate: DeepHealth["checks"]["gate"] = { state: "fail", detail: "not checked" };
  if (dbConfigured()) {
    const t = Date.now();
    try {
      const { error } = await db().from("ops_heartbeats").select("name").limit(1).abortSignal(AbortSignal.timeout(4000));
      database = error ? { state: "fail", ms: Date.now() - t, detail: "query refused" } : { state: "ok", ms: Date.now() - t };
    } catch {
      database = { state: "fail", ms: Date.now() - t, detail: "unreachable" };
    }
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.APP_DB_API_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const res = await fetch(`${url}/rest/v1/accounts?select=user_id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": process.env.APP_DB_SCHEMA || "public" },
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      const rows = res.ok ? ((await res.json()) as unknown[]) : [];
      gate = res.ok && rows.length === 0 ? { state: "ok", detail: "anonymous read returns no rows" } : !res.ok ? { state: "ok", detail: `anonymous read refused (${res.status})` } : { state: "fail", detail: "anonymous read returned rows" };
    } catch {
      gate = { state: "warn", detail: "anonymous probe did not answer" };
    }
  }
  const dbUp = database.state === "ok";

  const tickBeat = dbUp ? await readHeartbeat(TICK).catch(() => null) : null;
  const ageMs = tickBeat ? Date.now() - Date.parse(tickBeat.at) : null;
  const lastErrors = tickBeat?.detail && typeof tickBeat.detail.errors === "number" ? (tickBeat.detail.errors as number) : null;
  const scheduler: DeepHealth["checks"]["scheduler"] = {
    state: !dbUp ? "fail" : ageMs === null ? "warn" : ageMs > TICK_LATE_MS ? "fail" : lastErrors ? "warn" : "ok",
    lastTickAt: tickBeat?.at ?? null,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    lastErrors,
  };

  const [pending, overdue, whFailed, enabled, failing, paused, autoOverdue, openRuns, behind, stuck, provFailed, errHour, errDay, startsThisHour] = dbUp
    ? await Promise.all([
        count("webhook_deliveries", (q) => q.eq("status", "pending")),
        count("webhook_deliveries", (q) => q.eq("status", "pending").lt("next_attempt_at", iso(10 * 60_000))),
        count("webhook_deliveries", (q) => q.eq("status", "failed").gte("created_at", iso(24 * HOUR))),
        count("automations", (q) => q.eq("enabled", true)),
        count("automations", (q) => q.gt("failure_count", 0)),
        count("automations", (q) => q.not("paused_reason", "is", null)),
        count("automations", (q) => q.eq("enabled", true).lt("next_run_at", iso(10 * 60_000))),
        count("automation_runs", (q) => q.in("status", ["queued", "running"])),
        count("accounts", (q) => q.not("home_computer_id", "is", null).lt("setup_version", SETUP_VERSION)),
        // A computer was attached, but setup never reached "ready" and nothing has touched the account for 30 minutes.
        count("accounts", (q) => q.not("home_computer_id", "is", null).is("hermes_base_url", null).lt("updated_at", iso(30 * 60_000))),
        count("ops_events", (q) => q.eq("event", "provision.failed").gte("at", iso(24 * HOUR))),
        count("ops_events", (q) => q.eq("level", "error").gte("at", iso(HOUR))),
        count("ops_events", (q) => q.eq("level", "error").gte("at", iso(24 * HOUR))),
        signInStartsThisHour(),
      ])
    : Array(14).fill(null);

  const st = (bad: boolean, warn: boolean, unknown: boolean): CheckState => (unknown ? "warn" : bad ? "fail" : warn ? "warn" : "ok");
  const checks: DeepHealth["checks"] = {
    database,
    gate,
    scheduler,
    webhooks: { state: st((overdue ?? 0) > 20, (overdue ?? 0) > 0 || (whFailed ?? 0) > 0, pending === null), pending, overdue, failedLast24h: whFailed },
    automations: { state: st((autoOverdue ?? 0) > 5, (failing ?? 0) > 0 || (autoOverdue ?? 0) > 0, enabled === null), enabled, failing, paused, overdue: autoOverdue, openRuns },
    provisioning: { state: st((provFailed ?? 0) >= 3, (stuck ?? 0) > 0 || (provFailed ?? 0) > 0, behind === null), latestSetupVersion: SETUP_VERSION, behind, stuck, failedLast24h: provFailed },
    signIn: { state: st((startsThisHour ?? 0) >= GLOBAL_PER_HOUR, (startsThisHour ?? 0) >= GLOBAL_PER_HOUR - 3, startsThisHour === null), startsThisHour, budgetPerHour: GLOBAL_PER_HOUR },
    errors: { state: st((errHour ?? 0) >= 20, (errHour ?? 0) > 0, errHour === null), lastHour: errHour, last24h: errDay },
  };
  const requiredOk = Object.values(required).every(Boolean);
  // "ok" means the service can serve: database up, gate holding, required config present, scheduler not late.
  const ok = database.state === "ok" && gate.state !== "fail" && scheduler.state !== "fail" && requiredOk;
  return {
    ok,
    at,
    environment: process.env.NODE_ENV === "production" ? (process.env.INVITE_GATE === "1" ? "staging-or-gated" : "production") : "development",
    checks,
    config: { required, optional },
  };
}
