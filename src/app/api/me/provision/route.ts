// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import { after, type NextRequest } from "next/server";
import { orgoAccountView, ORGO_LINKS } from "@/lib/orgo/account-view";
import { errorResponse, json, readJson } from "@/lib/orgo/http";
import { adoptComputer, AdoptRefused, ensureHomeComputer, provisionStatus, resetHomeComputer } from "@/lib/provision";
import { orgoFor, requireSession } from "@/lib/session";
import { getAccount } from "@/lib/db/accounts";

/**
 * GET /api/me/provision: the home computer's setup status (`ProvisionStatus`), without starting anything.
 * POST /api/me/provision: starts (or resumes, or re-checks) setup and answers 202 with the status at once;
 * poll GET every couple of seconds for `state` / `message` / `progress`. `?wait=1` answers when it is done.
 * - Body `{ computerId }`: use that computer, already in the workspace, as the agent computer (nothing is created;
 *   plain Linux gets Hermes from Orgo first). 409 with the reason when it is not suitable.
 * - No body: create the agent computer from Orgo's Hermes template (or resume). When the account has no paid plan and
 *   no credit, answers 402 `{ code: "needs_funding", billing, links }` instead of creating anything.
 * - Body `{ new: true }`: drop a picked computer whose setup failed and create a new one instead (not once ready).
 * States: idle, creating_computer, starting_computer, waiting_for_boot, orgo_agent_setup, configuring_hermes,
 * publishing, verifying, ready, error.
 * A ready computer set up by an older recipe (`outdated: true`) gets a quiet upgrade started by GET: the status
 * stays "ready" (with an "Updating your computer" message) while the missing steps run.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const status = await provisionStatus(session);
    if (status.outdated && !status.running && !session.dev) {
      const run = ensureHomeComputer(session, { quiet: true });
      after(() => run.then(() => undefined, () => undefined));
      return json({ ...status, running: true });
    }
    return json(status);
  } catch (err) {
    return errorResponse(err, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const text = Number(req.headers.get("content-length") ?? 0) > 0 ? ((await readJson(req, 4096)) as { computerId?: unknown; new?: unknown } | null) : null;
    const computerId = typeof text?.computerId === "string" && text.computerId ? text.computerId : null;
    if (!computerId && text?.new === true && !session.dev) {
      const current = await provisionStatus(session);
      if (current.state !== "ready" && !current.running && current.homeComputerId) {
        try {
          await resetHomeComputer(session.userId);
        } catch (err) {
          if (err instanceof AdoptRefused) return json({ error: err.message, code: "setup_running" }, err.status);
          throw err;
        }
      }
    }
    let run: Promise<Awaited<ReturnType<typeof ensureHomeComputer>>>;
    if (computerId) {
      try {
        run = (await adoptComputer(session, computerId)).run;
      } catch (err) {
        if (err instanceof AdoptRefused) return json({ error: err.message, code: "not_suitable" }, err.status);
        throw err;
      }
    } else {
      const status = await provisionStatus(session);
      if (!session.dev && status.state !== "ready" && !status.running && !status.homeComputerId) {
        // Nothing to resume: a computer would be created. Check first that Orgo has something to bill it to.
        const account = await getAccount(session.userId).catch(() => null);
        const view = await orgoAccountView(session, await orgoFor(session), account?.workspaceId ?? session.workspaceId);
        if (view.billing.ready === false) return json({ error: view.billing.note, code: "needs_funding", billing: view.billing, links: ORGO_LINKS }, 402);
      }
      run = ensureHomeComputer(session);
    }
    if (req.nextUrl.searchParams.get("wait") === "1") {
      const done = await run;
      return json(done, done.state === "error" ? 502 : 200);
    }
    after(() => run.then(() => undefined, () => undefined));
    return json(await provisionStatus(session), 202);
  } catch (err) {
    return errorResponse(err, req);
  }
}
