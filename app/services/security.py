from pathlib import Path

def safe_join(root: Path, relative_path: str) -> Path:
    relative_path = (relative_path or "").lstrip("/\\")
    candidate = (root / relative_path).resolve()
    root_resolved = root.resolve()
    if candidate == root_resolved or root_resolved in candidate.parents:
        return candidate
    raise ValueError("Unsafe path")
