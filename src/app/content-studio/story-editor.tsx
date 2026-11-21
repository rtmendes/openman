"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { studioMediaUrl, uploadStudioMedia } from "@/lib/agent/client";
import { mediaExtension, studioMediaLimit } from "@/lib/studio/media-types";
import { chosenFrames, readVideoPlan, type VideoPlan, type VideoRatio } from "./production";
import { videoDimensions, type ApprovedVideo } from "./production-package";
import { drawStoryFrame, recordStory, type StoryScene } from "./story-render";
import { parseStorySubtitles, storyDraftCues, storyPoses, type StoryCue, type StoryEdit, type StoryPose } from "./story-timeline";

async function imageById(id: string) {
  const response = await fetch(studioMediaUrl(id));
  if (!response.ok) throw new Error("A storyboard image could not be opened. Reattach it and try again.");
  return createImageBitmap(await response.blob());
}

function ShotPreview({ plan, cues, index, ratio, image, pose }: {
  plan: VideoPlan; cues: StoryCue[]; index: number; ratio: VideoRatio; image?: string; pose: StoryPose;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [width, height] = videoDimensions[ratio];
  useEffect(() => {
    let active = true;
    const canvas = ref.current;
    if (!canvas) return;
    async function preview() {
      let bitmap: ImageBitmap | undefined;
      try {
        if (image) bitmap = await imageById(image);
        if (!active || !canvas) return;
        const scenes: StoryScene[] = [];
        scenes[index] = { image: bitmap, pose };
        drawStoryFrame(canvas, plan, cues, scenes, (plan.shots[index - 1]?.end ?? 0) + .35);
        setUnavailable(false);
      } catch { if (active) setUnavailable(true); }
      finally { bitmap?.close(); }
    }
    void preview();
    return () => { active = false; };
  }, [plan, cues, index, pose, image, ratio]);
  return <>{unavailable ? <p role="status">Shot preview unavailable.</p> : null}
    <canvas hidden={unavailable} ref={ref} width={width / 3} height={height / 3} aria-label={`Storyboard preview, shot ${index + 1}`} /></>;
}

export function StoryEditor({ approved, value, onChange, onRender, cloud }: {
  approved: ApprovedVideo; value?: StoryEdit; onChange: (value: StoryEdit) => void;
  onRender: (file: File) => Promise<void>; cloud: boolean;
}) {
  const { plan, spec } = approved;
  const edit = value ?? {};
  const frames = chosenFrames(spec);
  const [selectedFrame, setFrame] = useState<VideoRatio>(frames[0]);
  const frame = frames.includes(selectedFrame) ? selectedFrame : frames[0];
  const [quality, setQuality] = useState("preview");
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [localAudio, setLocalAudio] = useState<File>();
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const output = useRef<HTMLCanvasElement>(null);
  const sources = spec.media ?? [];
  const stills = sources.filter(({ type }) => type.startsWith("image/"));
  const audioSources = sources.filter(({ type }) => type.startsWith("audio/"));
  const audioId = edit.audio?.id;
  const cues = useMemo(() => edit.subtitles ?? storyDraftCues(plan), [edit.subtitles, plan]);
  const reviewInput = JSON.stringify([plan, frame, edit.images, edit.poses, audioId, localAudio?.name, localAudio?.lastModified, edit.subtitles]);
  let reviewHash = 2166136261;
  for (let i = 0; i < reviewInput.length; i++) reviewHash = Math.imul(reviewHash ^ reviewInput.charCodeAt(i), 16777619);
  const reviewKey = `${reviewInput.length}:${reviewHash}`;
  const reviewed = reviewKey === edit.storyboardApproved;
  const missing = plan.shots.filter((_, index) => spec.storyStyle === "illustrated-story" &&
    !stills.some(({ id }) => id === edit.images?.[index])).length;
  useEffect(() => () => controller.current?.abort(), []);

  function save(change: Partial<StoryEdit>) {
    onChange({ ...edit, ...change, storyboardApproved: undefined });
    setStatus("");
  }

  async function attachAudio(file: File) {
    if (busy.current) return;
    if (!/^(wav|mp3|m4a|ogg)$/.test(mediaExtension(file.name)) || !file.size || file.size > studioMediaLimit) {
      setStatus("Use WAV, MP3, M4A or OGG audio up to 50 MB.");
      return;
    }
    busy.current = true;
    setPending("Saving narration…");
    try {
      if (cloud) save({ audio: await uploadStudioMedia(file) });
      else { setLocalAudio(file); save({ audio: undefined }); }
    } catch { setStatus("Narration upload failed. Try choosing the audio again."); }
    finally { setPending(""); busy.current = false; }
  }

  async function render() {
    if (!reviewed || missing || busy.current || !output.current) return;
    if (typeof MediaRecorder === "undefined" || typeof output.current.captureStream !== "function") {
      setStatus("Browser video export is unavailable. Use Chrome, Edge or the OpenCode export.");
      return;
    }
    busy.current = true;
    setProgress(0);
    setStatus("");
    setPending("Preparing render…");
    const abort = new AbortController();
    controller.current = abort;
    const bitmaps = new Map<string, ImageBitmap>();
    try {
      readVideoPlan(JSON.stringify(plan), spec.duration);
      for (const id of new Set(Object.values(edit.images ?? {}))) {
        if (stills.some((image) => image.id === id)) bitmaps.set(id, await imageById(id));
        if (abort.signal.aborted) throw new Error("Render canceled.");
      }
      let audio = await localAudio?.arrayBuffer();
      if (audioId) {
        const response = await fetch(studioMediaUrl(audioId), { signal: abort.signal });
        if (!response.ok) throw new Error("The narration could not be opened. Reattach it and try again.");
        audio = await response.arrayBuffer();
      }
      const scenes = plan.shots.map((_, index) => ({
        image: bitmaps.get(edit.images?.[index] ?? ""), pose: edit.poses?.[index] ?? storyPoses[index % storyPoses.length],
      }));
      const canvas = output.current;
      if (!canvas || abort.signal.aborted) throw new Error("Render canceled.");
      const scale = quality === "hd" ? 1 : 2 / 3;
      canvas.width = Math.round(videoDimensions[frame][0] * scale);
      canvas.height = Math.round(videoDimensions[frame][1] * scale);
      setPending("Rendering in this tab…");
      const blob = await recordStory(canvas, (time) => drawStoryFrame(canvas, plan, cues, scenes, time),
        spec.duration, audio, abort.signal, (time) => setProgress(Math.floor(100 * time / spec.duration)));
      const extension = blob.type === "video/mp4" ? "mp4" : "webm";
      const name = (plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 75) || "story") +
        "-" + frame.replace(":", "x") + "." + extension;
      setPending(cloud ? "Saving private render…" : "Preparing video preview…");
      await onRender(new File([blob], name, { type: blob.type }));
      setStatus("Private render ready. Play it below before sharing.");
    } catch (error) { if (!abort.signal.aborted) setStatus(error instanceof Error ? error.message : "Could not render the video."); }
    finally {
      bitmaps.forEach((bitmap) => bitmap.close());
      controller.current = null;
      setPending("");
      busy.current = false;
    }
  }

  return <div className="studio-story-editor">
    <h4>Narration and captions</h4>
    <fieldset disabled={Boolean(pending)} className="production-fields">
      {audioSources.length > 0 && <label>Narration from references<select value={audioSources.some(({ id }) => id === audioId) ? audioId : ""}
        onChange={(event) => { setLocalAudio(undefined); save({ audio: audioSources.find(({ id }) => id === event.target.value) }); }}>
        <option value="">Choose saved audio</option>{audioSources.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
      </select></label>}
      <label>Attach narration<input type="file" accept=".wav,.mp3,.m4a,.ogg" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void attachAudio(file);
      }} /></label>
      <label>Import timed SRT<input type="file" accept=".srt" onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file || busy.current) return;
        try {
          if (file.size > 80_000) throw new Error("Use an SRT under 80 KB.");
          save({ subtitles: parseStorySubtitles(await file.text(), spec.duration) });
        } catch (error) { setStatus(error instanceof Error ? error.message : "Could not read the captions."); }
      }} /></label>
    </fieldset>
    <p className="production-hint">{edit.audio?.name ?? localAudio?.name ?? "No narration attached. You can render a silent animatic."}</p>
    {audioId && <audio aria-label="Narration preview" controls preload="metadata" src={studioMediaUrl(audioId)} />}
    {(edit.audio || localAudio) && <button type="button" disabled={Boolean(pending)} onClick={() => { setLocalAudio(undefined); save({ audio: undefined }); }}>Remove narration</button>}
    <p className="production-hint">{edit.subtitles ? `${edit.subtitles.length} timed captions imported.` : "Draft captions follow the shot timing. Import an aligned SRT for precise narration timing."}</p>
    {edit.subtitles && <button type="button" disabled={Boolean(pending)} onClick={() => save({ subtitles: undefined })}>Use draft captions</button>}
    <h4>Storyboard review</h4>
    <fieldset disabled={Boolean(pending)} className="production-fields">
      <label>Render frame<select value={frame} onChange={(event) => setFrame(event.target.value as VideoRatio)}>
        {frames.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
      <label>Render quality<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="preview">720p preview</option><option value="hd">1080p</option></select></label>
      <div className="studio-story-shots production-wide">
        {plan.shots.map((shot, index) => {
          const pose = edit.poses?.[index] ?? storyPoses[index % storyPoses.length];
          const image = stills.find(({ id }) => id === edit.images?.[index]);
          return <article key={index}>
            <strong>Shot {index + 1} · {plan.shots[index - 1]?.end ?? 0}–{shot.end}s</strong>
            <ShotPreview plan={plan} cues={cues} index={index} ratio={frame} pose={pose} image={image?.id} />
            <p>{shot.visual}</p>
            {spec.storyStyle === "stick-figure" && !image && <label>Pose for shot {index + 1}<select value={pose} onChange={(event) =>
              save({ poses: { ...edit.poses, [index]: event.target.value as StoryPose } })}>
              {storyPoses.map((option) => <option key={option}>{option}</option>)}</select></label>}
            {stills.length > 0 && <label>Image for shot {index + 1}<select value={image?.id ?? ""} onChange={(event) =>
              save({ images: { ...edit.images, [index]: event.target.value } })}>
              <option value="">{spec.storyStyle === "stick-figure" ? "Animated character" : "Select an illustration"}</option>
              {stills.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>}
          </article>;
        })}
      </div>
    </fieldset>
    {missing > 0 && <p className="production-hint">Add images under References and attachments and select one for each of the {missing} remaining shots. Approve any updated script before rendering.</p>}
    <div className="content-studio-runActions">
      <button type="button" disabled={Boolean(pending) || missing > 0 || reviewed} onClick={() => {
        onChange({ ...edit, storyboardApproved: reviewKey }); setStatus("Storyboard approved for this frame.");
      }}>{reviewed ? "Storyboard approved" : "Approve storyboard"}</button>
      <button type="button" disabled={!reviewed || Boolean(pending) || missing > 0} onClick={() => void render()}>Render private draft</button>
      {(pending === "Preparing render…" || pending === "Rendering in this tab…") && <button type="button" onClick={() => {
        controller.current?.abort(); setStatus("Render canceled.");
      }}>Cancel render</button>}
    </div>
    {pending && <p role="status">{pending} {pending === "Rendering in this tab…" ? `${progress}%` : ""}</p>}
    {status && <p role="status">{status}</p>}
    <canvas hidden ref={output} aria-hidden />
  </div>;
}
