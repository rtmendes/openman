"""Render the Second Spring motion-graphics draft. Requires Pillow, FFmpeg and Windows Speech."""
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 432, 768, 24
CREAM, INK, TEAL = "#fff2db", "#17242b", "#2f8276"
BEATS = (
    (0, 3, "The thermostat blinked first."),
    (3, 12, "Two a.m. A hot flash walked in and turned my bedroom into a sauna. So I opened negotiations."),
    (12, 22, "My terms: cool water. Fan on low. One slow breath. It tried to stall. I did not blink."),
    (22, 30, "Hot flash, meet your match. Who else is negotiating with their thermostat tonight? Tell me below."),
)
VO_LENGTHS = (2.05, 7.9, 8.1, 5.85)
FONTS = Path(os.environ["WINDIR"]) / "Fonts"
TITLE = ImageFont.truetype(str(FONTS / "georgiab.ttf"), 41)
LABEL = ImageFont.truetype(str(FONTS / "consolab.ttf"), 16)
CAPTION = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 25)
DIGITS = ImageFont.truetype(str(FONTS / "consolab.ttf"), 65)


def centered(draw, y, words, font, fill=CREAM):
    draw.text((W // 2, y), words, font=font, fill=fill, anchor="mt")


def thermostat(draw, x, y, degrees, scale=1):
    width, height = int(164 * scale), int(100 * scale)
    draw.rounded_rectangle((x, y, x + width, y + height), 19, fill=CREAM, outline=INK, width=3)
    draw.rounded_rectangle((x + 9, y + 10, x + width - 9, y + height - 10), 12, fill="#cde1a5")
    draw.text((x + width // 2, y + height // 2), degrees, font=DIGITS if scale == 1 else TITLE,
              fill=INK, anchor="mm")


def woman(draw, x, y, t, hot=False):
    dy = round(3 * math.sin(t * 4))
    def xy(a, b, c, d):
        return x + a, y + b + dy, x + c, y + d + dy
    draw.ellipse(xy(-71, -92, 71, 72), fill="#323437")
    draw.rounded_rectangle(xy(-103, 47, 103, 185), 49, fill="#e9cfa7", outline=INK, width=3)
    draw.polygon([(x - 33, y + 55 + dy), (x + 29, y + 55 + dy), (x, y + 105 + dy)], fill="#a75641")
    draw.rounded_rectangle(xy(-21, 17, 21, 69), 12, fill="#b97258")
    draw.ellipse(xy(-52, -66, 55, 54), fill="#bc785d")
    draw.pieslice(xy(-60, -83, 61, 29), 180, 353, fill="#47363a")
    draw.arc(xy(-61, -80, 51, 25), 202, 323, fill="#988382", width=4)
    draw.arc(xy(-46, -76, 52, 12), 208, 300, fill="#988382", width=3)
    for eye in (-23, 26):
        draw.line((x + eye - 8, y - 11 + dy, x + eye + 7, y - 15 + dy), fill=INK, width=3)
        if t % 3.4 < 0.12:
            draw.line((x + eye - 5, y - 2 + dy, x + eye + 5, y - 2 + dy), fill=INK, width=2)
        else:
            draw.ellipse(xy(eye - 3, -5, eye + 3, 3), fill=INK)
    draw.arc(xy(-16, 13, 22, 34), 4, 135, fill=INK, width=3)
    if hot:
        for k in range(3):
            yy = y - 90 + ((t * 23 + k * 21) % 65)
            draw.arc((x + 62, yy, x + 91, yy + 28), 250, 85, fill="#fcba8a", width=3)


def frame(t):
    index = max(i for i, (start, _, _) in enumerate(BEATS) if t >= start)
    start, _, speech = BEATS[index]
    local = t - start
    image = Image.new("RGB", (W, H), ("#26383b", "#344853", "#32484a", "#37625b")[index])
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((17, 17, W - 18, H - 18), 26, outline="#eac399", width=2)
    d.text((37, 40), "SECOND SPRING", fill=CREAM, font=LABEL)
    d.text((395, 40), "02:00 AM", fill=CREAM, font=LABEL, anchor="rt")
    centered(d, 90, ("HOSTAGE TALKS", "THE HOT FLASH", "MY TERMS", "CEASEFIRE")[index], TITLE)
    d.ellipse((66, 192, 365, 510), fill=("#3d5354", "#505f65", "#496762", "#507a66")[index])
    if index == 0:
        thermostat(d, 134, 216, "74°" if local < 0.42 else "68°")
        woman(d, 218, 422, t)
        d.rounded_rectangle((258, 501, 303, 540), 8, fill=TEAL, outline=INK, width=3)
        d.arc((292, 503, 320, 530), 270, 90, fill=INK, width=4)
    elif index == 1:
        d.ellipse((295, 215, 345, 265), fill="#f2c592")
        d.rounded_rectangle((72, 444, 362, 557), 18, fill="#d6a07e")
        woman(d, 211, 392, t, hot=True)
        lift = round(24 * abs(math.sin(local * 1.4)))
        d.polygon([(67, 558), (67, 494 - lift), (188, 472), (365, 511), (365, 558)], fill="#536771")
    elif index == 2:
        woman(d, 212, 402, t, hot=True)
        d.rounded_rectangle((35, 477, 126, 558), 6, fill="#ecc282")
        d.text((47, 490), "TERMS", font=LABEL, fill=INK)
        for y in (520, 532, 544):
            d.line((46, y, 106, y), fill="#9e635a", width=2)
        d.ellipse((300, 460, 390, 550), fill="#b6d6bc", outline=INK, width=4)
        for blade in range(3):
            angle = t * 9 + blade * math.tau / 3
            d.line((345, 505, 345 + math.cos(angle) * 32, 505 + math.sin(angle) * 32), fill=TEAL, width=12)
        d.ellipse((336, 496, 354, 514), fill=INK)
    elif local < 5.95:
        thermostat(d, 253, 233, "68°", 0.72)
        woman(d, 191, 414, t)
    else:
        centered(d, 291, "Second Spring", TITLE)
        centered(d, 355, "WHO ELSE IS NEGOTIATING?", LABEL)
    if local < VO_LENGTHS[index] + 0.12:
        words = speech.split()
        groups = [words[i:i + 5] for i in range(0, len(words), 5)]
        segment = min(len(groups) - 1, int(local * len(words) / VO_LENGTHS[index]) // 5)
        group = groups[segment]
        first = " ".join(group[:3])
        second = " ".join(group[3:])
        d.rounded_rectangle((35, 599, 397, 687), 16, fill=INK)
        centered(d, 614 if second else 630, first, CAPTION)
        if second:
            centered(d, 646, second, CAPTION)
    d.line((38, 724, 394, 724), fill="#bf9f89", width=2)
    d.line((38, 724, 38 + 356 * t / 30, 724), fill=CREAM, width=3)
    return image


def render(ffmpeg, output):
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        tmp = Path(directory)
        for index, (_, _, speech) in enumerate(BEATS):
            (tmp / f"{index}.txt").write_text(speech, encoding="utf-8")
        command = ("$ErrorActionPreference='Stop'; $v=New-Object -ComObject SAPI.SpVoice; "
                   "foreach($i in 0..3){ $s=New-Object -ComObject SAPI.SpFileStream; "
                   "$s.Open((Join-Path (Get-Location) \"$i.wav\"),3,$false); "
                   "$v.AudioOutputStream=$s; "
                   "$null=$v.Speak([IO.File]::ReadAllText((Join-Path (Get-Location) \"$i.txt\")));"
                   "$s.Close()}")
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], cwd=tmp, check=True)
        import wave
        filters = []
        for i, (start, _, _) in enumerate(BEATS):
            with wave.open(str(tmp / f"{i}.wav"), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
            tempo = max(0.5, min(2, duration / VO_LENGTHS[i]))
            filters.append(f"[{i+1}:a]atempo={tempo:.5f},adelay={int(start*1000)}[a{i}]")
        filters.append("[a0][a1][a2][a3]amix=inputs=4:normalize=0,apad[audio]")
        args = [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
        for i in range(4):
            args += ["-i", str(tmp / f"{i}.wav")]
        args += ["-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[audio]",
                 "-t", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "24",
                 "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "56k", "-movflags",
                 "+faststart", str(output)]
        with subprocess.Popen(args, stdin=subprocess.PIPE) as process:
            for i in range(30 * FPS):
                process.stdin.write(frame(i / FPS).tobytes())
            process.stdin.close()
            if process.wait():
                raise RuntimeError("FFmpeg could not encode the draft.")


if __name__ == "__main__":
    destination = Path(sys.argv[2]).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    render(sys.argv[1], destination)
