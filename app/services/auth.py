import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from app.config import CONFIG_DIR

AUTH_PATH = CONFIG_DIR / "auth.json"
SESSION_COOKIE = "cutarr_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
PBKDF2_ITERATIONS = 260_000

def _default_auth_config():
    return {
        "session_secret": secrets.token_urlsafe(48),
        "admin_password": None,
    }

def _load_auth_config():
    if not AUTH_PATH.exists():
        config = _default_auth_config()
        _save_auth_config(config)
        return config

    try:
        config = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    except Exception:
        config = _default_auth_config()
        _save_auth_config(config)
        return config

    changed = False

    if not config.get("session_secret"):
        config["session_secret"] = secrets.token_urlsafe(48)
        changed = True

    if "admin_password" not in config:
        config["admin_password"] = None
        changed = True

    if changed:
        _save_auth_config(config)

    return config

def _save_auth_config(config):
    AUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = AUTH_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(config, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(AUTH_PATH)

def has_admin_password():
    config = _load_auth_config()
    return bool(config.get("admin_password"))

def _hash_password(password: str, salt: bytes = None):
    if salt is None:
        salt = secrets.token_bytes(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )

    return {
        "algorithm": "pbkdf2_sha256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(digest).decode("ascii"),
    }

def set_admin_password(password: str):
    password = password or ""
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters long.")

    config = _load_auth_config()
    config["admin_password"] = _hash_password(password)
    _save_auth_config(config)

def verify_admin_password(password: str):
    config = _load_auth_config()
    stored = config.get("admin_password")

    if not stored:
        return False

    try:
        salt = base64.b64decode(stored["salt"])
        expected = base64.b64decode(stored["hash"])
        iterations = int(stored.get("iterations", PBKDF2_ITERATIONS))
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        (password or "").encode("utf-8"),
        salt,
        iterations,
    )

    return hmac.compare_digest(actual, expected)

def _session_signature(secret: str, payload: str):
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()

def make_session_token():
    config = _load_auth_config()
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    payload = f"admin:{timestamp}:{nonce}"
    signature = _session_signature(config["session_secret"], payload)
    return f"{payload}:{signature}"

def verify_session_token(token: str):
    if not token or not has_admin_password():
        return False

    config = _load_auth_config()

    try:
        user, timestamp, nonce, signature = token.split(":", 3)
        if user != "admin":
            return False

        age = time.time() - int(timestamp)
        if age < 0 or age > SESSION_MAX_AGE_SECONDS:
            return False

        payload = f"{user}:{timestamp}:{nonce}"
        expected = _session_signature(config["session_secret"], payload)
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False

def is_authenticated(request):
    return verify_session_token(request.cookies.get(SESSION_COOKIE))

def set_session_cookie(response):
    response.set_cookie(
        key=SESSION_COOKIE,
        value=make_session_token(),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
    )

def clear_session_cookie(response):
    response.delete_cookie(key=SESSION_COOKIE)
