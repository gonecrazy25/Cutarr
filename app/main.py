from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from typing import List, Optional
import shutil

from app.config import MEDIA_DIR, OUTPUT_DIR, MAX_REGION_COUNT
from app.services.media import list_directory, resolve_media_path, ffprobe_duration, ffprobe_fps, ffprobe_dimensions, ffprobe_video_codec
from app.services.waveform import generate_waveform
from app.services.preview import ensure_preview
from app.services.detection import detect_silence, detect_black, combined_detect, boundaries_to_regions
from app.services.jobs import create_split_job, get_job
from app.services.settings import get_settings, save_settings, ensure_settings_file
from app.services.cache import cleanup_cache
from app.services.auth import has_admin_password, verify_admin_password, set_admin_password, is_authenticated, set_session_cookie, clear_session_cookie

app = FastAPI(title="Cutarr")
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def startup_cache_cleanup():
    try:
        ensure_settings_file()
        cleanup_cache()
    except Exception:
        # Settings/cache cleanup should never stop Cutarr from starting.
        pass


AUTH_ALLOWED_PATHS = {
    "/login",
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/favicon.ico",
}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    if path.startswith("/static/") or path in AUTH_ALLOWED_PATHS:
        return await call_next(request)

    if is_authenticated(request):
        return await call_next(request)

    if path.startswith("/api/"):
        return JSONResponse(
            status_code=401,
            content={
                "detail": "Authentication required",
                "needs_setup": not has_admin_password(),
            },
        )

    return RedirectResponse(url="/login")


class Region(BaseModel):
    start: float
    end: float
    label: Optional[str] = None

class SplitRequest(BaseModel):
    path: str
    regions: List[Region] = Field(default_factory=list)
    show: str = "Show"
    season: int = 1
    suffix: str = ""
    start_episode: int = 1

class DetectionRequest(BaseModel):
    path: str
    mode: str = "combined"
    expected_episodes: int = 2
    noise_db: int = -32
    silence_duration: float = 0.8
    split_titles_credits: bool = False
    intro_titles_hint_time: Optional[float] = None
    credits_split_hint_time: Optional[float] = None


class PrepareMediaRequest(BaseModel):
    path: str
    audio: bool = True
    prepare_preview: bool = True
    prepare_waveform: bool = True


class SettingsRequest(BaseModel):
    cache_cleanup_days: float = 1.0
    default_split_titles_credits: bool = True
    default_fast_preview_no_audio: bool = False


class AuthPasswordRequest(BaseModel):
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str



@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/api/auth/status")
def auth_status(request: Request):
    return {
        "needs_setup": not has_admin_password(),
        "authenticated": is_authenticated(request),
        "username": "admin",
    }

@app.post("/api/auth/setup")
def auth_setup(req: AuthPasswordRequest, response: Response):
    try:
        if has_admin_password():
            raise HTTPException(status_code=400, detail="Admin password is already set.")

        set_admin_password(req.password)
        set_session_cookie(response)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/auth/login")
def auth_login(req: AuthPasswordRequest, response: Response):
    if not has_admin_password():
        raise HTTPException(status_code=400, detail="Admin password has not been set yet.")

    if not verify_admin_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid password.")

    set_session_cookie(response)
    return {"ok": True}

@app.post("/api/auth/logout")
def auth_logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}

