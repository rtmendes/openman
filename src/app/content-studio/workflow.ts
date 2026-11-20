// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
export const stages = [
  {
    title: "Set up your agent", output: "STATUS.md · RULES.md",
    description: "Set up your tools, connections, and review rules.",
    instructions: [
      "Set up FFmpeg, yt-dlp, PySceneDetect, and faster-whisper if available. Check what is installed first.",
      "Check YouTube, Instagram, and Apify connections through Composio and TikTok through Upload-Post if available. Explain the consent screens and never ask for keys in chat.",
      "Create STATUS.md and RULES.md and read them at the start of every run. Record blockers, decisions, and approved sources.",
      "Have a fresh reviewer judge each thumbnail and edit. Revise rejected work and ask for explicit approval before publishing.",
    ],
  },
  {
    title: "Find breakout videos", output: "outliers.csv",
    description: "Find videos that outperform their channel’s usual results.",
    instructions: [
      "Find active YouTube channels in the selected niche and language. Show the shortlist and wait for channel approval before collecting their recent videos.",
      "Use Apify’s YouTube channel scraper if available. Compare videos with each channel’s median for similar formats and time since publication.",
      "Save outliers.csv with title, source URL, creator, date, views, baseline, and view multiple. Report missing data and the sample size.",
      "Provide a weekly rerun plan and summarize what changed when a prior report is available. Ask before creating a recurring job.",
    ],
  },
  {
    title: "Build titles & thumbnails", output: "THUMBNAILS.md",
    description: "Turn recurring patterns into original packaging.",
    instructions: [
      "Study verified titles and thumbnails in outliers.csv. Save recurring patterns and source examples to THUMBNAILS.md.",
      "Draft three titles and three distinct thumbnail concepts per selected idea. Use a few large words and design for mobile.",
      "Generate thumbnail images with an available image tool. If none is available, provide image prompts and layout notes.",
      "Have a fresh reviewer pick the strongest accurate title and thumbnail. Revise if none pass review.",
    ],
  },
  {
    title: "Source the best clips", output: "clips.csv",
    description: "Rank recent clips by views per hour and keep their sources.",
    instructions: [
      "Find relevant recent clips on Twitch, Kick, and TikTok using Apify where available. Prefer clips cleared for reuse.",
      "Rank by views divided by hours since publication using a minimum age of one hour. Keep the original URL, creator handle, and permission status.",
      "Skip spoilers, endings, exploit demonstrations, and anything excluded in the brief. Flag unclear rights for review.",
      "Save clips.csv and provide a daily collection plan. Ask before creating a recurring job.",
    ],
  },
  {
    title: "Edit the episode", output: "episode-plan.md",
    description: "Open on a standout moment and build a tight compilation.",
    instructions: [
      "Open directly on a strong clip and trim to the runtime of comparable outliers when that evidence is available.",
      "Give each clip a one-line label and creator handle. Credit every creator with a link in the description.",
      "Save a timecoded episode plan with edit cues. Render a draft when cleared footage and editing tools are available.",
      "Have a fresh reviewer check the cut, pacing, and credits before requesting publishing approval.",
    ],
  },
  {
    title: "Cut vertical clips", output: "shorts-plan.md",
    description: "Adapt the strongest moments for short-form platforms.",
    instructions: [
      "Pick strong self-contained moments and open on the payoff in a 9:16 frame.",
      "Put facecam above the main action if both are available. Otherwise reframe the main subject for vertical.",
      "Add word-by-word captions clear of platform controls. Prepare native versions for the selected platforms with creator tags where relevant.",
      "Save a timecoded cut list and render drafts when cleared footage and tools are available. Wait for explicit approval before uploading.",
    ],
  },
  {
    title: "Script an original video", output: "script.md",
    description: "Write a payoff-first video around footage you can record.",
    instructions: [
      "Write script.md using original footage. Make a shot list that says exactly what to record.",
      "Use the selected format. When no target runtime is set, use comparable verified videos to estimate a suitable runtime.",
      "Show the payoff first, then write the full voiceover with visual cues, pacing, and transitions.",
      "Deliver three titles and a platform-ready description alongside the script.",
    ],
  },
] as const;

export const examples = ["GTA 6", "Home coffee", "Street photography", "Personal finance"];
export const formats = ["Guide", "Ranking", "Challenge", "Explainer", "Compilation", "Comedy skit"];
export const platforms = ["YouTube", "TikTok", "Instagram"] as const;
export const runtimes = [
  { value: "", label: "Agent recommends" },
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "90", label: "90 seconds" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
] as const;
type Platform = (typeof platforms)[number];

export type Brief = {
  topic: string;
  audience: string;
  language: string;
  format: string;
  platforms: Platform[];
  notes: string;
  runtimeSeconds?: number;
  brandContext?: string;
};

export function makePrompt(brief: Brief, index: number) {
  const stage = stages[index];
  const targetRuntime = brief.runtimeSeconds ? runtimes.find(({ value }) => Number(value) === brief.runtimeSeconds)?.label ?? `${brief.runtimeSeconds} seconds` : undefined;
  return [
    "# " + stage.title,
    "## Content brief",
    "- Niche: " + brief.topic.trim(),
    "- Audience: " + (brief.audience.trim() || "People interested in this niche"),
    "- Language: " + brief.language.trim(),
    "- Format: " + brief.format,
    "- Platforms: " + brief.platforms.join(", "),
    "- Target runtime: " + (targetRuntime ?? "Recommend a runtime for the format and platforms"),
    ...(brief.brandContext ? ["", "## Read-only brand context", brief.brandContext] : []),
    ...(brief.notes.trim() ? ["", "## Source material and constraints", brief.notes.trim()] : []),
    "",
    "## Task",
    ...stage.instructions.map((instruction, i) => (i + 1) + ". " + instruction),
    ...(targetRuntime && (index === 4 || index === 5 || index === 6) ? [
      "Use the explicit runtime target where the selected platform supports it. For vertical cuts, flag incompatible lengths and propose a shorter version. For narration, estimate spoken word count and include timed beats and space for visual pauses. Treat runtime estimates as estimates until recorded.",
    ] : []),
    "",
    "## Deliverables",
    stage.output,
    "",
    "Use STATUS.md and RULES.md if available. Ask for relevant outputs from earlier steps if they are missing. Report missing dependencies and distinguish verified findings from suggestions. Use only cleared footage in edits. Publishing requires separate explicit approval.",
  ].join("\n");
}
