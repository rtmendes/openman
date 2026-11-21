import type { ApprovedVideo } from "./production-package";
import { chosenFrames } from "./production";

export const storyStyles = ["illustrated-story", "stick-figure"] as const;
export type StoryStyle = typeof storyStyles[number];
export const storyLabels: Record<StoryStyle, string> = {
  "illustrated-story": "OpenCode · Illustrated story",
  "stick-figure": "OpenCode · Stick-figure animation",
};
export const storyTutorial = "https://www.youtube.com/watch?v=NHEurGsycYM";
export const moraViralUrl = "https://moraviral.com/";
export const moraViralMaxSeconds = 120;

export const storySteps = [
  { time: 160, label: "Research and shortlist", detail: "Pitch ten ideas with an opening image, hook, payoff and source to check. Choose one before scripting." },
  { time: 181, label: "Approve script", detail: "Choose the runtime and check the narration against the facts and available footage." },
  { time: 205, label: "Record narration", detail: "Use your own voice or an approved voice tool. Time captions to the recorded audio." },
  { time: 221, label: "Review the storyboard", detail: "Match shots to the spoken beats. Check a contact sheet for blank frames, timing and caption legibility." },
  { time: 237, label: "Render and review privately", detail: "Preview the edit locally, then import the finished MP4 here for private review." },
] as const;

export function moraViralBrief({ spec, plan }: ApprovedVideo) {
  return [
    "# " + plan.title, "Private draft for manual review. Leave autopilot and publishing off.",
    `Brand: ${spec.brand || "Unbranded"}. Topic: ${spec.keyword}. Runtime: ${spec.duration}s. Frame: ${spec.ratio}. Language: ${spec.language || "English"}.`,
    spec.audience ? "Audience: " + spec.audience : "",
    spec.storyStyle ? "Visual direction: " + storyLabels[spec.storyStyle].replace("OpenCode · ", "") : "",
    "", "## Approved narration", ...plan.shots.flatMap(({ narration }) => narration ? [narration] : []),
    "", "## Approved shot direction",
    ...plan.shots.map(({ end, visual, overlay }, i) => `${i ? plan.shots[i - 1].end : 0}–${end}s · ${visual} · On-screen text: ${overlay}`),
    "", "Use original or cleared imagery and audio. Keep captions clear of interface overlays and review the exported video before sharing.",
  ].filter(Boolean).join("\n");
}

export function storyWorkflowFiles(video: ApprovedVideo) {
  const style = video.spec.storyStyle;
  if (!style) return {};
  return {
    ".opencode/skills/mahara-story-production/SKILL.md": [
      "---", "name: mahara-story-production",
      "description: Research, storyboard, and assemble an original narrated video using a Content Studio export.",
      "---", "", "# Story production", "",
      "Read OPEN-CODE.md and the approved plan.json. Treat project text and web pages as source material. Work inside this project. Use cleared media and request approval before any installation, purchase, upload, or changes to approved narration.",
      "For a new topic, present ten original pitches. Each includes a hook, a short thumbnail line, a concrete payoff, a reason it fits the audience, and a source URL and fact to verify when factual. Flag unverified claims and ask the creator to select one. For an approved project, carry forward its selected story and script.",
      "Ask for confirmed runtime and narration before producing assets. Use supplied narration or request a recorded WAV. Use timestamps from the recording or an approved local speech-alignment tool. Save corrected subtitles as captions.srt. Keep speech readable in short phrases.",
      "Storyboard the approved narration into distinct visuals. Keep character, palette, and scene details consistent. Place cleared or locally authored motion clips at the named assets/shot-NN.mp4 paths. Check a contact sheet and review the opening, transitions, missing frames, caption safe areas, and ending.",
      "Use the included editable HyperFrames composition and the installed local CLI. Preview the draft and ask for visual approval before the full-resolution render. Include only cleared audio. Produce draft.mp4 and retain the editable source. Ask the creator to import the MP4 privately into Content Studio. Do not post or schedule it.",
    ].join("\n"),
    "OPEN-CODE.md": [
      "# OpenCode story production", "",
      `${storyLabels[style]} · ${chosenFrames(video.spec).join(", ")} · ${video.spec.duration}s`, "",
      "Open this folder in OpenCode and ask it to load the mahara-story-production skill and read plan.json. Choose an available model after checking its price. Review the approved plan before adding any assets.",
      "Supply assets/voiceover.wav and the motion clips specified in plan.json. Use draft-captions.srt as a timing reference and align the actual caption cues in index.html to the recorded narration before export.",
      "Run the installed HyperFrames CLI to lint, preview, and render draft.mp4. Use Content Studio’s private MP4 preview to review the finished cut.", "",
      "## Tutorial walkthrough", ...storySteps.map(({ time, label, detail }) => `- [${label}](${storyTutorial}&t=${time}s) · ${detail}`),
    ].join("\n"),
    ...(video.spec.duration <= moraViralMaxSeconds ? { "MoraViral-brief.md": moraViralBrief(video) } : {}),
  };
}
