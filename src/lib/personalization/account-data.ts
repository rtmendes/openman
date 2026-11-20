// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * Data controls on the server: export everything stored for a user, delete all their tasks, delete
 * their account. Only this app's database rows are touched: never the Orgo account, its credits, its
 * computers or the files on them. Server only.
 */
import { brand } from "@/config/brand";
import { db, fail } from "@/lib/db/client";
import { deleteStudioMedia } from "@/lib/db/studio-drafts";
import { deleteTask } from "@/lib/agent/server/tasks";
import type { Store } from "@/lib/store";
import { setRevocation } from "@/lib/db/revocations";
import { forgetRevocation } from "@/lib/session";
import { buildZip, type ZipEntry } from "./zip";

/**
 * Every table that holds rows for a user (`user_id`). Children first, so foreign keys never block a delete.
 * `scripts/account-data-test.mjs` checks this list against every `user_id` table in `supabase/migrations/`, so a
 * table added later without being listed here fails the test. `revocations` is deliberately not listed: it must
 * outlive the account so cookies and tokens issued before the deletion stay refused.
 */
export const USER_TABLES = [
  "studio_draft_versions",
  "task_events",
  "task_files",
  "shares",
  "api_tasks",
  "api_idempotency",
  "webhook_deliveries",
  "phone_messages",
  "phone_calls",
  "mail_messages",
  "mail_threads",
  "mail_ops",
  "mail_senders",
  "automation_runs",
  "automations",
  "website_secrets",
  "websites",
  "recording_images",
  "recording_parts",
  "recordings",
  "meetings",
  "skill_builds",
  "project_skills",
  "project_connectors",
  "project_files",
  "task_costs",
  "tasks",
  "projects",
  "knowledge",
  "notifications",
  "channel_links",
  "mailboxes",
  "phone_numbers",
  "custom_connectors",
  "api_keys",
  "webhooks",
  "usage_counters",
  "settings",
  "accounts",
] as const;

/** Tables kept on purpose when an account is deleted (no personal content; needed for security). */
export const KEPT_TABLES = ["revocations"] as const;

/** Sealed credentials, hashes and bearer tokens are never exported. */
const SECRET_COLUMNS = new Set(["orgo_key_enc", "hermes_key_enc", "secret_enc", "key_hash", "hook_token", "token_hash", "data_enc", "value_enc"]);

/** Tables in the export, in a readable order: every user table. */
const EXPORT_TABLES = [
  "studio_draft_versions",
  "accounts", "settings", "tasks", "task_events", "task_files", "shares", "projects", "project_files", "project_connectors", "project_skills",
  "knowledge", "automations", "automation_runs", "websites", "website_secrets", "mailboxes", "mail_senders", "mail_threads", "mail_messages", "mail_ops",
  "phone_numbers", "phone_messages", "phone_calls", "meetings", "recordings", "recording_parts", "recording_images", "skill_builds",
  "notifications", "channel_links", "custom_connectors", "api_keys", "webhooks", "webhook_deliveries", "api_tasks", "api_idempotency", "usage_counters",
  "task_costs", "task_members", "project_members", "project_proposals",
] as const;

/** Tables whose rows belong to a user through a column other than `user_id` too (handled by name in `deleteUserRows`). */
export const SPECIAL_TABLES = {
  task_members: ["owner_id", "user_id"],
  project_members: ["owner_id", "member_id"],
  project_proposals: ["owner_id", "proposed_by"],
  invites: ["orgo_user_id"],
} as const;

/** Columns other than `user_id` that tie a row to a person (`scripts/account-data-test.mjs` scans the migrations for them). */
export const PERSON_COLUMNS = ["user_id", "owner_id", "member_id", "proposed_by", "orgo_user_id"] as const;

const ownerFilter = (cols: readonly string[], userId: string) => cols.map((c) => `${c}.eq.${JSON.stringify(userId)}`).join(",");

async function allRows(table: string, userId: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const PAGE = 1000;
  const special = (SPECIAL_TABLES as Record<string, readonly string[]>)[table];
  for (let from = 0; ; from += PAGE) {
    const base = db().from(table).select("*");
    const scoped = special ? base.or(ownerFilter(special, userId)) : base.eq("user_id", userId);
    const { data, error } = await scoped.range(from, from + PAGE - 1);
    if (error) {
      // A table added later in another area may not exist on an older database; skip it rather than fail.
      if (error.code === "42P01" || error.code === "PGRST205") return out;
      fail(`export ${table}`, error);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (!SECRET_COLUMNS.has(k)) clean[k] = v;
      out.push(clean);
    }
    if (rows.length < PAGE) return out;
  }
}

