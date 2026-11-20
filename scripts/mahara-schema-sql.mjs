// Run from the repository root. Apply the emitted SQL to the shared Supabase database.
import { readFileSync } from "node:fs";

const baseline = readFileSync("supabase/migrations/20261120000000_baseline.sql", "utf8");
const context = readFileSync("supabase/migrations/20261120030000_mahara_second_spring.sql", "utf8");
const role = readFileSync("supabase/migrations/20261120040000_mahara_app_role.sql", "utf8");

process.stdout.write([
  "begin;",
  "create schema if not exists mahara;",
  "revoke all on schema mahara from public, anon, authenticated;",
  "grant usage on schema mahara to anon;",
  baseline.replace(/\bpublic\./g, "mahara.").replace(/\bprivate\b/g, "mahara_private"),
  context,
  role,
  "commit;",
  "",
].join("\n"));
