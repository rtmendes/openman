import { createHash } from "node:crypto";
import { z } from "zod";
import { readBody } from "@/lib/agent/server/http";
import { claimIdempotency, saveIdempotency } from "@/lib/db/public-api";
import { saveStudioMedia, studioDraft } from "@/lib/db/studio-drafts";
import { operatorFor } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";
import { requireSession } from "@/lib/session";
import { studioNarrationText, studioVoicePreview } from "@/lib/studio/narration";
import { AudioGenError, listVoices, MAX_TTS_CHARS, synthesizeSpeech, vendorAudio } from "@/lib/voice/audio-gen";
import { UsageLimitError } from "@/lib/usage";
import { readVideoPlan } from "@/app/content-studio/production";

const request = z.object({ id: z.uuid(), project: z.uuid(), revision: z.number().int().positive(), confirmCharge: z.literal(true) });
const draftProject = z.object({ script: z.string().max(40000), stale: z.boolean().optional(), spec: z.object({
  duration: z.number().int().min(15).max(300),
  voice: z.object({ voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), rate: z.number().min(0.7).max(1.2) }),
}) });
const headers = { "Cache-Control": "private, no-store" };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });

export const GET = withErrorReporting("studio.narration.voices", async () => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ configured: false, voices: [] });
  if (!vendorAudio().speech) return reply({ configured: false, voices: [] });
  try {
    const voices = (await listVoices()).map(({ id, name, description, accent, previewUrl }) =>
      ({ id, name, description, accent, previewUrl: studioVoicePreview(previewUrl) }));
    return reply({ configured: true, voices });
  } catch {
    return reply({ error: "ElevenLabs could not list the account’s voices. Check its connection and voice permissions." }, 502);
  }
});

export const POST = withErrorReporting("studio.narration.generate", async (req) => {
  const session = await requireSession();
  if (process.env.APP_DB_SCHEMA !== "mahara" || !(await operatorFor(session))?.owner) return reply({ error: "This voice service is unavailable." }, 404);
  if (!vendorAudio().speech) return reply({ error: "Connect ElevenLabs to generate narration." }, 503);
  const body = await readBody(req, request, 4000);
  if ("error" in body) return body.error;
  const { id, project, revision } = body.data;
  const { userId } = session;
  const draft = await studioDraft(userId, revision);
  const saved = (draft?.items as { spec?: { id?: string } }[] | undefined)?.find(({ spec }) => spec?.id === project);
  const parsed = draftProject.safeParse(saved);
  if (!parsed.success || parsed.data.stale) return reply({ error: "Save a valid script and select an ElevenLabs voice before generating." }, 409);
  const { spec, script } = parsed.data;
  let text;
  try { text = studioNarrationText(readVideoPlan(script, spec.duration)); }
  catch { return reply({ error: "Fix the script timing before generating narration." }, 400); }
  if (!text || text.length > MAX_TTS_CHARS) return reply({ error: `Use a script with 1–${MAX_TTS_CHARS} narration characters.` }, 400);

  const key = `studio-narration:${id}`;
  const fingerprint = createHash("sha256").update(JSON.stringify([project, revision, spec.voice, text])).digest("hex");
  const prior = await claimIdempotency(userId, key, fingerprint);
  if (prior) {
    if (prior.fingerprint !== fingerprint) return reply({ error: "This request belongs to a different saved script." }, 409);
    return prior.status ? reply(prior.response, prior.status) : reply({ error: "Narration is already being generated. Check this request again shortly." }, 409);
  }
  let result: { media: Awaited<ReturnType<typeof saveStudioMedia>> } | { error: string };
  let status = 200;
  try {
    const speech = await synthesizeSpeech(userId, text, spec.voice.voiceId, { speed: spec.voice.rate });
    result = { media: await saveStudioMedia(userId, `Narration · ${speech.voice}.mp3`, "mp3", speech.bytes) };
  } catch (error) {
    status = error instanceof UsageLimitError || error instanceof AudioGenError ? error.status : 502;
    result = { error: error instanceof UsageLimitError ? error.message
      : error instanceof AudioGenError ? "ElevenLabs declined the request. Check the selected voice and account."
        : "Narration could not be saved. Check ElevenLabs usage before generating again." };
  }
  await saveIdempotency(userId, key, status, result);
  return reply(result, status);
});
