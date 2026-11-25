"use client";

import { useEffect, useRef, useState } from "react";
import { generateStudioNarration, listStudioNarrationVoices, studioMediaUrl, uploadStudioMedia } from "@/lib/agent/client";
import { mediaExtension, studioMediaLimit, type StudioMedia } from "@/lib/studio/media-types";
import { studioNarrationLimit, studioNarrationText, type StudioNarrationVoice } from "@/lib/studio/narration";
import type { VideoPlan, VideoSpec } from "./production";

export function NaturalNarration({ spec, plan, revision, cloud, stale, media, onVoice, onAudio }: {
  spec: VideoSpec; plan?: VideoPlan; revision?: number; cloud: boolean; stale?: boolean; media?: StudioMedia;
  onVoice: (voice: NonNullable<VideoSpec["voice"]>) => void;
  onAudio: (media: StudioMedia) => void;
}) {
  const [catalog, setCatalog] = useState<{ configured: boolean; voices: StudioNarrationVoice[] }>();
  const [message, setMessage] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [length, setLength] = useState<{ id: string; seconds: number }>();
  const request = useRef<{ revision: number; id: string }>(undefined);
  const inFlight = useRef(false);
  const voice = spec.voice ?? { style: "Warm conversational", rate: 1 };
  const selected = catalog?.voices.find(({ id }) => id === voice.voiceId);
  const text = studioNarrationText(plan);

  useEffect(() => {
    if (!cloud) return;
    let active = true;
    void listStudioNarrationVoices().then((result) => { if (active) setCatalog(result); })
      .catch((error: unknown) => { if (active) setCatalogError(error instanceof Error ? error.message : "Could not load studio voices."); });
    return () => { active = false; };
  }, [cloud]);

  async function save(action: () => Promise<StudioMedia>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try { onAudio(await action()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the narration."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function generate() {
    if (!revision || !selected || stale || !text || text.length > studioNarrationLimit) return;
    const id = request.current?.revision === revision ? request.current.id : crypto.randomUUID();
    request.current = { revision, id };
    void save(async () => (await generateStudioNarration(id, spec.id, revision)).media);
  }

  return <section className="production-wide production-inputGroup studio-natural-voice" aria-label="Studio narration">
    <h5>Natural narration · English</h5>
    {cloud && !catalog && !catalogError && <p role="status">Checking studio voices…</p>}
    {catalogError && <p role="status">{catalogError}</p>}
    {catalog?.configured && catalog.voices.length > 0 && <fieldset disabled={busy} className="production-fields">
      <label>ElevenLabs voice<select value={selected?.id ?? ""} onChange={(event) => onVoice({ ...voice, language: "en-US", voiceId: event.target.value || undefined })}>
        <option value="">Choose a voice</option>{catalog.voices.map(({ id, name, accent }) => <option key={id} value={id}>{name}{accent ? ` · ${accent}` : ""}</option>)}
      </select></label>
      <label>Delivery speed<select value={voice.rate} onChange={(event) => onVoice({ ...voice, rate: Number(event.target.value) })}>
        <option value={0.85}>Unhurried</option><option value={1}>Natural</option><option value={1.1}>Brisk</option>
      </select></label>
      {selected && <div className="production-wide">
        {selected.description && <p className="production-hint">{selected.description}</p>}
        {selected.previewUrl && <audio key={selected.id} controls preload="none" src={selected.previewUrl} aria-label={`ElevenLabs voice sample for ${selected.name}`} />}
      </div>}
      {text ? <div className="production-wide">
        <button type="button" onClick={generate} disabled={!revision || !selected || stale || text.length > studioNarrationLimit}>
          Generate narration · {text.length.toLocaleString()} characters
        </button>
        <p className="production-hint">{stale ? "Update the script to match the brief before generating."
          : text.length > studioNarrationLimit ? "Split the script into shorter recordings."
            : "Generation uses ElevenLabs credits. Voice samples are recordings."}</p>
      </div> : <p className="production-wide production-hint">Write or import a script to generate its voiceover.</p>}
    </fieldset>}
    {catalog?.configured && !catalog.voices.length && <p className="production-hint">Add voices to the connected ElevenLabs account.</p>}
    {catalog?.configured === false && <p className="production-hint">Connect ElevenLabs to generate here, or upload a recorded voiceover. <a target="_blank" rel="noreferrer" href="https://elevenlabs.io/voice-library">Hear ElevenLabs voice samples</a></p>}
    {cloud ? <label>Upload a recorded voiceover<input type="file" disabled={busy} accept=".mp3,.wav,.m4a,.ogg" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!/^(mp3|wav|m4a|ogg)$/.test(mediaExtension(file.name)) || !file.size || file.size > studioMediaLimit) {
        setMessage("Choose MP3, WAV, M4A or OGG up to 50 MB.");
        return;
      }
      void save(() => uploadStudioMedia(file));
    }} /></label> : <p className="production-hint">Sign in to save a voiceover.</p>}
    {busy && <p role="status">Saving narration…</p>}
    {message && <p role="status">{message}</p>}
    {media && <div className="production-wide">
      <p>{media.name}</p>
      <audio controls preload="metadata" key={media.id} src={studioMediaUrl(media.id)} aria-label="Saved project narration"
        onLoadedMetadata={(event) => setLength({ id: media.id, seconds: event.currentTarget.duration })} />
      {length?.id === media.id && length.seconds > spec.duration + 0.05 && <p role="status">
        This recording is {length.seconds.toFixed(1)}s. Fit it to {spec.duration}s before rendering.
      </p>}
      <a href={studioMediaUrl(media.id, true)}>Download voiceover</a>
    </div>}
  </section>;
}
