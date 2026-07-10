import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, Any
from app.config import OUTPUT_DIR

jobs: Dict[str, Dict[str, Any]] = {}
lock = threading.Lock()

def sanitize_name(value: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in " ._-" else "_" for c in value).strip()
    return cleaned or "Show"

def make_output_path(show: str, season: int, episode: int, ext=".mkv", suffix: str = "", label: str = "Episode") -> Path:
    show_clean = sanitize_name(show)
    suffix_clean = sanitize_name(suffix) if suffix else ""
    label_clean = sanitize_name(label) if label and label != "Episode" else ""

    folder = OUTPUT_DIR / show_clean / f"Season {season:02d}"
    folder.mkdir(parents=True, exist_ok=True)

    extras = []
    if suffix_clean:
        extras.append(suffix_clean)
    if label_clean:
        extras.append(label_clean)

    extra_text = f" - {' - '.join(extras)}" if extras else ""
    filename = f"{show_clean} - S{season:02d}E{episode:02d}{extra_text}{ext}"
    candidate = folder / filename
    counter = 2

    while candidate.exists():
        candidate = folder / f"{show_clean} - S{season:02d}E{episode:02d}{extra_text} ({counter}){ext}"
        counter += 1

    return candidate

def get_job(job_id):
    with lock:
        return jobs.get(job_id, {"status": "unknown"})

def create_split_job(input_path: Path, regions, show: str, season: int, start_episode: int, suffix: str = ""):
    job_id = str(uuid.uuid4())

    with lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "Queued",
            "outputs": [],
            "error": None,
            "created_at": time.time(),
        }

    thread = threading.Thread(
        target=_run_split_job,
        args=(job_id, input_path, regions, show, season, start_episode, suffix),
        daemon=True,
    )
    thread.start()
    return job_id

def _set(job_id, **kwargs):
    with lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)

def _run_split_job(job_id, input_path: Path, regions, show: str, season: int, start_episode: int, suffix: str = ""):
    try:
        total_duration = sum(max(0, float(r["end"]) - float(r["start"])) for r in regions)
        completed_duration = 0.0
        outputs = []

        _set(job_id, status="running", message="Starting split job")

        for idx, region in enumerate(regions):
            start = float(region["start"])
            end = float(region["end"])

            if end <= start:
                continue

            ep = start_episode + idx
            output = make_output_path(show, int(season), ep, ".mkv", suffix=suffix, label=region.get("label", "Episode"))
            duration = end - start

            cmd = [
                "ffmpeg", "-hide_banner", "-y",
                "-ss", str(start),
                "-i", str(input_path),
                "-t", str(duration),
                "-map", "0",
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                "-progress", "pipe:1",
                "-nostats",
                str(output),
            ]

            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

            while True:
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                if not line:
                    continue

                line = line.strip()
                if line.startswith("out_time_ms="):
                    try:
                        out_ms = int(line.split("=", 1)[1])
                        current = out_ms / 1_000_000
                        overall = ((completed_duration + min(current, duration)) / max(total_duration, 1)) * 100
                        _set(job_id, progress=round(min(overall, 100), 1), message=f"Splitting episode {idx + 1} of {len(regions)}")
                    except Exception:
                        pass

            stderr = proc.stderr.read()
            rc = proc.wait()

            if rc != 0:
                raise RuntimeError(stderr[-2000:] or "ffmpeg failed")

            completed_duration += duration
            outputs.append(str(output))
            _set(job_id, outputs=outputs)

        _set(job_id, status="finished", progress=100, message="Finished", outputs=outputs)

    except Exception as exc:
        _set(job_id, status="failed", error=str(exc), message="Failed")
