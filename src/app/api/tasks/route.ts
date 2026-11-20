// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { attachmentsSchema } from "@/lib/agent/attachments";
import type { CreateTaskInput } from "@/lib/agent/types";
import { readBody, withStore } from "@/lib/agent/server/http";
import { createTask, isModeId, listTasks, runtimeFor } from "@/lib/agent/server/tasks";

const createSchema = z.object({
  prompt: z.string().trim().min(1, "Write a prompt first.").max(200_000),
  // An unknown or missing mode falls back to the standard one instead of failing the request.
  mode: z.unknown().transform((v) => (isModeId(v) ? v : "standard")),
  effort: z.enum(["medium", "high", "extra", "ultra"]).optional().catch(undefined),
  speed: z.enum(["normal", "fast"]).optional().catch(undefined),
  target: z
    .union([
      z.object({ kind: z.literal("cloud-temporary") }),
      z.object({ kind: z.literal("cloud-persistent"), computerId: z.string() }),
      z.object({ kind: z.literal("local") }),
    ])
    .optional()
    .catch(undefined),
  projectId: z.string().max(200).nullish(),
  connectors: z.array(z.string().max(200)).max(100).optional(),
  skills: z.array(z.string().max(200)).max(50).optional(),
  attachments: attachmentsSchema.optional(),
  /** Chat (light Q&A, no computer) or Plan (a plan to confirm before anything runs); the full agent by default. */
  interaction: z.enum(["agent", "chat", "plan"]).optional().catch(undefined),
  /** Earlier tasks of the caller's that the prompt refers to (at most 20). */
  references: z.array(z.string().max(64)).max(20).optional(),
});

/**
 * GET /api/tasks: the caller's tasks, most recently updated first. Archived tasks are left out
 * unless `?archived=1` (only archived) or `?archived=all`.
 */
export function GET(req: NextRequest) {
  return withStore(req, async (store) => {
    const flag = req.nextUrl.searchParams.get("archived");
    const archived = flag === "all" ? "all" : flag === "1" || flag === "true";
    return NextResponse.json({ tasks: await listTasks(store, { archived }) });
  });
}

/** POST /api/tasks: create a task and start its first run. Returns at once; progress arrives on the event stream. */
export function POST(req: NextRequest) {
  return withStore(req, async (store) => {
    const body = await readBody(req, createSchema);
    if ("error" in body) return body.error;
    const task = await createTask(store, body.data satisfies CreateTaskInput);
    const runtime = await runtimeFor(store, task.id);
    if (runtime) after(() => runtime.waitForActiveRun());
    return NextResponse.json({ task }, { status: 201 });
  });
}
