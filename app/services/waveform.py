import hashlib
import json
import subprocess
from pathlib import Path
from app.config import WAVEFORM_DIR
from app.services.media import ffprobe_duration

def cache_key(path: Path) -> str:
    stat = path.stat()
    raw = f"{path.resolve()}::{stat.st_size}::{int(stat.st_mtime)}::v2"
    return hashlib.sha256(raw.encode()).hexdigest()

def waveform_cache_path(path: Path) -> Path:
    return WAVEFORM_DIR / f"{cache_key(path)}.json"

def generate_waveform(path: Path, samples: int | None = None) -> dict:
    """
    Generate cached, browser-friendly signed waveform samples.

    Previous builds cached only positive peak values. WaveSurfer expects
    signed channel data for a real waveform, so v0.16 stores min/max pairs.
    """
    cache_file = waveform_cache_path(path)
    duration = ffprobe_duration(path)

    if cache_file.exists():
        with cache_file.open("r", encoding="utf-8") as f:
            return json.load(f)

    # More samples = better zoom. Cap keeps memory sane for very long recordings.
    if samples is None:
        samples = int(max(6000, min(220000, duration * 25)))

    cmd = [
        "ffmpeg", "-v", "error",
        "-i", str(path),
        "-vn", "-ac", "1", "-ar", "8000",
        "-f", "s16le", "pipe:1",
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw = proc.stdout
    channel_data = []
    envelope = []

    if raw:
        import array, sys
        pcm = array.array("h")
        pcm.frombytes(raw)
        if sys.byteorder != "little":
            pcm.byteswap()

        total = len(pcm)
        bucket = max(1, total // samples)

        for i in range(0, total, bucket):
            segment = pcm[i:i + bucket]
            if not segment:
                continue

            mn = min(segment) / 32768.0
            mx = max(segment) / 32768.0

            # Store signed min/max pairs. This gives WaveSurfer enough shape
            # to draw a real waveform instead of large positive blocks.
            channel_data.append(round(float(mx), 4))
            channel_data.append(round(float(mn), 4))

            envelope.append(round(float(max(abs(mn), abs(mx))), 4))

    data = {
        "version": 2,
        "duration": duration,
        "sample_rate": 8000,
        "samples_requested": samples,
        "channel_data": channel_data,
        "peaks": envelope,
        "count": len(channel_data),
    }

    with cache_file.open("w", encoding="utf-8") as f:
        json.dump(data, f)

    return data
