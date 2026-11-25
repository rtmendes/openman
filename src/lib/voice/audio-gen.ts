// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * Speech and sound effects with the server's ElevenLabs key. Server only.
 *
 * Design (operator-billed, so capped per user like every other vendor this server pays for):
 * - The key never leaves the server. ElevenLabs has no single-use token for these endpoints, so the agent asks for
 *   audio through the credential-free `omtools` bridge (`generate_speech`, `generate_sound_effect`); the server
 *   spends the user's cap first (`tts_characters`, `sound_effects` in `src/config/usage-limits.ts`), calls ElevenLabs,
 *   and puts the MP3 into the task's folder on the user's computer through Orgo's file transfer.
 * - Availability is the server key (not keys on the user's computer). Music is not offered: the plan answers
 *   `402 paid_plan_required`; `ELEVENLABS_MUSIC=1` would be the switch once a paid plan exists, and nothing here
 *   calls the music endpoint.
 *
 * Endpoints (https://elevenlabs.io/docs): `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
 * `{ text, model_id }`; `POST /v1/sound-generation?output_format=mp3_44100_128` `{ text, duration_seconds?, prompt_influence? }`;
 * `GET /v1/voices` for names. Each answers audio bytes, or JSON `{ detail }` on failure.
 */
import { ELEVENLABS_API, elevenLabsKey } from "./elevenlabs";
import { consumeUsage } from "@/lib/usage";

export const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_multilingual_v2";
export const MAX_TTS_CHARS = 5000;
export const MAX_SFX_SECONDS = 22;

export interface VendorAudio {
  speech: boolean;
  soundEffects: boolean;
  music: boolean;
}

/** What the server's key offers. Music stays off unless the operator turns it on for a paid plan. */
export function vendorAudio(): VendorAudio {
  const key = !!elevenLabsKey();
  return { speech: key, soundEffects: key, music: key && process.env.ELEVENLABS_MUSIC === "1" };
}

export class AudioGenError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function vendorError(res: Response): Promise<AudioGenError> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  const d = body?.detail;
  const said = typeof d === "string" ? d : d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : "";
  return new AudioGenError(`ElevenLabs refused the request${said ? `: ${said.slice(0, 200)}` : ` (${res.status})`}.`, res.status === 402 || res.status === 401 ? 402 : 502);
}

type Voice = { id: string; name: string; category: string; description?: string; previewUrl?: string; accent?: string };
let voiceCache: { at: number; voices: Voice[] } | null = null;

/** The account's voices (premade first), cached for an hour. */
export async function listVoices(): Promise<Voice[]> {
  if (voiceCache && Date.now() - voiceCache.at < 3_600_000) return voiceCache.voices;
  const key = elevenLabsKey();
  if (!key) throw new AudioGenError("Speech is not set up on this server.", 503);
  const res = await fetch(`${ELEVENLABS_API}/v1/voices`, { headers: { "xi-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await vendorError(res);
  const body = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string;
    description?: string; preview_url?: string; labels?: { accent?: string } }[] };
  const voices = (body.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category ?? "",
    description: v.description, previewUrl: v.preview_url, accent: v.labels?.accent }))
    .sort((a, b) => Number(b.category === "premade") - Number(a.category === "premade"));
  voiceCache = { at: Date.now(), voices };
  return voices;
}

async function resolveVoice(voice: string | undefined): Promise<{ id: string; name: string }> {
  const voices = await listVoices();
  if (!voices.length) throw new AudioGenError("The ElevenLabs account has no voices.", 502);
  const want = voice?.trim().toLowerCase();
  const hit = want ? voices.find((v) => v.id.toLowerCase() === want || v.name.toLowerCase() === want || v.name.toLowerCase().startsWith(`${want} `) || v.name.toLowerCase().split(/\s|-/)[0] === want) : undefined;
  if (want && !hit) throw new AudioGenError(`Unknown voice "${voice}". Voices: ${voices.slice(0, 12).map((v) => v.name).join(", ")}.`);
  return hit ?? voices[0];
}

/** Text to MP3. Spends `tts_characters` before calling ElevenLabs. */
export async function synthesizeSpeech(userId: string, text: string, voice?: string, settings?: { speed: number }):
  Promise<{ bytes: Uint8Array; voice: string; characters: number }> {
  const key = elevenLabsKey();
  if (!key) throw new AudioGenError("Speech is not set up on this server.", 503);
  const clean = text.trim();
  if (!clean) throw new AudioGenError("Pass text: the words to speak.");
  if (clean.length > MAX_TTS_CHARS) throw new AudioGenError(`At most ${MAX_TTS_CHARS} characters per call; split the script.`);
  const v = await resolveVoice(voice);
  await consumeUsage(userId, "tts_characters", clean.length);
  const res = await fetch(`${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(v.id)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: clean, model_id: TTS_MODEL, ...(settings ? { voice_settings: settings } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await vendorError(res);
  return { bytes: new Uint8Array(await res.arrayBuffer()), voice: v.name, characters: clean.length };
}

/** A sound effect from a description. Spends one `sound_effects` before calling ElevenLabs. */
export async function generateSoundEffect(userId: string, prompt: string, seconds?: number): Promise<{ bytes: Uint8Array }> {
  const key = elevenLabsKey();
  if (!key) throw new AudioGenError("Sound effects are not set up on this server.", 503);
  const clean = prompt.trim();
  if (!clean) throw new AudioGenError("Pass prompt: a description of the sound.");
  if (clean.length > 450) throw new AudioGenError("Describe the sound in at most 450 characters.");
  const duration = seconds === undefined || !Number.isFinite(seconds) ? undefined : Math.min(MAX_SFX_SECONDS, Math.max(0.5, seconds));
  await consumeUsage(userId, "sound_effects", 1);
  const res = await fetch(`${ELEVENLABS_API}/v1/sound-generation?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: clean, ...(duration ? { duration_seconds: duration } : {}), prompt_influence: 0.4 }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await vendorError(res);
  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}
