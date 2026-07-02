import json
from pathlib import Path
from app.config import CONFIG_DIR

SETTINGS_PATH = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "cache_cleanup_days": 1.0,
    "default_split_titles_credits": True,
    "default_fast_preview_no_audio": True,
}

def _coerce_settings(data):
    settings = dict(DEFAULT_SETTINGS)

    if isinstance(data, dict):
        if "cache_cleanup_days" in data:
            try:
                days = float(data["cache_cleanup_days"])
            except Exception:
                days = DEFAULT_SETTINGS["cache_cleanup_days"]

            # Minimum is 0.01 days, about 14 minutes. This avoids accidental
            # delete-everything behavior from zero or negative values.
            settings["cache_cleanup_days"] = max(0.01, days)

        if "default_split_titles_credits" in data:
            settings["default_split_titles_credits"] = bool(data["default_split_titles_credits"])

        if "default_fast_preview_no_audio" in data:
            settings["default_fast_preview_no_audio"] = bool(data["default_fast_preview_no_audio"])

    return settings

def ensure_settings_file():
    """
    Create /config/settings.json on first run if it does not already exist.
    """
    if SETTINGS_PATH.exists():
        return

    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(DEFAULT_SETTINGS, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)

def get_settings():
    if not SETTINGS_PATH.exists():
        ensure_settings_file()

    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        # If the settings file is corrupt, keep Cutarr running using defaults.
        return dict(DEFAULT_SETTINGS)

    settings = _coerce_settings(data)

    # If an older settings file is missing newly added keys, write the upgraded
    # full settings file back to disk.
    if settings != data:
        save_settings(settings)

    return settings

def save_settings(data):
    settings = _coerce_settings(data)
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(settings, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)
    return settings
