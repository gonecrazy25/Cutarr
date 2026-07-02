from pathlib import Path
import os

MEDIA_DIR = Path(os.environ.get("CUTARR_MEDIA_DIR", "/media")).resolve()
OUTPUT_DIR = Path(os.environ.get("CUTARR_OUTPUT_DIR", str(MEDIA_DIR / "Cutarr_Output"))).resolve()
CACHE_DIR = Path(os.environ.get("CUTARR_CACHE_DIR", "/cache")).resolve()
CONFIG_DIR = Path(os.environ.get("CUTARR_CONFIG_DIR", "/config")).resolve()

WAVEFORM_DIR = CACHE_DIR / "waveforms"
PREVIEW_DIR = CACHE_DIR / "previews"
TMP_DIR = CACHE_DIR / "tmp"

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".ts", ".mpg", ".mpeg", ".vob"}
MAX_REGION_COUNT = 64

for folder in [MEDIA_DIR, OUTPUT_DIR, CACHE_DIR, CONFIG_DIR, WAVEFORM_DIR, PREVIEW_DIR, TMP_DIR]:
    folder.mkdir(parents=True, exist_ok=True)
