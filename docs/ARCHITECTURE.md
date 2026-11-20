# Architecture

OpenMan is a Next.js app that turns a person's Orgo account into an autonomous agent workspace. It keeps very little
infrastructure of its own: compute, the agent runtime, models and billing all live in the user's Orgo account, and the
app adds the product around them.

```
 Browser ──HTTPS──▶ OpenMan (Next.js, any Node host) ──▶ Supabase (app data, server-only access)
                      │        ▲
                      │        └── scheduler worker (POST /api/cron/tick every minute)
                      │
                      ├──▶ Orgo API, acting as the signed-in user (computers, credits, connectors, skills, app URLs)
                      └──▶ Hermes Agent on the user's own Orgo computer (runs, events, approvals)
                                 └──▶ Claude through Orgo's model proxy, billed to the user's Orgo credits
```

## Principles

1. **It is an Orgo product.** A signed-in user is an Orgo user, and everything runs on that user's own Orgo account:
   their computers, their credits, their plan. OpenMan keeps no second billing system.
2. **Reuse Orgo before building.** Connectors, skills, schedules, preview URLs, files, terminal, metrics and backups
   come from Orgo's API. OpenMan builds only what Orgo does not have.
3. **Offer only what works.** The UI never shows an option that is disabled or unavailable for the deployment.
4. **The server is the only database client.** Browsers never talk to Supabase.

## Identity

Users sign in with their Orgo account. The server ends up holding the user's Orgo credential, stores it encrypted at
rest (`APP_ENCRYPTION_KEY`, AES-256-GCM) in the `accounts` table so background work (automations, inbound email and
phone) can act for the user, and sets an encrypted, HttpOnly session cookie (`SESSION_SECRET`). The cookie never
carries the Orgo credential. See the README's "Sign in with Orgo" section for the flow and its settings.

There are two ways in, and both end in the same place (`src/lib/session/sign-in.ts`): Orgo's device approval flow
(`/api/auth/orgo/start` and `/poll`; Orgo hands over a key it minted for OpenMan) or a pasted Orgo API key
(`/api/auth/orgo/key`). The key is checked with Orgo (`identify.ts`; a workspace-scoped key is accepted only when its
workspace has a single member), stored sealed, and the workspace OpenMan works in is remembered on the account
(`/api/me/workspaces`). Local sign-in (`OPENMAN_LOCAL_SIGNIN=1`) is the pasted-key path with this machine's
`ORGO_API_KEY`, offered only on a loopback-bound server (`bypass.ts`).

For local development, `OPENMAN_DEV_BYPASS=1` turns the session into a development user built from `ORGO_API_KEY` in
`.env.local`. It works only under `next dev` for loopback requests; a production server with it set refuses to start.

Optional gates: `INVITE_GATE=1` admits only people on an invite list stored in the database (the first account to sign
in owns it), and `ALLOWED_EMAILS` is a simpler email allow-list.

## Data

One Supabase project per environment, created by the operator, with the schema in `supabase/migrations/`.

- Only the server talks to it, with the publishable key plus the header `x-om-secret: $APP_DB_SECRET`.
- Row-level security admits a request only when `private.is_server()` is true: the SHA-256 of that header equals the
  single row in `private.server_secret`, set per environment outside the migrations (`node scripts/setup.mjs` prints
  the statement). The `authenticated` role has no access at all.
- Every row carries the Orgo user id as text, and every query in `src/lib/db/*` is scoped by it.
- Main tables: `accounts`, `tasks`, `task_events`, `task_files`, `task_members`, `projects`, `project_files`,
  `project_members`, `project_proposals`, `knowledge`, `settings`, `shares`, `notifications`, `automations`,
  `automation_runs`, `mailboxes` and `mail_*`, `phone_numbers` and `phone_*`, `websites`, `website_secrets`,
  `custom_connectors`, `skill_builds`, `recordings`, `meetings`, `api_keys`, `webhooks`, `webhook_deliveries`.
  Security and operations: `revocations` (kept when an account is deleted), `usage_counters` (caps for
  operator-paid vendors, `src/config/usage-limits.ts`), `invites`, `ops_events`, `ops_heartbeats`, `ops_alerts`,
  `task_costs`.
- Large task files stay on the user's computer; the app keeps a local cache under `OPENMAN_DATA_DIR` (default
  `.data/`).

## Compute and the agent

- Each user has a **home computer** in their own Orgo workspace, made from Orgo's Hermes Agent template, or an
  existing computer they pick.
