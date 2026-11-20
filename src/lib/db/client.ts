// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * Server-only database client (see docs/ARCHITECTURE.md, "Data").
 *
 * Uses the publishable key plus the `x-om-secret` header; row-level security admits a request
 * only when that header hashes to the stored value, so this client must never reach a browser.
 * Every repository in this folder takes a `userId` and scopes every query by it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Match the SDK's default ungenerated database type across deployment schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseClient = SupabaseClient<any, "public", string>;
const g = globalThis as typeof globalThis & { __omDb?: { client: DatabaseClient; fingerprint: string } };

/** True when the three settings the client needs are present. */
export function dbConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.APP_DB_API_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
    process.env.APP_DB_SECRET &&
    (process.env.APP_DB_SCHEMA !== "mahara" || process.env.APP_DB_ACCESS_TOKEN)
  );
}

export function db(): DatabaseClient {
  if (typeof window !== "undefined") throw new Error("db() is server-only.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.APP_DB_API_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.APP_DB_SECRET;
  const schema = process.env.APP_DB_SCHEMA || "public";
  const token = process.env.APP_DB_ACCESS_TOKEN;
  if (!url || !key || !secret || (schema === "mahara" && !token)) throw new DbError("The database is not configured.", "config");
  const fingerprint = `${url}|${key}|${secret.length}|${schema}|${token?.length ?? 0}`;
  if (g.__omDb?.fingerprint === fingerprint) return g.__omDb.client;
  const client = createClient(url, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-om-secret": secret, ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  });
  g.__omDb = { client, fingerprint };
  return client;
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Throws a readable error for a failed query. */
export function fail(action: string, error: { message: string; code?: string }): never {
  throw new DbError(`Database ${action} failed: ${error.message}${error.code ? ` (${error.code})` : ""}`, error.code);
}

let reachable: { ok: boolean; at: number } | null = null;
/**
 * Whether the database answers, cached for 30 s (10 s after a failure). Used only to decide
 * whether the dev user may fall back to the local file store.
 */
export async function dbReachable(): Promise<boolean> {
  if (!dbConfigured()) return false;
  const now = Date.now();
  if (reachable && now - reachable.at < (reachable.ok ? 30_000 : 10_000)) return reachable.ok;
  let ok = false;
  try {
    const { error } = await db().from("settings").select("user_id").limit(1).abortSignal(AbortSignal.timeout(4000));
    ok = !error;
  } catch {
    ok = false;
  }
  reachable = { ok, at: now };
  return ok;
}

export const iso = (v: string | null | undefined): string => (v ? new Date(v).toISOString() : "");
