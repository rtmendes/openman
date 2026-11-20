import { productionTools, videoTypes, type VideoPlan, type VideoSpec } from "./production";

export const videoDimensions = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] } as const;
export type ApprovedVideo = { spec: VideoSpec; plan: VideoPlan; brandContext: string };
type Files = Record<string, string>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (symbol) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[symbol] ?? symbol,
);

function stamp(time: number) {
  const ms = Math.round(time * 1000);
  return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map((part) => String(part).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0");
}

function buildProject({ spec, plan, brandContext }: ApprovedVideo): Files {
  const [width, height] = videoDimensions[spec.ratio];
  const shots = plan.shots.map((shot, i) => ({
    ...shot, start: i ? plan.shots[i - 1].end : 0, file: `assets/shot-${String(i + 1).padStart(2, "0")}.mp4`,
  }));
  const spoken = shots.filter(({ narration }) => narration);
  const parts = shots.map(({ start, end, file, overlay }, i) => {
    const timing = `data-start="${start}" data-duration="${end - start}"`;
    return `<video id="shot-${i}" class="clip footage" ${timing} data-track-index="0" src="${file}" muted playsinline></video>
<div id="overlay-${i}" class="clip caption" ${timing} data-track-index="1">${escapeHtml(overlay)}</div>`;
  }).join("\n");
  const editorial = [
    `# ${plan.title}`, "", `- Brand: ${spec.brand || "Unbranded"}`, `- Keyword: ${spec.keyword}`,
    `- Format: ${videoTypes[spec.type].label}, ${spec.ratio}, ${spec.duration} seconds`, "",
    "## Brand Kit", brandContext || "No brand kit supplied.", "",
    "## Shot order and timing",
    ...shots.flatMap(({ start, end, narration, visual, sound, asset, file, overlay }, i) => [
      "", `### Shot ${i + 1} · ${start}–${end}s`, visual, `- Narration: ${narration || "Silence"}`,
      `- Asset: ${asset}`, `- Sound: ${sound}`, `- On-screen text: ${overlay}`, `- Timeline file: ${file}`,
    ]),
    "", "## Social caption", plan.caption,
  ].join("\n");
  return {
    "index.html": `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(plan.title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#111;color:#fff;font-family:Arial,sans-serif}
#main{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#111}
.footage{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.caption{position:absolute;z-index:2;bottom:15%;left:9%;width:82%;text-align:center;padding:.38em .58em;background:rgba(12,15,19,.86);border-radius:.3em;font-size:${Math.round(Math.min(width, height) * 0.05)}px;font-weight:700;line-height:1.18;overflow-wrap:anywhere}
</style><body><div id="main" data-composition-id="main" data-start="0" data-duration="${spec.duration}" data-width="${width}" data-height="${height}">
${parts}
<audio id="narration" class="clip" src="assets/voiceover.wav" data-start="0" data-duration="${spec.duration}" data-track-index="2"></audio>
</div></body></html>`,
    "Motion.md": editorial,
    "OpenMontage.md": [
      "# OpenMontage production handoff", editorial, "",
      "Use the installed OpenMontage agent guide and select the matching pipeline after reading its manifest. Review the script, storyboard and assets as independent gates. Source cleared motion footage first. Quote any provider costs before generation.",
      "Return trimmed shot media and one mixed narration track to the specified asset paths. Keep the editable project and run visual, audio and caption QA. This job is a private draft.",
    ].join("\n"),
    "Shotcraft.md": [
      "# Video Shotcraft handoff", editorial, "",
      "Use the installed Video Shotcraft skill, shot library and Remotion template for product, motion or transition shots. Choose cards by shot purpose, follow the reference timing and inspect exported frames. Source original or cleared artwork and sound.",
      "Keep the editable Remotion project. Place the selected shot exports at the named asset paths. Avoid using an entire text-only slideshow as footage.",
    ].join("\n"),
    "draft-captions.srt": spoken.map(({ start, end, narration }, i) =>
      `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${narration}\n`,
    ).join("\n"),
    "plan.json": JSON.stringify({ spec, plan, assets: shots.map(({ file }) => file).concat("assets/voiceover.wav") }, null, 2),
    ...(spec.reference ? { "Reference-VIDEO.md": spec.reference } : {}),
  };
}

const runner = `import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base = fileURLToPath(new URL(".", import.meta.url));
if (!process.argv[2]) throw new Error("Pass the path to your installed HyperFrames CLI JavaScript entry point.");
const cli = resolve(process.argv[2]);
const { projects } = JSON.parse(readFileSync(resolve(base, "batch.json"), "utf8"));
let failures = 0;
for (const name of projects) {
  if (!/^video-[0-9]{2}$/.test(name)) throw new Error("Invalid project folder.");
  const cwd = resolve(base, name);
  const { assets } = JSON.parse(readFileSync(resolve(cwd, "plan.json"), "utf8"));
  const missing = assets.filter((asset) => !/^assets\\/(?:shot-[0-9]{2}\\.mp4|voiceover\\.wav)$/.test(asset) || !existsSync(resolve(cwd, asset)));
  if (missing.length) {
    console.error(name + " needs " + missing.join(", "));
    failures++;
    continue;
  }
  for (const args of [["lint"], ["render", "--output", "draft.mp4"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: "inherit" });
    if (result.status !== 0) {
      failures++;
      break;
    }
  }
}
process.exitCode = failures ? 1 : 0;
`;

export function productionFiles(videos: ApprovedVideo[]): Files {
  const projects = videos.map((_, index) => `video-${String(index + 1).padStart(2, "0")}`);
  return {
    "README.md": [
      "# Content Studio · approved draft projects", "",
      "Each folder contains an approved shot plan, narration script, a HyperFrames composition, draft subtitles and editing handoffs. The MP4 and WAV paths are slots for your cleared footage and timed narration. Provide those files before rendering.", "",
      ...productionTools.map(({ name, role, input, url }) => `- [${name}](${url}) · ${role}. ${input}`), "",
      "Place the named shot clips and one timed voiceover WAV in each assets folder. Keep the voiceover timeline aligned to the shot sheet. Draft subtitles use shot timing and need alignment against the recorded narration. Refine generated text overlays and inspect the hook, action, contrast, caption safe areas, sound and ending before review.", "",
      "Open a project folder and use the HyperFrames CLI to lint, preview, and render draft.mp4. To render a prepared batch with an existing local CLI, run node render-batch.mjs PATH_TO_HYPERFRAMES_CLI_JS from the extracted folder. Each row reports missing media and continues with the next row. Private review only.",
    ].join("\n"),
    "batch.json": JSON.stringify({ projects }, null, 2),
    "render-batch.mjs": runner,
    ...Object.fromEntries(videos.flatMap((video, i) =>
      Object.entries(buildProject(video)).map(([name, value]) => [`${projects[i]}/${name}`, value]),
    )),
  };
}

/** ZIP store records for portable source exports. Paths come from the project file map. */
export function productionZip(files: Files) {
  const encoder = new TextEncoder();
  const records: ArrayBuffer[] = [];
  const directory: ArrayBuffer[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const body = encoder.encode(content);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length + body.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, body.length, true);
    l.setUint32(22, body.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    records.push(local.buffer);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, body.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central.buffer);
    directorySize += central.length;
    offset += local.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, records.length, true);
  end.setUint16(10, records.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...records, ...directory, end.buffer], { type: "application/zip" });
}