- **Provisioning** (`src/lib/provision`) runs through the Orgo API as that user. It is idempotent, resumable and
  versioned: Orgo's agent setup (Hermes calls Claude through Orgo's model proxy, billed to the workspace owner), then
  OpenMan's own steps: enable the Hermes API server with a per-computer key and the needed toolsets, register the
  automations and task tools, re-apply the user's custom connectors, and publish the API through an Orgo app URL.
  Bumping a step's version re-runs just that step for every user on their next visit.
- **Runs**: the relay (`src/lib/agent/server/relay.ts`) talks to Hermes on that computer (`/v1/runs`, the event
  stream, stop, steer, approvals and questions) and stores every event, so the browser can reconnect and replay.
- **Models**: Claude models through Orgo's proxy. Modes map to models in `src/config/brand.ts` and the agent code.
- **Live desktop**: the server fetches a per-session desktop password from Orgo and hands the browser a websocket
  URL for noVNC. Nothing about the desktop is stored in the browser.
- **Concurrency**: tasks per user are limited by the size of the home computer (`src/lib/limits`); extra tasks queue
  and start by themselves.

## Credits and plans

All of it is Orgo's. The app reads the balance and usage, starts a credit top-up through Orgo's checkout, and sends
users to Orgo's billing page to change plan.

## Reused from Orgo (user's credential, user's computer)

| Need | Orgo feature |
|---|---|
| Connectors to apps | Orgo agent apps (managed sign-ins, wired into Hermes over MCP) |
| Skills | Orgo agent skills and Hermes' own skill installer |
| Schedules | Orgo agent schedules |
| Website previews and publishing | Orgo app URLs on the user's computer |
| Files, terminal, metrics, backups, resize | Orgo computer APIs |

## Built by OpenMan

Projects and knowledge, task sharing and collaboration, the automations engine and run history, website building and
hosting on the user's computer, agent email (AgentMail), agent phone (AgentPhone), voice input and meeting notes
(ElevenLabs or keyless Whisper on the user's computer), generators (slides, documents, charts, audio), recorded
demonstrations, the public API (`/api/v1`) with outgoing webhooks, and the operator page (`/app/admin`).

## Background work

`scripts/worker.mjs` calls `POST /api/cron/tick` once a minute with `CRON_SECRET`. A tick fires due automations, polls
triggers, retries and delivers outgoing webhooks, backfills task costs, sweeps idle task folders, records a heartbeat
and checks alerts. Ticks are safe to run concurrently, so an external cron calling the same endpoint works too.

On Mahara deployments, Content Studio stores workflow and suggestion runs with their project revision and approval
state in `studio_runs`. The owner starts each run and the clock recovers interrupted work. A database lease and a
reserved task ID prevent concurrent ticks from dispatching the same stage twice. The existing worker ticks Studio too.
For a self-hosted Supabase deployment using `pg_cron` and `pg_net`, an administrator can schedule
`mahara_private.request_studio_tick('<production origin>/api/cron/studio')` every minute as the database owner.
The private function only calls the app when work is due, using a short-lived single-use ticket.

## Code contracts

```ts
// src/lib/session/index.ts
export interface Session { userId: string; email: string; name: string; avatarUrl?: string | null; plan: string; workspaceId: string | null; dev?: boolean }
export function getSession(): Promise<Session | null>;
export function requireSession(): Promise<Session>;             // throws a 401 Response when signed out
export function orgoFor(session: Session): Promise<OrgoClient>; // Orgo API client acting as that user

// src/lib/crypto.ts
export function seal(plain: string): string;                    // AES-256-GCM with APP_ENCRYPTION_KEY
export function open(sealed: string): string;

// src/lib/db/client.ts
export function db(): SupabaseClient;                           // server-only; sends x-om-secret
```

Every API route starts with `requireSession()` (or the public API's key check) and passes `session.userId` to the data
layer.

## Where things live

| Path | What |
|---|---|
| `src/app/(marketing)`, `src/app/docs` | Public site and user docs (docs content in `content/docs`) |
| `src/app/app` | The signed-in app under `/app` |
| `src/app/api` | Route handlers; `api/v1` is the public API, `api/cron/tick` the scheduler, `api/webhooks` vendor callbacks |
| `src/lib/agent` | Task types, browser client, and the server relay to Hermes |
| `src/lib/session`, `src/lib/orgo`, `src/lib/provision` | Sign-in and sessions, the Orgo API client, computer setup |
| `src/lib/db` | Server-only data access, one file per area |
| `src/config` | Brand strings and usage caps |
| `supabase/migrations` | Database schema |
| `scripts` | Setup, worker, and test scripts |
