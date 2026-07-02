from pathlib import Path
import subprocess
from app.config import MEDIA_DIR, VIDEO_EXTENSIONS
from app.services.security import safe_join

def list_directory(relative_dir: str = ""):
    folder = safe_join(MEDIA_DIR, relative_dir)
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(relative_dir)

    folders = []
    files = []

    for item in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        rel = item.relative_to(MEDIA_DIR).as_posix()

        if item.is_dir():
            folders.append({"name": item.name, "path": rel})
        elif item.is_file() and item.suffix.lower() in VIDEO_EXTENSIONS:
            files.append({"name": item.name, "path": rel, "size": item.stat().st_size})

    parent = None
    if folder.resolve() != MEDIA_DIR.resolve():
        parent = folder.parent.relative_to(MEDIA_DIR).as_posix()
        if parent == ".":
            parent = ""

    return {
        "cwd": folder.relative_to(MEDIA_DIR).as_posix() if folder != MEDIA_DIR else "",
        "parent": parent,
        "folders": folders,
        "files": files,
    }

def resolve_media_path(relative_path: str) -> Path:
    path = safe_join(MEDIA_DIR, relative_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(relative_path)
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Unsupported file type")
    return path

def ffprobe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        return max(0.0, float(result.stdout.strip()))
    except Exception:
        return 0.0


def ffprobe_fps(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,r_frame_rate",
        "-of", "default=noprint_wrappers=1",
        str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def parse_rate(value: str) -> float:
        try:
            if "/" in value:
                n, d = value.split("/", 1)
                n = float(n)
                d = float(d)
                return n / d if d else 0.0
            return float(value)
        except Exception:
            return 0.0

    fps = 0.0
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        _, value = line.split("=", 1)
        fps = parse_rate(value)
        if fps > 0:
            break

    return fps if fps > 0 else 29.97



def ffprobe_dimensions(path: Path):
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    line = (result.stdout or "").strip().splitlines()
    if not line:
        return {"width": None, "height": None}

    try:
        width, height = line[0].split("x", 1)
        return {"width": int(width), "height": int(height)}
    except Exception:
        return {"width": None, "height": None}



def ffprobe_video_codec(path: Path) -> str:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    codec = (result.stdout or "").strip().splitlines()
    raw = codec[0].strip().lower() if codec else ""

    codec_map = {
        "h264": "H.264",
        "hevc": "H.265 / HEVC",
        "h265": "H.265 / HEVC",
        "mpeg2video": "MPEG-2",
        "mpeg4": "MPEG-4",
        "av1": "AV1",
        "vp9": "VP9",
        "vp8": "VP8",
        "theora": "Theora",
    }

    return codec_map.get(raw, raw.upper() if raw else "--")
