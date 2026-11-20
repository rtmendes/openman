// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import { remoteComputerId } from "@/lib/agent/server/remote";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { notFound, readBody, withTask } from "@/lib/agent/server/http";
import { attachmentsSchema } from "@/lib/agent/attachments";
import { attachmentNote, referenceTasks, runtimeFor } from "@/lib/agent/server/tasks";

const messageSchema = z.object({
  text: z.string().trim().min(1, "Write a message first.").max(200_000),
  mode: z.enum(["steer", "queue", "interrupt"]).catch("queue"),
  /** Earlier tasks (the caller's own) this message refers to; at most 20 are kept on the task. */
  references: z.array(z.string().max(64)).max(20).optional(),
  /** Plan mode toggled for this message: "plan" plans the next phase before anything runs; "agent" leaves Plan mode. */
  interaction: z.enum(["agent", "plan"]).optional(),
  /** Files uploaded with `POST /api/tasks/uploads` (paths on the computer) or links; the agent gets paths, never contents. */
  attachments: attachmentsSchema.max(20).optional(),
});

/**
 * POST /api/tasks/[id]/messages: send a message into a task (owner or collaborator).
 * - `steer`: hand it to the running agent at its next tool boundary.
 * - `interrupt`: stop the current run, then start a new one in the same session.
 * - `queue`: hold it and send it when the current run ends.
 * When nothing is running, every mode simply starts a new run. Switching into Plan mode while the agent runs stops
 * it first, so it plans the next phase and waits.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTask(req, id, async ({ store }) => {
    const body = await readBody(req, messageSchema);
    if ("error" in body) return body.error;
    const runtime = await runtimeFor(store, id);
    if (!runtime) return notFound();
    const { references } = body.data;
    const text = body.data.attachments?.length ? `${body.data.text}${attachmentNote(body.data.attachments, !!remoteComputerId(runtime.task.meta.target))}` : body.data.text;
    let { mode } = body.data;
    if (body.data.interaction) {
      const current = (runtime.task.meta as { interaction?: string }).interaction ?? "agent";
      // Chat tasks leave Chat only through "Switch to Agent".
      if (current !== "chat" && runtime.setInteraction(body.data.interaction) && runtime.isBusy) mode = "interrupt";
    }
    await referenceTasks(store, runtime, references);
    if (mode === "steer") await runtime.steer(text);
    else if (mode === "interrupt") await runtime.interrupt(text);
    else await runtime.queueMessage(text);
    after(() => runtime.waitForActiveRun());
    return NextResponse.json({ ok: true });
  });
}