@app.post("/api/auth/change-password")
def auth_change_password(req: ChangePasswordRequest, response: Response):
    try:
        if not has_admin_password():
            set_admin_password(req.new_password)
            set_session_cookie(response)
            return {"ok": True}

        if not verify_admin_password(req.current_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")

        set_admin_password(req.new_password)
        set_session_cookie(response)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/browse")
def api_browse(dir: str = ""):
    try:
        return list_directory(dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/storage")
def api_storage():
    try:
        usage = shutil.disk_usage(MEDIA_DIR)
        return {
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "percent_used": round((usage.used / usage.total) * 100, 1) if usage.total else 0,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/settings")
def api_settings():
    return get_settings()

@app.post("/api/settings")
def api_save_settings(req: SettingsRequest):
    data = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    settings = save_settings(data)
    result = cleanup_cache(settings.get("cache_cleanup_days", 1.0))
    return {"settings": settings, "cleanup": result}

@app.post("/api/cache/cleanup")
def api_cache_cleanup():
    return cleanup_cache()

@app.get("/api/info")
def api_info(path: str):
    try:
        media = resolve_media_path(path)
        dims = ffprobe_dimensions(media)
        return {
            "path": path,
            "duration": ffprobe_duration(media),
            "fps": ffprobe_fps(media),
            "name": media.name,
            "video_codec": ffprobe_video_codec(media),
            "width": dims.get("width"),
            "height": dims.get("height"),
            "size_bytes": media.stat().st_size,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.get("/media/{path:path}")
def serve_media(path: str):
    try:
        media = resolve_media_path(path)
        return FileResponse(media)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@app.get("/preview/{path:path}")
def serve_preview(path: str, audio: bool = True):
    try:
        media = resolve_media_path(path)
        preview = ensure_preview(media, with_audio=audio)
        return FileResponse(preview, media_type="video/mp4")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/waveform")
def api_waveform(path: str):
    try:
        media = resolve_media_path(path)
        return generate_waveform(media)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/prepare-media")
def api_prepare_media(req: PrepareMediaRequest):
    """
    Pre-build cached preview and waveform files for Folder Mode.
    This lets the browser page through loaded folder videos quickly after
    the folder load finishes.
    """
    try:
        media = resolve_media_path(req.path)
        dims = ffprobe_dimensions(media)

        preview_ready = False
        waveform_ready = False

        if req.prepare_preview:
            ensure_preview(media, with_audio=req.audio)
            preview_ready = True

        if req.prepare_waveform:
            generate_waveform(media)
            waveform_ready = True

        return {
            "path": req.path,
            "duration": ffprobe_duration(media),
            "fps": ffprobe_fps(media),
            "name": media.name,
            "video_codec": ffprobe_video_codec(media),
            "width": dims.get("width"),
            "height": dims.get("height"),
            "size_bytes": media.stat().st_size,
            "preview_ready": preview_ready,
            "waveform_ready": waveform_ready,
            "preview_audio": req.audio,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/detect")
def api_detect(req: DetectionRequest):
    try:
        media = resolve_media_path(req.path)
        duration = ffprobe_duration(media)

        if req.mode == "silence":
            silence = detect_silence(media, req.noise_db, req.silence_duration)
            boundaries = [x["time"] for x in silence]
            return {
                "duration": duration,
                "events": silence,
                "boundaries": boundaries,
                "regions": boundaries_to_regions(boundaries, duration),
                "message": f"Found {len(silence)} silence events.",
            }

        if req.mode == "black":
            black = detect_black(media)
            boundaries = [x["time"] for x in black]
            return {
                "duration": duration,
                "events": black,
                "boundaries": boundaries,
                "regions": boundaries_to_regions(boundaries, duration),
                "message": f"Found {len(black)} black-frame events.",
            }

        return combined_detect(
            media,
            req.expected_episodes,
            req.split_titles_credits,
            req.intro_titles_hint_time,
            req.credits_split_hint_time,
        )

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/split")
def api_split(req: SplitRequest):
    try:
        if not req.regions:
            raise ValueError("No regions supplied")
        if len(req.regions) > MAX_REGION_COUNT:
            raise ValueError("Too many regions")

        media = resolve_media_path(req.path)
        clean_regions = []

        for r in req.regions:
            if r.end > r.start:
                clean_regions.append({"start": r.start, "end": r.end, "label": r.label})

        job_id = create_split_job(media, clean_regions, req.show, req.season, req.start_episode, req.suffix)
        return {"job_id": job_id}

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    return get_job(job_id)


@app.get("/favicon.ico")
def favicon():
    return FileResponse("static/img/cutarr-icon.png", media_type="image/png")
