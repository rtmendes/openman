// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/automations/engine";
import { tickStudioRuns } from "@/lib/studio/dispatcher";
import { processOutbox } from "@/lib/public-api/webhooks";
import { sweepIdleWorkspaces } from "@/lib/agent/server/hygiene";
// [observability] heartbeat, operator alerts, cost backfill, log pruning (src/lib/observability, docs/OPERATIONS.md)
import { runAlertChecks } from "@/lib/observability/alerts";
import { refreshRecentCosts } from "@/lib/observability/costs";
import { beat, TICK } from "@/lib/observability/heartbeat";
import { logEvent } from "@/lib/observability/log";
import { pruneOpsEvents } from "@/lib/observability/metrics";


function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.headers.get("x-cron-secret") ?? "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/cron/tick: one pass of the automations clock (due schedules, feed polls, retries,
 * following open runs). Needs `Authorization: Bearer $CRON_SECRET`. Safe to call concurrently;
 * `scripts/worker.mjs` calls it every minute.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  after(tickStudioRuns);
  const startedAt = Date.now();
  try {
    const result = await tick();
    // Outgoing webhooks ride the same clock: due deliveries, retries and newly stored task events.
    const webhooks = await processOutbox().catch((err) => {
      console.error("[cron] webhooks failed:", err instanceof Error ? err.message : err);
      return { error: "Webhook delivery failed; see the server log." };
    });
    // Idle task folders on users' computers: at most one pass a day; never fails the tick.
    await sweepIdleWorkspaces().catch(() => null);
    // [observability] Never lets the tick fail: each step swallows its own error.
    const ops = await observe(result, webhooks, Date.now() - startedAt);
    return NextResponse.json({ ...result, webhooks, ops }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron] tick failed:", err);
    await logEvent("error", "cron.tick_failed", { error: err, durationMs: Date.now() - startedAt }); // [observability]
    return NextResponse.json({ error: "Tick failed; see the server log." }, { status: 500 });
  }
}

/** [observability] Heartbeat (tick age for health checks), operator alerts, task cost backfill, 30-day log pruning. */
async function observe(result: Awaited<ReturnType<typeof tick>>, webhooks: unknown, durationMs: number): Promise<{ alerts: string[]; costed: number }> {
  const errors = result.errors.length + (webhooks && typeof webhooks === "object" && "error" in webhooks ? 1 : 0);
  if (errors) await logEvent("warn", "cron.tick_errors", { durationMs, data: { errors, fired: result.fired.length, first: result.errors[0] ?? null } });
  const previous = await beat(TICK, { durationMs, fired: result.fired.length, errors }).catch(() => null);
  const alerts = await runAlertChecks(previous).catch(() => [] as string[]);
  const costed = await refreshRecentCosts(0.1, 25).catch(() => 0);
  if (new Date().getUTCMinutes() === 7) await pruneOpsEvents(30).catch(() => undefined);
  return { alerts, costed };
}
