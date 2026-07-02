import re
import subprocess
from pathlib import Path
from app.services.media import ffprobe_duration

def detect_silence(path: Path, noise_db: int = -32, min_duration: float = 0.8):
    cmd = [
        "ffmpeg", "-hide_banner",
        "-i", str(path),
        "-af", f"silencedetect=noise={noise_db}dB:d={min_duration}",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    starts = []
    events = []

    for line in proc.stderr.splitlines():
        m_start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m_start:
            starts.append(float(m_start.group(1)))

        m_end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m_end:
            end = float(m_end.group(1))
            start = starts.pop(0) if starts else None
            events.append({"start": start, "end": end, "time": end, "type": "silence"})

    return events

def detect_black(path: Path, picture_threshold: float = 0.98, min_duration: float = 0.35):
    cmd = [
        "ffmpeg", "-hide_banner",
        "-i", str(path),
        "-vf", f"blackdetect=d={min_duration}:pic_th={picture_threshold}",
        "-an", "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    events = []

    for line in proc.stderr.splitlines():
        m = re.search(r"black_start:([0-9.]+)\s+black_end:([0-9.]+)", line)
        if m:
            start = float(m.group(1))
            end = float(m.group(2))
            events.append({"start": start, "end": end, "time": (start + end) / 2.0, "type": "black"})

    return events

def boundaries_to_regions(boundaries, duration, min_len=30):
    points = sorted(set([0.0] + [float(x) for x in boundaries if 0 < float(x) < duration] + [duration]))
    regions = []

    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        if end - start >= min_len:
            regions.append({"start": start, "end": end, "label": f"Episode {len(regions) + 1}"})

    return regions

def expected_boundary_times(duration: float, expected_episodes: int):
    expected_episodes = max(1, int(expected_episodes or 1))
    if expected_episodes <= 1 or duration <= 0:
        return []
    return [duration * i / expected_episodes for i in range(1, expected_episodes)]

def nearest_candidate(expected_time: float, candidates, window: float):
    near = [c for c in candidates if abs(c["time"] - expected_time) <= window]
    if not near:
        return None
    return min(near, key=lambda c: abs(c["time"] - expected_time))


def detect_scene_changes_near(path: Path, expected_time: float, window: float = 18.0, threshold: float = 0.30):
    """
    Scan a short window around expected_time for scene changes.

    Uses FFmpeg scene detection plus showinfo. Returned times are absolute
    video seconds. This is intentionally limited to a small window so Auto
    Detect stays reasonably fast.
    """
    expected_time = float(expected_time or 0)
    if expected_time <= 0:
        return []

    scan_start = max(0.0, expected_time - window)
    scan_len = max(2.0, window * 2.0)

    cmd = [
        "ffmpeg", "-hide_banner",
        "-ss", f"{scan_start:.3f}",
        "-t", f"{scan_len:.3f}",
        "-i", str(path),
        "-vf", f"select='gt(scene,{threshold})',showinfo",
        "-an", "-f", "null", "-",
    ]

    proc = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    events = []

    for line in proc.stderr.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            t = scan_start + float(m.group(1))
            events.append({"time": t, "type": "scene"})

    # Deduplicate near-identical frame reports.
    deduped = []
    for event in sorted(events, key=lambda x: x["time"]):
        if not deduped or abs(event["time"] - deduped[-1]["time"]) > 0.5:
            deduped.append(event)

    return deduped

def intro_hint_boundary(path: Path, duration: float, black_events, expected_time, window: float = 20.0):
    """
    Find the best first title cut near the user-provided intro-title time.
    Prefer black frames, then scene changes.
    """
    if expected_time is None:
        return None

    try:
        expected_time = float(expected_time)
    except Exception:
        return None

    if expected_time <= 1 or expected_time >= duration - 1:
        return None

    black_candidates = [
        {"time": e["time"], "type": "black"}
        for e in black_events
        if abs(float(e["time"]) - expected_time) <= window
    ]

    picked = nearest_candidate(expected_time, black_candidates, window)
    if picked:
        return picked

    scene_candidates = detect_scene_changes_near(path, expected_time, window=window)
    picked = nearest_candidate(expected_time, scene_candidates, window)
    if picked:
        return picked

    return None

def mark_intro_ending_region(regions, intro_boundary, tolerance: float = 2.0):
    """
    If the user supplied an Intro titles split time and Auto Detect created a
    region ending on/near that detected split point, label that region Titles.

    This covers cases like 00:00:05 -> 00:01:03, where black-frame detection
    skipped the first few seconds but the detected first region still clearly
    represents the title/intro section.
    """
    if not regions or intro_boundary is None:
        return regions

    try:
        intro_boundary = float(intro_boundary)
    except Exception:
        return regions

    marked = []
    did_mark = False

    for r in sorted(regions, key=lambda x: float(x["start"])):
        item = dict(r)
        start = float(item["start"])
        end = float(item["end"])

        # Prefer the earliest region whose end lands on or very near the intro
        # hint boundary. Allow a small amount of drift because FFmpeg black/scene
        # event times may not match the user-entered time exactly.
        if not did_mark and end >= intro_boundary - tolerance and end <= intro_boundary + tolerance:
            item["label"] = "Titles"
            did_mark = True

        marked.append(item)

    return marked

def mark_credits_starting_region(regions, credits_boundary, tolerance: float = 2.0):
    """
    If the user supplied a Credits split time and Auto Detect created a region
    starting on/near that detected split point, label that region Credits.
    """
    if not regions or credits_boundary is None:
        return regions

    try:
        credits_boundary = float(credits_boundary)
    except Exception:
        return regions

    marked = []
    did_mark = False

    for r in sorted(regions, key=lambda x: float(x["start"])):
        item = dict(r)
        start = float(item["start"])

        if not did_mark and start >= credits_boundary - tolerance and start <= credits_boundary + tolerance:
            item["label"] = "Credits"
            did_mark = True

        marked.append(item)

    return marked

def force_credits_boundary(regions, duration: float, boundary: float):
    """
    Ensure a cut exists at the credits boundary and label boundary-end as Credits.
    Keeps the remaining detected regions as intact as possible.
    """
    if boundary is None:
        return regions

    boundary = float(boundary)
    if boundary <= 1 or boundary >= duration - 1:
        return regions

    if not regions:
        return [
            {"start": 0.0, "end": boundary, "label": "Episode"},
            {"start": boundary, "end": duration, "label": "Credits"},
        ]

    out = []
    inserted = False

    for r in sorted(regions, key=lambda x: float(x["start"])):
        start = float(r["start"])
        end = float(r["end"])
        label = r.get("label") or "Episode"

        if not inserted and start <= boundary <= end and end - start > 2:
            if boundary - start >= 2:
                out.append({"start": start, "end": boundary, "label": label})
            if end - boundary >= 1:
                out.append({"start": boundary, "end": end, "label": "Credits"})
            inserted = True
        else:
            out.append(r)

    if not inserted and out:
        # If the credits segment was filtered out for being short, append it.
        last = out[-1]
        last_start = float(last["start"])
        last_end = float(last["end"])

        if abs(last_end - boundary) <= 2.0 and duration - boundary >= 1:
            out.append({"start": boundary, "end": duration, "label": "Credits"})
        elif last_start < boundary < duration - 1 and last_end >= duration - 1:
            # Last region covers the credits start; split it.
            out[-1] = {"start": last_start, "end": boundary, "label": last.get("label") or "Episode"}
            out.append({"start": boundary, "end": duration, "label": "Credits"})

    if not out and boundary >= 1 and boundary < duration - 1:
        out = [
            {"start": 0.0, "end": boundary, "label": "Episode"},
            {"start": boundary, "end": duration, "label": "Credits"},
        ]

    return out

def boundaries_to_regions_with_forced(boundaries, duration, intro_boundary=None, credits_boundary=None, min_len=30):
    """
    Build regions while preserving user-hinted intro/credits segments even when
    those segments are shorter than the normal Auto Detect min_len threshold.
    """
    intro_boundary = float(intro_boundary) if intro_boundary else None
    credits_boundary = float(credits_boundary) if credits_boundary else None

    points = sorted(set([0.0] + [float(x) for x in boundaries if 0 < float(x) < duration] + [duration]))
    regions = []

    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        length = end - start

        if intro_boundary and abs(end - intro_boundary) <= 1.0 and length >= 1:
            regions.append({"start": start, "end": end, "label": "Titles"})
            continue

        if credits_boundary and abs(start - credits_boundary) <= 1.0 and length >= 1:
            regions.append({"start": start, "end": end, "label": "Credits"})
            continue

        if intro_boundary and abs(start - intro_boundary) <= 1.0 and length >= min(5, min_len):
            regions.append({"start": start, "end": end, "label": "Episode"})
            continue

        if credits_boundary and abs(end - credits_boundary) <= 1.0 and length >= min(5, min_len):
            regions.append({"start": start, "end": end, "label": "Episode"})
            continue

        if length >= min_len:
            regions.append({"start": start, "end": end, "label": f"Episode {len(regions) + 1}"})

    return regions

def boundaries_to_regions_with_intro(boundaries, duration, intro_boundary, min_len=30):
    """
    Build regions while preserving the intro/title segment even when it is
    shorter than the normal Auto Detect min_len threshold.
    """
    intro_boundary = float(intro_boundary) if intro_boundary else None
    points = sorted(set([0.0] + [float(x) for x in boundaries if 0 < float(x) < duration] + [duration]))
    regions = []

    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        length = end - start

        if intro_boundary and abs(start - 0.0) < 0.01 and abs(end - intro_boundary) <= 1.0 and length >= 1:
            regions.append({"start": start, "end": end, "label": "Titles"})
            continue

        if intro_boundary and abs(start - intro_boundary) <= 1.0 and length >= min(5, min_len):
            regions.append({"start": start, "end": end, "label": "Episode"})
            continue

        if length >= min_len:
            regions.append({"start": start, "end": end, "label": f"Episode {len(regions) + 1}"})

    return regions

def force_intro_boundary(regions, duration: float, boundary: float):
    """
    Ensure the first cut is at boundary and label 0-boundary as Titles.
    Keeps the remaining detected regions as intact as possible.
    """
    if boundary is None:
        return regions

    boundary = float(boundary)
    if boundary <= 1 or boundary >= duration - 1:
        return regions

    if not regions:
        return [
            {"start": 0.0, "end": boundary, "label": "Titles"},
            {"start": boundary, "end": duration, "label": "Episode"},
        ]

    out = []
    inserted = False

    for r in sorted(regions, key=lambda x: x["start"]):
        start = float(r["start"])
        end = float(r["end"])
        label = r.get("label") or "Episode"

        if not inserted and start <= boundary <= end and end - start > 2:
            if boundary - start >= 2:
                out.append({"start": start, "end": boundary, "label": "Titles" if start <= 1 else label})
            if end - boundary >= 2:
                out.append({"start": boundary, "end": end, "label": "Episode" if start <= 1 else label})
            inserted = True
        else:
            out.append(r)

    if not inserted and out:
        # Fallback: prepend a title region and shift the first region start.
        # This also covers cases where the 0-boundary segment was filtered out
        # for being shorter than the normal Auto Detect minimum length.
        first = out[0]
        first_start = float(first["start"])
        first_end = float(first["end"])

        if boundary < first_end - 2:
            out[0] = {"start": max(boundary, first_start), "end": first_end, "label": first.get("label") or "Episode"}
            if boundary >= 1:
                out.insert(0, {"start": 0.0, "end": boundary, "label": "Titles"})

    if not out and boundary >= 1 and boundary < duration - 1:
        out = [
            {"start": 0.0, "end": boundary, "label": "Titles"},
            {"start": boundary, "end": duration, "label": "Episode"},
        ]

    return out

def snap_expected_boundaries_to_real_events(duration, expected_episodes, black, silence):
    """
    Uses expected episode count only to know where to look.

    Important: this does NOT create estimated split points. A boundary is only
    returned if a real black-frame or silence event exists near the expected
    location.
    """
    expected = expected_boundary_times(duration, expected_episodes)
    if not expected:
        return [], []

    avg_len = duration / max(1, expected_episodes)

    # Search window is intentionally limited. For a 44-minute / 2 episode file,
    # this is about 5.5 min, capped to keep far-away black frames from being used.
    window = max(90, min(360, avg_len * 0.25))

    black_candidates = [{"time": e["time"], "source": "black"} for e in black if 30 < e["time"] < duration - 30]
    silence_candidates = [{"time": e["time"], "source": "silence"} for e in silence if 30 < e["time"] < duration - 30]

    boundaries = []
    missed = []

    for expected_time in expected:
        picked = nearest_candidate(expected_time, black_candidates, window)

        # Silence is only a fallback when no black frame exists near that expected boundary.
        if picked is None:
            picked = nearest_candidate(expected_time, silence_candidates, window)

        if picked is None:
            missed.append({
                "expected": expected_time,
                "window": window,
                "message": "No real black-frame or silence point found near this expected boundary.",
            })
            continue

        # Deduplicate boundaries that land on the same detected event.
        if all(abs(picked["time"] - b) > 1.0 for b in boundaries):
            boundaries.append(picked["time"])

    return sorted(boundaries), missed

def split_titles_credits_from_black(duration, black_events, expected_episodes):
    """
    Optional title/credits splitting using actual black-frame boundaries only.
    """
    if duration <= 0:
        return []

    expected_episodes = max(1, int(expected_episodes or 1))
    avg_len = duration / expected_episodes
    min_main = max(300, avg_len * 0.35)
    min_short = 15
    max_short = 240

    black_times = sorted(set(round(e["time"], 2) for e in black_events if 5 < e["time"] < duration - 5))
    if not black_times:
        return []

    points = [0.0] + black_times + [duration]
    merged = []
    for p in sorted(points):
        if not merged or abs(p - merged[-1]) > 3:
            merged.append(p)

    raw_segments = []
    for i in range(len(merged) - 1):
        start = merged[i]
        end = merged[i + 1]
        length = end - start
        if length >= min_short:
            raw_segments.append({"start": start, "end": end, "length": length})

    regions = []
    for i, seg in enumerate(raw_segments):
        length = seg["length"]
        prev_len = raw_segments[i - 1]["length"] if i > 0 else 0
        next_len = raw_segments[i + 1]["length"] if i + 1 < len(raw_segments) else 0

        is_main = length >= min_main
        is_short_title_credit = (
            min_short <= length <= max_short and
            (prev_len >= min_main or next_len >= min_main)
        )

        if is_main or is_short_title_credit:
            label = "Episode"

            if is_short_title_credit:
                # Short segment before a main segment is usually a title/intro.
                # Short segment after a main segment is usually credits/outro.
                if next_len >= min_main and prev_len < min_main:
                    label = "Titles"
                elif prev_len >= min_main:
                    label = "Credits"
                else:
                    label = "Titles"

            regions.append({"start": seg["start"], "end": seg["end"], "label": label})

    if len(regions) > 40:
        return []

    return regions

def combined_detect(path: Path, expected_episodes: int = 2, split_titles_credits: bool = False, intro_titles_hint_time=None, credits_split_hint_time=None):
    duration = ffprobe_duration(path)
    black = detect_black(path)
    silence = detect_silence(path)
    expected_episodes = max(1, int(expected_episodes or 1))
    intro_candidate = intro_hint_boundary(path, duration, black, intro_titles_hint_time) if intro_titles_hint_time else None
    intro_boundary = intro_candidate["time"] if intro_candidate else None
    credits_candidate = intro_hint_boundary(path, duration, black, credits_split_hint_time) if credits_split_hint_time else None
    credits_boundary = credits_candidate["time"] if credits_candidate else None

    if split_titles_credits:
        tc_regions = split_titles_credits_from_black(duration, black, expected_episodes)
        if len(tc_regions) >= 2:
            if intro_boundary:
                tc_regions = force_intro_boundary(tc_regions, duration, intro_boundary)
                tc_regions = mark_intro_ending_region(tc_regions, intro_boundary)

            if credits_boundary:
                tc_regions = force_credits_boundary(tc_regions, duration, credits_boundary)
                tc_regions = mark_credits_starting_region(tc_regions, credits_boundary)

            msg = f"Auto Detect split titles/credits using actual black-frame boundaries and found {len(tc_regions)} regions."
            if intro_candidate:
                msg += f" Intro Titles hint used a {intro_candidate['type']} cut near {intro_titles_hint_time:.2f}s."
            if credits_candidate:
                msg += f" Credits hint used a {credits_candidate['type']} cut near {credits_split_hint_time:.2f}s."

            return {
                "duration": duration,
                "expected_episodes": expected_episodes,
                "silence": silence,
                "black": black,
                "boundaries": [r["start"] for r in tc_regions if r["start"] > 0],
                "missed": [],
                "regions": tc_regions,
                "message": msg,
            }

    boundaries, missed = snap_expected_boundaries_to_real_events(duration, expected_episodes, black, silence)

    if intro_boundary and all(abs(intro_boundary - b) > 1.0 for b in boundaries):
        boundaries = sorted([intro_boundary] + boundaries)

    if credits_boundary and all(abs(credits_boundary - b) > 1.0 for b in boundaries):
        boundaries = sorted(boundaries + [credits_boundary])

    if not boundaries:
        return {
            "duration": duration,
            "expected_episodes": expected_episodes,
            "silence": silence,
            "black": black,
            "boundaries": [],
            "missed": missed,
            "regions": [],
            "message": "Auto Detect did not create any splits because no real black-frame or silence points were found near the expected episode boundaries.",
        }

    min_len = max(30, (duration / expected_episodes) * 0.20)

    if intro_boundary or credits_boundary:
        regions = boundaries_to_regions_with_forced(
            boundaries,
            duration,
            intro_boundary=intro_boundary,
            credits_boundary=credits_boundary,
            min_len=min_len,
        )

        if intro_boundary:
            regions = force_intro_boundary(regions, duration, intro_boundary)
            regions = mark_intro_ending_region(regions, intro_boundary)

        if credits_boundary:
            regions = force_credits_boundary(regions, duration, credits_boundary)
            regions = mark_credits_starting_region(regions, credits_boundary)
    else:
        regions = boundaries_to_regions(boundaries, duration, min_len=min_len)

    return {
        "duration": duration,
        "expected_episodes": expected_episodes,
        "silence": silence,
        "black": black,
        "boundaries": boundaries,
        "missed": missed,
        "regions": regions,
        "message": (
            f"Auto Detect used expected episode count ({expected_episodes}) and snapped to {len(boundaries)} real detected boundary point(s)."
            + (f" Intro Titles hint used a {intro_candidate['type']} cut near {intro_titles_hint_time:.2f}s." if intro_candidate else "")
            + (f" Credits hint used a {credits_candidate['type']} cut near {credits_split_hint_time:.2f}s." if credits_candidate else "")
        ),
    }