/** A zip with one JSON file per table, plus one file per task with its events. */
export async function exportUserData(userId: string): Promise<Buffer> {
  const entries: ZipEntry[] = [];
  const counts: Record<string, number> = {};
  const byTable: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORT_TABLES) {
    const rows = await allRows(table, userId);
    byTable[table] = rows;
    counts[table] = rows.length;
    if (table !== "task_events") entries.push({ name: `${table}.json`, data: JSON.stringify(rows, null, 2) });
  }
  const events = byTable.task_events ?? [];
  for (const task of byTable.tasks ?? []) {
    const id = String(task.id);
    const own = events.filter((e) => e.task_id === id).sort((a, b) => Number(a.seq) - Number(b.seq));
    entries.push({ name: `tasks/${id}.json`, data: JSON.stringify({ task, events: own }, null, 2) });
  }
  entries.unshift({
    name: "README.txt",
    data: [
      `${brand.name} data export`,
      `Created ${new Date().toISOString()}`,
      "",
      "One JSON file per table. tasks/<id>.json holds each task with its full event history.",
      "Sealed credentials (Orgo and agent keys, webhook and website secrets, API key hashes) are left out; website secrets appear by name only.",
      "Files on your Orgo computer are not included; download them from the computer itself.",
      "",
      ...Object.entries(counts).map(([t, n]) => `${t}: ${n}`),
      "",
    ].join("\n"),
  });
  return buildZip(entries);
}

/** Deletes every task (archived too), stopping any that are running. Returns how many were removed. */
export async function deleteAllTasks(store: Store): Promise<number> {
  const tasks = await store.listTasks({ archived: "all" });
  let removed = 0;
  for (const task of tasks) if (await deleteTask(store, task.id).catch(() => false)) removed++;
  return removed;
}

/**
 * Removes every row this app stores for the user and ends every session. Orgo itself is not contacted.
 * First a revocation record (outside the deleted tables) refuses every cookie and automations token issued so far,
 * so other devices are signed out even though `settings` and `accounts` go away.
 */
export async function deleteUserRows(userId: string): Promise<Record<string, number>> {
  const now = new Date();
  await setRevocation(userId, { sessions: now, automations: now });
  forgetRevocation(userId);
  const removed: Record<string, number> = {};
  await deleteStudioMedia(userId);
  {
    // Invite list entries (staging): members are removed; an owner row stays so the list keeps its owner.
    const { error } = await db().from("invites").delete().eq("orgo_user_id", userId).eq("role", "member");
    if (error && error.code !== "42P01" && error.code !== "PGRST205") fail("delete invites", error);
  }
  {
    // Task collaboration: invitations the user sent (owner_id) and the ones they accepted (user_id).
    const { count, error } = await db().from("task_members").delete({ count: "exact" }).or(`owner_id.eq.${JSON.stringify(userId)},user_id.eq.${JSON.stringify(userId)}`);
    if (error && error.code !== "42P01" && error.code !== "PGRST205") fail("delete task_members", error);
    removed.task_members = count ?? 0;
  }
  {
    // Project sharing: proposals on the user's own projects and their open proposals elsewhere, then memberships
    // (projects they share and projects shared with them). Rows on deleted projects also go by cascade.
    const p = await db().from("project_proposals").delete({ count: "exact" }).or(`owner_id.eq.${JSON.stringify(userId)},and(proposed_by.eq.${JSON.stringify(userId)},status.eq.open)`);
    if (p.error && p.error.code !== "42P01" && p.error.code !== "PGRST205") fail("delete project_proposals", p.error);
    removed.project_proposals = p.count ?? 0;
    const m = await db().from("project_members").delete({ count: "exact" }).or(ownerFilter(SPECIAL_TABLES.project_members, userId));
    if (m.error && m.error.code !== "42P01" && m.error.code !== "PGRST205") fail("delete project_members", m.error);
    removed.project_members = m.count ?? 0;
  }
  for (const table of USER_TABLES) {
    const { count, error } = await db().from(table).delete({ count: "exact" }).eq("user_id", userId);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") continue;
      fail(`delete ${table}`, error);
    }
    removed[table] = count ?? 0;
  }
  return removed;
}
