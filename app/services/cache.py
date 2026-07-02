import time
from pathlib import Path
from app.config import CACHE_DIR, WAVEFORM_DIR, PREVIEW_DIR, TMP_DIR
from app.services.settings import get_settings

CACHE_FOLDERS = [PREVIEW_DIR, WAVEFORM_DIR, TMP_DIR]

def cleanup_cache(max_age_days=None):
    settings = get_settings()
    if max_age_days is None:
        max_age_days = settings.get("cache_cleanup_days", 1.0)

    try:
        max_age_days = float(max_age_days)
    except Exception:
        max_age_days = 1.0

    max_age_days = max(0.01, max_age_days)
    cutoff = time.time() - (max_age_days * 86400)

    deleted_files = 0
    deleted_bytes = 0
    errors = []

    for folder in CACHE_FOLDERS:
        folder.mkdir(parents=True, exist_ok=True)

        for path in folder.rglob("*"):
            try:
                if not path.is_file():
                    continue

                if path.stat().st_mtime >= cutoff:
                    continue

                size = path.stat().st_size
                path.unlink()
                deleted_files += 1
                deleted_bytes += size
            except Exception as exc:
                errors.append({"path": str(path), "error": str(exc)})

        # Remove empty subfolders under each cache folder, newest/deepest first.
        try:
            for subdir in sorted([p for p in folder.rglob("*") if p.is_dir()], key=lambda p: len(p.parts), reverse=True):
                try:
                    subdir.rmdir()
                except OSError:
                    pass
        except Exception as exc:
            errors.append({"path": str(folder), "error": str(exc)})

    return {
        "cache_cleanup_days": max_age_days,
        "deleted_files": deleted_files,
        "deleted_bytes": deleted_bytes,
        "errors": errors[:25],
    }
