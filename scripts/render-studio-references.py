"""Render narrated Studio walkthroughs from the example fixtures and poster files."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import wave

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H, FPS = 640, 360, 15
FONT_DIR = Path(os.environ["WINDIR"]) / "Fonts"
TITLE = ImageFont.truetype(str(FONT_DIR / "georgiab.ttf"), 37)
HEAD = ImageFont.truetype(str(FONT_DIR / "georgiab.ttf"), 21)
TEXT = ImageFont.truetype(str(FONT_DIR / "segoeui.ttf"), 13)
CAP = ImageFont.truetype(str(FONT_DIR / "segoeuib.ttf"), 17)
SMALL = ImageFont.truetype(str(FONT_DIR / "consolab.ttf"), 11)
INK, PAPER, PLUM, PEACH = "#332335", "#faf0e6", "#50334b", "#e4b195"


def draw_frame(item, photo, t, total, voice_length):
    scale = 1 + 0.06 * t / total
    scene = ImageOps.fit(photo, (round(W * scale), round(H * scale)), centering=(0.59, 0.45))
    frame = ImageOps.fit(scene, (W, H)).convert("RGB")
    draw = ImageDraw.Draw(frame, "RGBA")
    if t < 1.35:
        draw.rectangle((0, 0, W, H), fill=(35, 17, 37, 115))
        draw.text((34, 46), "SECOND SPRING  /  CONTENT STUDIO", font=SMALL, fill=PEACH)
        draw.multiline_text((34, 102), "\n".join(textwrap.wrap(item["title"], width=20)),
                            font=TITLE, fill=PAPER, spacing=5)
    else:
        width = 298
        left_photo = ImageOps.fit(scene, (W - width, H), centering=(0.64, 0.43))
        frame.paste(left_photo, (0, 0))
        draw.rectangle((W - width, 0, W, H), fill=PAPER)
        x = W - width + 19
        draw.text((x, 28), item["artifact"], font=SMALL, fill=PLUM)
        draw.multiline_text((x, 48), "\n".join(textwrap.wrap(item["title"], width=24)),
                            font=HEAD, fill=INK, spacing=2)
        sample_lines = [part for line in item["sample"].splitlines()
                        for part in textwrap.wrap(line, width=36)][:7]
        draw.rounded_rectangle((x - 3, 103, W - 17, 230), 9, fill="#fffaf5", outline="#e0cbd0")
        draw.multiline_text((x + 6, 113), "\n".join(sample_lines), font=TEXT, fill=INK, spacing=2)
        beat = min(2, int((t - 1.35) * 3 / max(1, total - 1.35)))
        draw.rounded_rectangle((x - 3, 240, W - 17, 274), 8, fill=PLUM)
        draw.text((x + 6, 249), item["beats"][beat], font=TEXT, fill=PAPER)
    if 0.45 <= t < voice_length + 0.45:
        words = item["narration"].split()
        index = min((len(words) - 1) // 7, int((t - 0.45) * len(words) / voice_length) // 7)
        line = " ".join(words[index * 7:(index + 1) * 7])
        draw.rounded_rectangle((30, 291, W - 30, 331), 10, fill=(32, 21, 35, 240))
        draw.text((W // 2, 311), line, font=CAP, fill=PAPER, anchor="mm")
    draw.rectangle((0, H - 3, round(W * t / total), H), fill=PEACH)
    return frame


def render_all(ffmpeg, root):
    examples = json.loads((root / "src/app/content-studio/reference-examples.json").read_text(encoding="utf-8"))
    output = root / "output" / "studio-references"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as directory:
        tmp = Path(directory)
        for item in examples:
            (tmp / (item["id"] + ".txt")).write_text(item["narration"], encoding="utf-8")
        command = ("$ErrorActionPreference='Stop'; $v=New-Object -ComObject SAPI.SpVoice; "
                   "foreach($f in Get-ChildItem -Filter *.txt){ $s=New-Object -ComObject SAPI.SpFileStream; "
                   "$s.Open([IO.Path]::ChangeExtension($f.FullName,'.wav'),3,$false); "
                   "$v.AudioOutputStream=$s; $null=$v.Speak([IO.File]::ReadAllText($f.FullName)); $s.Close()}")
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], cwd=tmp, check=True)
        for item in examples:
            voice = tmp / (item["id"] + ".wav")
            with wave.open(str(voice), "rb") as audio:
                voice_length = audio.getnframes() / audio.getframerate()
            frames = math.ceil((voice_length + 1.5) * FPS)
            total = frames / FPS
            photo = Image.open(root / "public/studio/reference" / (item["image"] + ".jpg")).convert("RGB")
            destination = output / (item["id"] + ".mp4")
            cmd = [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                   "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", str(voice),
                   "-af", "adelay=450,apad", "-t", f"{total:.5f}",
                   "-c:v", "libx264", "-preset", "fast", "-crf", "31", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", str(destination)]
            with subprocess.Popen(cmd, stdin=subprocess.PIPE) as process:
                for i in range(frames):
                    process.stdin.write(draw_frame(item, photo, i / FPS, total, voice_length).tobytes())
                process.stdin.close()
                if process.wait() != 0:
                    raise RuntimeError(f"Could not render {item['id']}.")
            print(item["id"], round(total, 2), destination.stat().st_size)


if __name__ == "__main__":
    render_all(sys.argv[1], Path(__file__).resolve().parent.parent)
