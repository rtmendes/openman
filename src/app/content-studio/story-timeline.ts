import type { StudioMedia } from "@/lib/studio/media-types";
import type { VideoPlan } from "./production";

export const storyPoses = ["Present", "React", "Point", "Think"] as const;
export type StoryPose = typeof storyPoses[number];
export type StoryCue = { start: number; end: number; text: string };
export type StoryEdit = {
  images?: Record<number, string>;
  poses?: Record<number, StoryPose>;
  audio?: StudioMedia;
  subtitles?: StoryCue[];
  storyboardApproved?: string;
};

export function storyImageAssignments(media: StudioMedia[], references?: Record<number, string>, prior?: Record<number, string>) {
  if (!references && !prior) return undefined;
  const stills = new Set(media.filter(({ type }) => type.startsWith("image/")).map(({ id }) => id));
  return Object.fromEntries(Object.entries({ ...prior, ...references }).filter(([, id]) => stills.has(id)));
}

function seconds(stamp: string) {
  const match = /^(\d{2}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(stamp);
  if (!match) throw new Error("Use SRT timestamps such as 00:00:02,500.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

export function parseStorySubtitles(srt: string, duration: number): StoryCue[] {
  const blocks = srt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  if (blocks.length > 350) throw new Error("Use up to 350 subtitle cues.");
  let previousEnd = 0;
  return blocks.map((block) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const timing = lines.shift()?.match(/^\s*(\S+)\s+-->\s+(\S+)\s*$/);
    if (!timing) throw new Error("Each caption needs a start and end timestamp.");
    const start = seconds(timing[1]);
    const end = seconds(timing[2]);
    const text = lines.join(" ").replace(/<[^>]*>/g, "").trim();
    if (!text || text.length > 140 || end <= start || start < previousEnd || end > duration) {
      throw new Error("Keep captions short, within the video runtime and in order without overlaps.");
    }
    previousEnd = end;
    return { start, end, text };
  });
}

export function storyDraftCues(plan: VideoPlan): StoryCue[] {
  return plan.shots.flatMap(({ end, narration }, index) => {
    const start = plan.shots[index - 1]?.end ?? 0;
    const words = narration.trim().split(/\s+/).filter(Boolean);
    const chunks = Math.ceil(words.length / 7);
    const size = Math.ceil(words.length / chunks);
    return Array.from({ length: chunks }, (_, i) => ({
      start: start + (end - start) * i / chunks,
      end: start + (end - start) * (i + 1) / chunks,
      text: words.slice(i * size, (i + 1) * size).join(" "),
    }));
  });
}

export function storyShotAt(plan: VideoPlan, time: number) {
  const index = plan.shots.findIndex(({ end }) => end > time);
  return index === -1 ? plan.shots.length - 1 : index;
}
