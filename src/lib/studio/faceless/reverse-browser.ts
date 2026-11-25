import { ReverseReport, delta, dominant, cutsFromFrames, styleBrief } from './reverse';
function mediaEvent(el: HTMLVideoElement, event: string, action: () => void, signal?: AbortSignal) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(() => done(new Error('Video decoding timed out. Try MP4 H.264 or WebM.')), 15000); const ok = () => done(); const error = () => done(new Error('This browser cannot decode this video.')); const cancel = () => done(new Error('Analysis cancelled.')); function done(e?: Error) { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', error); signal?.removeEventListener('abort', cancel); if (e)
    reject(e);
else
    resolve(); } el.addEventListener(event, ok, { once: true }); el.addEventListener('error', error, { once: true }); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted)
    cancel();
else
    action(); }); }
const db = (x: number) => Math.max(-100, 20 * Math.log10(Math.max(1e-5, x)));
export async function analyzeVideo(file: Blob, name: string, opts: {
    start: number;
    length: number;
    fps: number;
    threshold: number;
    signal?: AbortSignal;
    progress: (s: string) => void;
}) { if (![opts.start, opts.length, opts.fps, opts.threshold].every(Number.isFinite) || opts.start < 0 || opts.length <= 0 || opts.length > 180 || opts.fps < 1 || opts.fps > 10 || opts.threshold <= 0 || opts.threshold > 1)
    throw new Error('Use valid start, duration, sampling and threshold values.'); if (file.size > 100e6)
    throw new Error('Local video limit is 100 MB. Trim a 30-second segment first.'); const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; const url = URL.createObjectURL(file); const thumbs: {
    t: number;
    image: string;
}[] = []; try {
    await mediaEvent(video, 'loadedmetadata', () => video.src = url, opts.signal);
    if (!Number.isFinite(video.duration)) {
        await mediaEvent(video, 'seeked', () => video.currentTime = 1e7, opts.signal);
    }
    if (!Number.isFinite(video.duration))
        throw new Error('This file has no usable duration metadata. Remux to MP4 or WebM.');
    const start = Math.max(0, opts.start), end = Math.min(video.duration, start + Math.min(180, opts.length));
    if (start >= end)
        throw new Error('The selected segment starts after the video ends.');
    const fps = Math.max(1, Math.min(10, opts.fps));
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 54;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const thumb = document.createElement('canvas');
    thumb.width = 240;
    thumb.height = Math.round(240 * video.videoHeight / video.videoWidth);
    const tc = thumb.getContext('2d')!;
    const frames: ReverseReport['frames'] = [];
    let prev: Uint8ClampedArray | undefined;
    const count = Math.ceil((end - start) * fps);
    for (let i = 0; i < count; i++) {
        if (opts.signal?.aborted)
            throw new Error('Analysis cancelled.');
        const t = Math.min(end - .001, start + i / fps);
        await mediaEvent(video, 'seeked', () => video.currentTime = t === 0 ? .0001 : t, opts.signal);
        ctx.drawImage(video, 0, 0, 96, 54);
        const pixels = ctx.getImageData(0, 0, 96, 54).data;
        frames.push({ t, difference: prev ? delta(prev, pixels) : 0, color: dominant(pixels) });
        prev = pixels;
        if (i % Math.max(1, Math.ceil(count / 24)) === 0) {
            tc.drawImage(video, 0, 0, thumb.width, thumb.height);
            thumbs.push({ t, image: thumb.toDataURL('image/jpeg', .65) });
        }
        opts.progress(`Reading frame ${i + 1} of ${count}`);
    }
    const bins = new Map<string, number>();
    frames.forEach(f => bins.set(f.color, (bins.get(f.color) || 0) + 1));
    let audio: ReverseReport['audio'] = null;
    const limits = ['Frame-difference cut candidates are an approximate editing aid, not complete ground truth. Motion, flashes and dissolves can cause false positives; subtle jump cuts and short shots may be missed.', 'Sample rate is not source frame rate. Cut timestamps have up to one sampling interval of uncertainty.', 'Quantized palette describes dominant sampled pixels, not an exact color grade. Exact fonts, software, layers and effect settings are unknown.'];
    opts.progress('Measuring audio');
    if (file.size <= 20e6 && video.duration <= 600) {
        let ac: AudioContext | undefined;
        try {
            ac = new AudioContext();
            const buffer = await ac.decodeAudioData(await file.arrayBuffer());
            let total = 0, n = 0, peak = 0, quiet = 0;
            const windows: NonNullable<ReverseReport['audio']>['windows'] = [];
            for (let t = start; t < end; t += .1) {
                let sum = 0, wn = 0;
                for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                    const pcm = buffer.getChannelData(ch);
                    for (let i = Math.floor(t * buffer.sampleRate); i < Math.min(pcm.length, Math.floor((t + .1) * buffer.sampleRate), Math.floor(end * buffer.sampleRate)); i++) {
                        const v = pcm[i];
                        sum += v * v;
                        peak = Math.max(peak, Math.abs(v));
                        wn++;
                    }
                }
                if (!wn)
                    continue;
                total += sum;
                n += wn;
                const level = db(Math.sqrt(sum / wn));
                if (level < -45)
                    quiet++;
                windows.push({ t, db: level });
            }
            if (n)
                audio = { rmsDb: db(Math.sqrt(total / n)), peakDb: db(peak), silencePercent: quiet / windows.length * 100, windows };
            else
                limits.push('No decoded audio samples overlap this segment.');
        }
        catch {
            limits.push('Audio decoding unavailable for this file/browser; audio metrics remain unknown.');
        }
        finally {
            await ac?.close();
        }
    }
    else
        limits.push('Audio decode skipped: use a file ≤20 MB and ≤10 minutes to bound browser memory.');
    if (opts.signal?.aborted)
        throw new Error('Analysis cancelled.');
    const report: ReverseReport = { version: 1, id: crypto.randomUUID(), created: new Date().toISOString(), name, mode: 'local', duration: video.duration, start, end, width: video.videoWidth, height: video.videoHeight, sampleFps: fps, threshold: opts.threshold, frames, cuts: cutsFromFrames(frames, opts.threshold, fps), palette: [...bins].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]), audio, transcript: '', transcriptSource: 'Unavailable', findings: [{ category: 'Frame sampling', at: start, label: 'Seen', detail: `${frames.length} frames sampled at ${fps} fps across ${start.toFixed(2)}–${end.toFixed(2)}s; ${video.videoWidth}×${video.videoHeight} decoded dimensions.`, method: 'Browser video decoder + Canvas pixel measurements', review: 'pending' }, { category: 'Original project', at: start, label: 'Unknown', detail: 'Source frame rate, exact font family, editing software, layers and effect settings cannot be recovered from this sampling process.', method: 'Unavailable source metadata', review: 'pending' }], style: '', limits };
    report.style = styleBrief(report);
    return { report, thumbs };
}
finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
} }
export async function calibrationVideo() { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d')!; const stream = c.captureStream(25); const mime = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)); if (!mime)
    throw new Error('Recording unavailable; upload a small known video instead.'); const rec = new MediaRecorder(stream, { mimeType: mime }); const chunks: BlobPart[] = []; rec.ondataavailable = e => { if (e.data.size)
    chunks.push(e.data); }; const blob = new Promise<Blob>((resolve, reject) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); rec.onerror = () => reject(new Error('Calibration recorder failed.')); }); rec.start(); const start = performance.now(); await new Promise<void>(resolve => { function frame() { const t = (performance.now() - start) / 1000; x.fillStyle = ['#ef4444', '#22c55e', '#3b82f6'][Math.min(2, Math.floor(t / 2))]; x.fillRect(0, 0, 320, 180); if (t < 6)
    requestAnimationFrame(frame);
else
    resolve(); } frame(); }); rec.stop(); stream.getTracks().forEach(t => t.stop()); return blob; }
