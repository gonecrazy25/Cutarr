import hashlib
import subprocess
from pathlib import Path
from app.config import PREVIEW_DIR

def preview_key(path: Path, mode: str = "audio") -> str:
    stat = path.stat()
    raw = f"{path.resolve()}::{stat.st_size}::{int(stat.st_mtime)}::{mode}"
    return hashlib.sha256(raw.encode()).hexdigest()

def preview_path(path: Path, with_audio: bool = True) -> Path:
    mode = "audio" if with_audio else "noaudio"
    return PREVIEW_DIR / f"{preview_key(path, mode)}.mp4"

def _run_preview_command(cmd, tmp: Path):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(proc.stderr[-2000:] or "Preview generation failed")

def _finalize_preview(tmp: Path, out: Path) -> Path:
    if not tmp.exists() or tmp.stat().st_size <= 0:
        raise RuntimeError("Preview generation produced an empty file")
    tmp.rename(out)
    return out

def ensure_preview(path: Path, with_audio: bool = True) -> Path:
    """
    Generates an HTML5 browser-friendly preview.

    with_audio=True:
      Browser-friendly MP4 with AAC audio.

    with_audio=False:
      Fast video-only preview. First tries a video stream remux/copy,
      which is much faster for H.264/H.265/AV1-style MP4-compatible video.
      If the copy fails, it falls back to a video-only transcode.
    """
    out = preview_path(path, with_audio=with_audio)
    if out.exists() and out.stat().st_size > 0:
        return out

    tmp = out.with_suffix(".tmp.mp4")
    if tmp.exists():
        tmp.unlink()

    if not with_audio:
        # Fast path: do not convert audio, and try to copy the video stream.
        # This is dramatically faster when the source video stream is already
        # MP4-compatible.
        copy_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-i", str(path),
            "-map", "0:v:0",
            "-c:v", "copy",
            "-an",
            "-movflags", "+faststart",
            str(tmp),
        ]

        copy_proc = subprocess.run(copy_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if copy_proc.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            return _finalize_preview(tmp, out)

        if tmp.exists():
            tmp.unlink()

        # Fallback: still skip audio, but transcode video for browser playback.
        transcode_noaudio_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-i", str(path),
            "-map", "0:v:0",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "30",
            "-vf", "scale='min(1280,iw)':-2",
            "-an",
            "-movflags", "+faststart",
            str(tmp),
        ]
        _run_preview_command(transcode_noaudio_cmd, tmp)
        return _finalize_preview(tmp, out)

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-i", str(path),
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "28",
        "-vf", "scale='min(1280,iw)':-2",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",
        "-movflags", "+faststart",
        str(tmp),
    ]

    _run_preview_command(cmd, tmp)
    return _finalize_preview(tmp, out)
