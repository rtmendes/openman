"use client";

import { Headphones, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { narrationLanguage, voiceDirections, type VideoSpec } from "./production";

const samples = {
  "Warm conversational": { file: "warm", description: "Relaxed and direct", rate: 0.92, pitch: 1.05 },
  "Dry and deadpan": { file: "deadpan", description: "Flat read, longer beat", rate: 0.88, pitch: 0.84 },
  "Bright creator": { file: "bright", description: "Upbeat and expressive", rate: 1.08, pitch: 1.2 },
  "Calm storyteller": { file: "storyteller", description: "Slow, with room to pause", rate: 0.76, pitch: 0.97 },
  Documentary: { file: "documentary", description: "Measured and grounded", rate: 0.92, pitch: 0.78 },
  "Clear instructional": { file: "instructional", description: "Even pace, clear phrases", rate: 0.98, pitch: 1.01 },
  "Energetic promo": { file: "energetic", description: "Fast and emphatic", rate: 1.19, pitch: 1.12 },
  "Soft and intimate": { file: "intimate", description: "Quiet and close", rate: 0.8, pitch: 0.92 },
};
const defaultVoice: NonNullable<VideoSpec["voice"]> = { style: "Warm conversational", rate: 1 };

export function NarrationOptions({ voice, line, onChange }: {
  voice?: VideoSpec["voice"]; line?: string; onChange: (value: NonNullable<VideoSpec["voice"]>) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const value = voice ?? defaultVoice;
  const style = voiceDirections.find((item) => item === value.style) ?? "Warm conversational";
  const availableVoice = voices.find(({ voiceURI }) => voiceURI === value.device);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices().filter(({ lang }) => /^en(?:[-_]|$)/i.test(lang)));
    const frame = requestAnimationFrame(load);
    synth.addEventListener("voiceschanged", load);
    return () => {
      cancelAnimationFrame(frame);
      synth.removeEventListener("voiceschanged", load);
      if (speech.current) synth.cancel();
    };
  }, []);

  function stop() {
    audio.current?.pause();
    if (speech.current) {
      speech.current = null;
      window.speechSynthesis?.cancel();
    }
    setPlaying("");
    setMessage("");
  }

  function playSample(name: keyof typeof samples) {
    stop();
    if (playing === name || !audio.current) return;
    const player = audio.current;
    const src = `/studio/voice/${samples[name].file}.wav`;
    player.src = src;
    setPlaying(name);
    void player.play().catch((error: unknown) => {
      if (player.getAttribute("src") !== src || (error instanceof DOMException && error.name === "AbortError")) return;
      setPlaying("");
      setMessage("This sample couldn’t play. Try it again.");
    });
  }

  function audition() {
    stop();
    const synth = window.speechSynthesis;
    if (!synth || !line) { setMessage("This browser can play the recorded samples. Try another browser to hear your script."); return; }
    const utterance = new SpeechSynthesisUtterance(line);
    const preferred = availableVoice ?? voices.find(({ default: isDefault }) => isDefault) ?? voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang || "en-US";
    const delivery = samples[style];
    utterance.rate = delivery.rate * value.rate;
    utterance.pitch = delivery.pitch;
    const finish = (message = "") => {
      if (speech.current !== utterance) return;
      speech.current = null;
      setPlaying("");
      setMessage(message);
    };
    utterance.onend = () => finish();
    utterance.onerror = () => finish("This device couldn’t read the opening line. The recorded samples are still available.");
    speech.current = utterance;
    setPlaying("script");
    synth.speak(utterance);
  }

  function update(change: Partial<NonNullable<VideoSpec["voice"]>>) {
    onChange({ ...value, style, ...change, language: "en-US" });
  }

  return <details id="studio-narration" className="production-wide production-inputGroup" open>
    <summary>Narration and voice · {narrationLanguage}</summary>
    <div className="studio-voice-heading">
      <div><Headphones size={20} aria-hidden /><strong>Hear the delivery</strong></div>
      <p>Compare the same line in eight styles using an English sample voice.</p>
    </div>
    <div className="studio-voice-grid">
      {voiceDirections.map((name) => <div className="studio-voice-card" key={name} data-selected={style === name}>
        <button type="button" className="studio-voice-play" aria-label={`${playing === name ? "Stop" : "Play"} ${name} sample`}
          onClick={() => playSample(name)}>{playing === name ? <Square size={16} /> : <Play size={16} fill="currentColor" />}</button>
        <div><strong>{name}</strong><span>{samples[name].description}</span></div>
        <button type="button" className="studio-voice-use" aria-pressed={style === name} aria-label={`Use ${name}`} onClick={() => update({ style: name })}>
          {style === name ? "Selected" : "Use"}
        </button>
      </div>)}
    </div>
    <audio ref={audio} onEnded={() => setPlaying("")} preload="none" />
    <div className="production-fields">
      <label>Opening line preview voice<select value={availableVoice?.voiceURI ?? ""} onChange={(event) => update({ device: event.target.value || undefined })}>
        <option value="">Default English voice</option>{voices.map(({ voiceURI, name, lang }) =>
          <option key={voiceURI} value={voiceURI}>{name} · {lang}</option>)}</select></label>
      <label>Pace<select value={value.rate} onChange={(event) => update({ rate: Number(event.target.value) })}>
        <option value="0.85">Unhurried · 0.85×</option><option value="1">Natural · 1×</option><option value="1.1">Brisk · 1.1×</option>
      </select></label>
    </div>
    {line && <div className="content-studio-runActions"><button type="button" onClick={playing === "script" ? stop : audition}>
      {playing === "script" ? "Stop opening line" : "Hear my opening line"}
    </button></div>}
    {message && <p role="status">{message}</p>}
  </details>;
}
