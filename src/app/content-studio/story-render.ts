import type { VideoPlan } from "./production";
import { storyShotAt, type StoryCue, type StoryPose } from "./story-timeline";

export type StoryScene = { image?: ImageBitmap; pose: StoryPose };

function actor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, pose: StoryPose, time: number) {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 3) * size * .027);
  ctx.scale(size, size);
  ctx.strokeStyle = "#151930";
  ctx.fillStyle = "#fff5d2";
  ctx.lineWidth = .045;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(0, -.72, .18, .21, Math.sin(time * 2) * .14, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  const sway = Math.sin(time * 5) * .07;
  ctx.moveTo(-.065, -.74);
  ctx.lineTo(-.057, -.74);
  ctx.moveTo(.065, -.74);
  ctx.lineTo(.073, -.74);
  ctx.moveTo(-.035, -.64);
  ctx.quadraticCurveTo(.025, pose === "React" ? -.75 : -.58, .065, -.65);
  ctx.moveTo(0, -.5);
  ctx.lineTo(0, .03);
  ctx.lineTo(-.2, .47 + sway);
  ctx.moveTo(0, .03);
  ctx.lineTo(.21, .47 - sway);
  ctx.moveTo(0, -.37);
  ctx.lineTo(-.16, -.19);
  ctx.lineTo(-.32, pose === "React" ? -.52 + sway : -.24);
  ctx.moveTo(0, -.37);
  ctx.lineTo(.16, -.2);
  ctx.lineTo(pose === "Think" ? .13 : .37, pose === "Point" ? -.46 + sway : pose === "Think" ? -.57 : -.18 - sway);
  ctx.stroke();
  ctx.restore();
}

function wordsToLines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last && ctx.measureText(last + " " + word).width <= width) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines;
}

export function drawStoryFrame(canvas: HTMLCanvasElement, plan: VideoPlan, cues: StoryCue[], scenes: StoryScene[], time: number) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("This browser could not draw the video.");
  const { width, height } = canvas;
  const size = Math.min(width, height);
  const index = storyShotAt(plan, time);
  const shot = plan.shots[index];
  const start = plan.shots[index - 1]?.end ?? 0;
  const offset = time - start;
  const pace = Math.max(0, Math.min(1, offset / (shot.end - start)));
  const scene = scenes[index];
  const swatches = [["#fbdda5", "#e78b6e"], ["#a5b5ff", "#7761b4"], ["#bbefd7", "#529d91"], ["#f4cadd", "#bf76a8"]];
  const palette = swatches[index % swatches.length];
  const backdrop = ctx.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, palette[0]);
  backdrop.addColorStop(1, palette[1]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);
  if (scene?.image) {
    const image = scene.image;
    const scale = Math.max(width / image.width, height / image.height) * (1.02 + .11 * pace);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (width - w) * (.5 + (index % 2 === 0 ? .22 : -.22) * pace), (height - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#fff5d29e";
    ctx.beginPath();
    ctx.arc(width * (.48 + .07 * pace), height * .43, size * .34, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#221b3334";
    ctx.beginPath();
    ctx.ellipse(width * .5, height * .65, size * .25, size * .025, 0, 0, 2 * Math.PI);
    ctx.fill();
    actor(ctx, width * (.48 + .035 * Math.sin(offset)), height * .49, size * .33, scene?.pose ?? "Present", offset);
  }
  if (shot.overlay) {
    ctx.font = `800 ${size * .06}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = height * (shot.overlayPosition === "middle" ? .48 : shot.overlayPosition === "lower" ? .65 : .16);
    ctx.fillStyle = "#18182fe8";
    const lines = wordsToLines(ctx, shot.overlay, width * .8);
    ctx.beginPath();
    ctx.roundRect(width * .07, y - size * .05, width * .86, (lines.length * .086 + .02) * size, size * .03);
    ctx.fill();
    ctx.fillStyle = "#fff4cf";
    lines.forEach((line, i) => ctx.fillText(line, width / 2, y + i * size * .086, width * .78));
  }
  const caption = cues.find(({ start, end }) => time >= start && time < end);
  if (caption) {
    ctx.font = `700 ${size * .043}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wordsToLines(ctx, caption.text, width * .72);
    const lineHeight = size * .065;
    ctx.fillStyle = "#100f21ed";
    ctx.fillRect(width * .09, height * .85 - lines.length * lineHeight, width * .82, lines.length * lineHeight + size * .025);
    ctx.fillStyle = "#fff";
    lines.forEach((line, i) => ctx.fillText(line, width / 2, height * .85 - (lines.length - i - .7) * lineHeight, width * .73));
  }
}

export async function recordStory(canvas: HTMLCanvasElement, draw: (time: number) => void, duration: number,
  audioBytes: ArrayBuffer | undefined, signal: AbortSignal, onProgress: (time: number) => void) {
  const type = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find((mime) => MediaRecorder.isTypeSupported(mime));
  if (!type) throw new Error("This browser cannot export video. Try a recent Chrome or Edge, or use the OpenCode export.");
  const audio = audioBytes ? new AudioContext() : null;
  let stream: MediaStream | undefined;
  let source: AudioBufferSourceNode | undefined;
  let recorder: MediaRecorder | undefined;
  try {
    if (audio && audioBytes) {
      await audio.resume();
      const buffer = await audio.decodeAudioData(audioBytes);
      if (buffer.duration > duration + .05) throw new Error(`Narration is ${buffer.duration.toFixed(1)}s. Trim it to ${duration}s before rendering.`);
      source = audio.createBufferSource();
      source.buffer = buffer;
    }
    if (signal.aborted) throw new Error("Render canceled.");
    if (document.hidden) throw new Error("Keep Content Studio open and visible while rendering.");
    draw(0);
    stream = canvas.captureStream(24);
    if (audio && source) {
      const destination = audio.createMediaStreamDestination();
      source.connect(destination);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.min(3_500_000, Math.floor(325_000_000 / duration)) });
    const active = recorder;
    const chunks: Blob[] = [];
    const start = performance.now();
    const video = await new Promise<Blob>((resolve, reject) => {
      let frame = 0;
      function cleanup() {
        cancelAnimationFrame(frame);
        signal.removeEventListener("abort", abort);
        document.removeEventListener("visibilitychange", visibility);
      }
      function abort() { cleanup(); reject(new Error("Render canceled.")); }
      function visibility() {
        if (document.hidden) { cleanup(); reject(new Error("The render was paused when the tab became hidden. Keep this tab visible and try again.")); }
      }
      function tick(now: number) {
        try {
          const time = (now - start) / 1000;
          if (time >= duration) { onProgress(duration); active.stop(); return; }
          draw(Math.max(0, time));
          onProgress(time);
          frame = requestAnimationFrame(tick);
        } catch (error) { cleanup(); reject(error); }
      }
      active.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      active.onerror = () => { cleanup(); reject(new Error("The browser could not encode the draft.")); };
      active.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: active.mimeType.split(";")[0] })); };
      signal.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", visibility);
      try { active.start(); source?.start(); frame = requestAnimationFrame(tick); }
      catch (error) { cleanup(); reject(error); }
    });
    if (signal.aborted || !video.size) throw new Error("The browser did not finish the video.");
    return video;
  } finally {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    if (audio) await audio.close();
  }
}
