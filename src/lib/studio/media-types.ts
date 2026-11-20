export const studioMediaTypes = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", srt: "application/x-subrip", vtt: "text/vtt",
} as const;
export const studioMediaLimit = 50 * 1024 * 1024;
export const studioMediaPerProject = 25;
export const studioMediaId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.[a-z0-9]{2,5}$/;
export const studioTextExtension = /^(txt|md|csv|json|srt|vtt)$/;
export type StudioMedia = { id: string; name: string; type: string; size: number };

export function mediaExtension(name: string) {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}
