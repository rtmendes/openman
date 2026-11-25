import type { VideoPlan } from "@/app/content-studio/production";

export const studioNarrationLimit = 5000;
export type StudioNarrationVoice = { id: string; name: string; description?: string; accent?: string; previewUrl?: string };

export function studioNarrationText(plan?: VideoPlan) {
  return plan?.shots.map(({ narration }) => narration.trim()).filter(Boolean).join("\n\n") ?? "";
}

export function studioVoicePreview(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return undefined;
    if (url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/eleven-public-prod/")) return url.href;
    if (url.hostname === "elevenlabs.io" || url.hostname.endsWith(".elevenlabs.io")) return url.href;
  } catch { /* Some provider voices have no public recording. */ }
  return undefined;
}
