let cwd = "";
let currentPath = null;
let currentListing = {folders: [], files: [], parent: null, cwd: ""};
let wavesurfer = null;
let wsRegions = null;
let activeJobs = new Set();
let includedRegionIds = new Map();
let regionLabels = new Map();
let currentFps = 29.97;
let pendingQueue = [];
let splitStatusMode = null; // "single" or "queue"
let splitTrackedJobIds = new Set();
let splitCompletionShown = false;
let activeOperationAbort = null;
let mediaLoadToken = 0;

const fileList = document.getElementById("fileList");
const search = document.getElementById("search");
const video = document.getElementById("video");
const regionsList = document.getElementById("regionsList");
const jobsDiv = document.getElementById("jobs");
const pendingQueueDiv = document.getElementById("pendingQueue");
const codecDisplay = document.getElementById("codecDisplay");
const fpsDisplay = document.getElementById("fpsDisplay");
const resolutionDisplay = document.getElementById("resolutionDisplay");
const fileSizeDisplay = document.getElementById("fileSizeDisplay");
const selectedTitle = document.getElementById("selectedTitle");
const frameDisplay = document.getElementById("frameDisplay");
const zoomDisplay = document.getElementById("zoomDisplay");
const storageText = document.getElementById("storageText");
const storageFill = document.getElementById("storageFill");
const previewNamesList = document.getElementById("previewNamesList");
const statusPill = document.getElementById("statusPill");
const breadcrumbs = document.getElementById("breadcrumbs");
const busyOverlay = document.getElementById("busyOverlay");
const busyTitle = document.getElementById("busyTitle");
const busyText = document.getElementById("busyText");
const busyHint = document.getElementById("busyHint");
const busyCancel = document.getElementById("busyCancel");
const fastPreviewNoAudio = document.getElementById("fastPreviewNoAudio");
const settingsMenuButton = document.getElementById("settingsMenuButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsCloseButton = document.getElementById("settingsCloseButton");
const cacheCleanupDaysInput = document.getElementById("cacheCleanupDays");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const cleanCacheNowButton = document.getElementById("cleanCacheNowButton");
const settingsStatus = document.getElementById("settingsStatus");
const defaultSplitTitlesCreditsInput = document.getElementById("defaultSplitTitlesCredits");
const defaultFastPreviewNoAudioInput = document.getElementById("defaultFastPreviewNoAudio");
const currentAdminPasswordInput = document.getElementById("currentAdminPassword");
const newAdminPasswordInput = document.getElementById("newAdminPassword");
const confirmAdminPasswordInput = document.getElementById("confirmAdminPassword");
const changePasswordButton = document.getElementById("changePasswordButton");
const logoutButton = document.getElementById("logoutButton");
const topLogoutButton = document.getElementById("topLogoutButton");
const passwordStatus = document.getElementById("passwordStatus");


const splitColors = [
  "#f97316", "#2f81f7", "#d29922", "#a371f7", "#3fb950",
  "#f85149", "#39c5cf", "#db61a2", "#7ee787", "#ffb86b"
];

function splitColor(index) {
  return splitColors[index % splitColors.length];
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

async function updateStorage() {
  if (!storageText || !storageFill) return;
  try {
    const res = await fetch("/api/storage", {cache: "no-store"});
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "storage failed");
    storageText.textContent = `${formatBytes(data.free)} free of ${formatBytes(data.total)}`;
    storageFill.style.width = `${Math.min(100, Math.max(0, data.percent_used || 0))}%`;
  } catch (err) {
    storageText.textContent = "Storage unavailable";
    console.warn("Storage info unavailable", err);
  }
}


function showBusy(title, text, hint = "Large recordings may take a while.", onCancel = null) {
  busyTitle.textContent = title;
  busyText.textContent = text;
  busyHint.textContent = hint;

  if (busyCancel) {
    if (typeof onCancel === "function") {
      busyCancel.classList.remove("hidden");
      busyCancel.onclick = onCancel;
    } else {
      busyCancel.classList.add("hidden");
      busyCancel.onclick = null;
    }
  }

  busyOverlay.classList.remove("hidden");
}

function hideBusy() {
  busyOverlay.classList.add("hidden");
  if (busyCancel) {
    busyCancel.classList.add("hidden");
    busyCancel.onclick = null;
  }
  activeOperationAbort = null;
}

function fmt(seconds) {
  seconds = Math.max(0, seconds || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}

function parseOptionalTimeSeconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const parts = raw.split(":").map(part => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }

  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function updateFrameCounter() {
  const fps = Number(currentFps) || 29.97;
  const frame = Math.max(0, Math.floor((video.currentTime || 0) * fps));
  if (frameDisplay) {
    frameDisplay.textContent = `Frame: ${frame}`;
  }
}

function parseEpisodeInfo(path) {
  const file = path.split("/").pop().replace(/\.[^.]+$/, "");
  let m = file.match(/^(.*?)[ ._\-]+S(\d{1,2})E(\d{1,3})/i);
  if (m) {
    return {
      show: m[1].replace(/[._]+/g, " ").replace(/\s+/g, " ").trim(),
      season: Number(m[2]),
      episode: Number(m[3])
    };
  }

  m = file.match(/^(.*?)[ ._\-]+(\d{1,2})x(\d{1,3})/i);
  if (m) {
    return {
      show: m[1].replace(/[._]+/g, " ").replace(/\s+/g, " ").trim(),
      season: Number(m[2]),
      episode: Number(m[3])
    };
  }

  return {
    show: file.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim(),
    season: 1,
    episode: 1
  };
}

async function browse(dir = "") {
  try {
    console.log("Cutarr browse requested:", dir);
    statusPill.textContent = "Loading folder";
    fileList.innerHTML = `<div class="small">Loading folder...</div>`;

    const params = new URLSearchParams();
    params.set("dir", dir || "");

    const res = await fetch("/api/browse?" + params.toString(), {cache: "no-store"});
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Browse failed");
    }

    cwd = data.cwd || "";
    currentListing = data;
    renderBreadcrumbs();
    renderFiles();
    statusPill.textContent = "Ready";
  } catch (err) {
    statusPill.textContent = "Browse failed";
    fileList.innerHTML = `<div class="small">Browse failed: ${escapeHtml(err.message || err)}</div>`;
    console.error("Cutarr browse failed:", err);
  }
}

function renderBreadcrumbs() {
  breadcrumbs.className = "breadcrumbs";
  breadcrumbs.innerHTML = "";

  const root = document.createElement("span");
  root.className = "crumb";
  root.textContent = "Media";
  root.addEventListener("click", () => browse(""));
  breadcrumbs.appendChild(root);

  if (!cwd) return;

  const parts = cwd.split("/");
  let acc = "";

  parts.forEach(part => {
    acc = acc ? `${acc}/${part}` : part;
    const thisPath = acc;

    const crumb = document.createElement("span");
    crumb.className = "crumb";
    crumb.textContent = part;
    crumb.addEventListener("click", () => browse(thisPath));
    breadcrumbs.appendChild(crumb);
  });
}

function renderFiles() {
  const q = (search.value || "").toLowerCase();
  fileList.innerHTML = "";

  const addRow = (kind, icon, label, path) => {
    const row = document.createElement("div");
    row.className = "fileItem fileItemClickable" + (kind === "file" && path === currentPath ? " active" : "");

    const nameWrap = document.createElement("div");
    nameWrap.className = "fileNameWrap";

    const iconSpan = document.createElement("span");
    iconSpan.textContent = icon;

    const textSpan = document.createElement("span");
    textSpan.className = "fileNameText";
    textSpan.textContent = label;

    nameWrap.appendChild(iconSpan);
    nameWrap.appendChild(textSpan);
    row.appendChild(nameWrap);

    row.addEventListener("click", (event) => {
      event.preventDefault();

      if (kind === "folder") {
        console.log("Cutarr browse folder:", path);
        browse(path || "");
      } else {
        console.log("Cutarr select file:", path);
        selectFile(path);
      }
    });

    fileList.appendChild(row);
  };

  if (currentListing.parent !== null) {
    addRow("folder", "⬆️", "..", currentListing.parent || "");
  }

  (currentListing.folders || [])
    .filter(f => f.name.toLowerCase().includes(q))
    .forEach(f => addRow("folder", "📁", f.name, f.path));

  (currentListing.files || [])
    .filter(f => f.name.toLowerCase().includes(q))
    .forEach(f => addRow("file", "🎬", f.name, f.path));

  if (!fileList.children.length) {
    fileList.innerHTML = `<div class="small">No folders or supported video files in this folder.</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}


function regionKey(start, end) {
  return `${Number(start).toFixed(2)}-${Number(end).toFixed(2)}`;
}

function rememberRegionLabel(region, label) {
  const safeLabel = label || "Episode";
  regionLabels.set(region.id, safeLabel);
  regionLabels.set(regionKey(region.start, region.end), safeLabel);
}

function getRegionLabel(region) {
  return (
    regionLabels.get(region.id) ||
    regionLabels.get(regionKey(region.start, region.end)) ||
    "Episode"
  );
}


async function useFastPreviewNoAudio() {
  return Boolean(fastPreviewNoAudio && fastPreviewNoAudio.checked);
}

function previewUrlFor(path) {
  const encoded = "/preview/" + encodeURIComponent(path).replaceAll("%2F", "/");
  return encoded + (useFastPreviewNoAudio() ? "?audio=0" : "?audio=1");
}

function restoreFastPreviewSetting() {
  // Defaults now come from /api/settings. This fallback keeps the control stable
  // until settings finish loading.
  if (!fastPreviewNoAudio) return;
}

function attachFastPreviewSettingHandler() {
  if (!fastPreviewNoAudio) return;
  fastPreviewNoAudio.addEventListener("change", () => {
    if (currentPath) {
      selectFile(currentPath);
    }
  });
}

function selectFile(path) {
  currentPath = path;
  includedRegionIds = new Map();
  regionLabels = new Map();
  renderFiles();

  const parsed = parseEpisodeInfo(path);
  if (selectedTitle) selectedTitle.textContent = path.split("/").pop();
  document.getElementById("showName").value = parsed.show || "Show Name";
  document.getElementById("season").value = parsed.season || 1;
  document.getElementById("startEpisode").value = parsed.episode || 1;

  fetch("/api/info?path=" + encodeURIComponent(path))
    .then(r => r.json())
    .then(info => {
      currentFps = Number(info.fps) || 29.97;
      if (codecDisplay) codecDisplay.textContent = `Codec: ${info.video_codec || "--"}`;
      fpsDisplay.textContent = `FPS: ${currentFps.toFixed(3)}`;

      if (resolutionDisplay) {
        resolutionDisplay.textContent = info.width && info.height
          ? `Resolution: ${info.width}×${info.height}`
          : "Resolution: --";
      }

      if (fileSizeDisplay) {
        fileSizeDisplay.textContent = `Size: ${formatBytes(info.size_bytes)}`;
      }
    })
    .catch(() => {
      currentFps = 29.97;
      if (codecDisplay) codecDisplay.textContent = "Codec: --";
      fpsDisplay.textContent = "FPS: 29.970";
      if (resolutionDisplay) resolutionDisplay.textContent = "Resolution: --";
      if (fileSizeDisplay) fileSizeDisplay.textContent = "Size: --";
    });

  updateFrameCounter();
  statusPill.textContent = "Loading media";

  const token = ++mediaLoadToken;
  const waveformAbort = new AbortController();
  activeOperationAbort = waveformAbort;

  const cancelLoad = () => {
    mediaLoadToken += 1;
    if (activeOperationAbort) activeOperationAbort.abort();

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (wavesurfer) {
      try { wavesurfer.destroy(); } catch (err) {}
      wavesurfer = null;
      wsRegions = null;
    }

    statusPill.textContent = "Load canceled";
    hideBusy();
  };

  const fastNoAudio = useFastPreviewNoAudio();

  showBusy(
    "Loading media",
    fastNoAudio ? "Preparing faster video-only preview." : "Preparing browser-compatible preview with audio.",
    fastNoAudio
      ? "Audio is skipped for faster loading. Turn this option off when you need audio."
      : "The first load may transcode a cached MP4/AAC preview. Future loads use the cache.",
    cancelLoad
  );

  const previewUrl = previewUrlFor(path);
  video.pause();
  video.removeAttribute("src");
  video.load();

  video.onloadedmetadata = async () => {
    if (token !== mediaLoadToken) return;

    updateFrameCounter();
    statusPill.textContent = "Processing Waveform";
    busyTitle.textContent = "Processing waveform";
    busyText.textContent = "Generating/loading cached waveform data.";
    busyHint.textContent = "This may take a while the first time a video is opened.";

    try {
      await initWaveform(path, waveformAbort.signal, previewUrl);
      if (token !== mediaLoadToken) return;
      statusPill.textContent = "Media Loaded";
      tightenContentCards();
    } catch (err) {
      if (err && err.name === "AbortError") {
        statusPill.textContent = "Load canceled";
        return;
      }

      console.error("Waveform load failed:", err);
      statusPill.textContent = "Waveform failed";
      alert("The video loaded, but the waveform failed to process. Check container logs.");
    } finally {
      if (token === mediaLoadToken) hideBusy();
    }
  };

  video.onerror = () => {
    if (token !== mediaLoadToken) return;
    statusPill.textContent = "Media load failed";
    hideBusy();
    alert("The browser could not load the preview. Check container logs for FFmpeg preview errors.");
  };

  video.src = previewUrl;
  video.muted = fastNoAudio;
  video.volume = fastNoAudio ? 0 : 1.0;
  video.load();
}

function mediaUrlFor(path) {
  return encodeURIComponent(path).replaceAll("%2F", "/");
}

function getZoomPxPerSec() {
  const raw = Number(document.getElementById("zoom").value || 0);

  // 0 means fit-to-window. Above 0 uses an exponential-ish curve
  // so changes are visible on long recordings.
  if (raw <= 0) return 0;

  return Math.round(5 + Math.pow(raw / 100, 2) * 95);
}

function applyWaveformZoom() {
  if (!wavesurfer) return;

  const px = getZoomPxPerSec();

  if (px <= 0) {
    zoomDisplay.textContent = "Fit";
    try {
      wavesurfer.setOptions({ minPxPerSec: 0, fillParent: true });
      wavesurfer.zoom(0);
    } catch (err) {
      console.warn("Fit zoom failed", err);
    }
    return;
  }

  zoomDisplay.textContent = `${px}px/sec`;

  try {
    wavesurfer.setOptions({ minPxPerSec: px, fillParent: false });
    wavesurfer.zoom(px);
  } catch (err) {
    console.warn("Waveform zoom failed", err);
  }
}

async function initWaveform(path, signal = null, previewUrl = null) {
  if (wavesurfer) wavesurfer.destroy();

  wsRegions = WaveSurfer.Regions.create();

  wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#4b5563",
    progressColor: "#58a6ff",
    cursorColor: "#f85149",
    height: 92,
    normalize: true,
    minPxPerSec: getZoomPxPerSec(),
    fillParent: getZoomPxPerSec() <= 0,
    plugins: [wsRegions],
  });

  wsRegions.enableDragSelection({
    color: "rgba(46, 160, 67, 0.12)",
  });

  wavesurfer.on("interaction", () => {
    video.currentTime = wavesurfer.getCurrentTime();
  });

  video.ontimeupdate = () => {
    updateFrameCounter();
    if (wavesurfer && Math.abs(wavesurfer.getCurrentTime() - video.currentTime) > 0.75) {
      wavesurfer.setTime(video.currentTime);
    }
  };

  wsRegions.on("region-created", r => {
    if (!includedRegionIds.has(r.id)) includedRegionIds.set(r.id, true);
    if (!regionLabels.has(r.id)) rememberRegionLabel(r, "Episode");
    renderRegions();
  });
  wsRegions.on("region-updated", r => {
    const label = getRegionLabel(r);
    rememberRegionLabel(r, label);
    renderRegions();
  });
  wsRegions.on("region-removed", r => {
    includedRegionIds.delete(r.id);
    regionLabels.delete(r.id);
    regionLabels.delete(regionKey(r.start, r.end));
    renderRegions();
  });

  // Use original media for waveform timing; preview has same duration but original audio is more accurate.
  const encodedPath = mediaUrlFor(path);
  const waveformMediaUrl = previewUrl || ("/preview/" + encodedPath);

  if (busyText) {
    busyText.textContent = "Processing waveform cache...";
  }

  if (signal && signal.aborted) throw new DOMException("Operation canceled", "AbortError");

  const waveform = await fetch("/api/waveform?path=" + encodeURIComponent(path), {cache: "no-store", signal})
    .then(r => r.json());

  if (signal && signal.aborted) throw new DOMException("Operation canceled", "AbortError");

  if (busyText) {
    busyText.textContent = "Rendering waveform timeline...";
  }

  if (signal && signal.aborted) throw new DOMException("Operation canceled", "AbortError");

  if (waveform && waveform.channel_data && waveform.channel_data.length) {
    // Load the cached signed waveform data so zooming has enough detail.
    await wavesurfer.load(
      waveformMediaUrl,
      [waveform.channel_data],
      waveform.duration || video.duration || undefined
    );
  } else {
    await wavesurfer.load(waveformMediaUrl);
  }

  applyWaveformZoom();
  tightenContentCards();
  centerWaveformCanvas();
}

function getRegions(includeOnlyChecked = false) {
  if (!wsRegions) return [];
  return wsRegions.getRegions()
    .map((r, idx) => ({
      id: r.id,
      start: r.start,
      end: r.end,
      label: getRegionLabel(r),
      include: includedRegionIds.get(r.id) !== false
    }))
    .filter(r => r.end > r.start)
    .filter(r => !includeOnlyChecked || r.include)
    .sort((a,b) => a.start - b.start);
}


function applyRegionColor(regionId, color) {
  if (!wsRegions) return;
  const region = wsRegions.getRegions().find(x => x.id === regionId);
  if (!region) return;

  const fill = hexToRgba(color, 0.24);
  try {
    if (typeof region.setOptions === "function") {
      region.setOptions({ color: fill });
    }
  } catch (err) {
    // Fall through to direct element styling.
  }

  if (region.element) {
    region.element.style.backgroundColor = fill;
    region.element.style.borderLeft = `3px solid ${color}`;
    region.element.style.borderRight = `3px solid ${color}`;
    region.element.style.boxShadow = `0 0 0 1px ${hexToRgba(color, 0.35)}`;
  }
}

function outputFilename(show, season, episode, label) {
  const safeShow = (show || "Show").trim() || "Show";
  const ep = String(episode).padStart(2, "0");
  const seasonText = String(Number(season) || 1).padStart(2, "0");
  const suffix = label && label !== "Episode" ? ` - ${label}` : "";
  return `${safeShow} - S${seasonText}E${ep}${suffix}.mkv`;
}

function renderPreviewNames() {
  if (!previewNamesList) return;

  // Use all regions here so the color index matches the Regions list exactly.
  // Only checked regions get an output name and episode number.
  const allRegions = getRegions(false);
  const checkedRegions = allRegions.filter(r => r.include !== false);
  const show = document.getElementById("showName").value;
  const season = Number(document.getElementById("season").value) || 1;
  let episode = Number(document.getElementById("startEpisode").value) || 1;

  previewNamesList.innerHTML = "";

  if (!checkedRegions.length) {
    previewNamesList.innerHTML = `<p class="small">No checked regions yet.</p>`;
    return;
  }

  allRegions.forEach((r, visualIndex) => {
    if (r.include === false) return;

    const color = splitColor(visualIndex);
    const row = document.createElement("div");
    row.className = "previewNameRow";
    row.innerHTML = `
      <span class="previewDot" style="background:${color}"></span>
      <span>${escapeHtml(outputFilename(show, season, episode, r.label))}</span>
    `;
    previewNamesList.appendChild(row);
    episode += 1;
  });
}


function renderRegions() {
  const allRegions = getRegions(false);
  regionsList.innerHTML = "";

  const header = document.createElement("div");
  header.className = "regionHeader";
  header.innerHTML = `
    <div>#</div>
    <div>Include</div>
    <div>Type</div>
    <div>Start</div>
    <div>End</div>
    <div>Duration</div>
    <div>Output</div>
    <div></div>
  `;
  regionsList.appendChild(header);

  let outputEpisodeNumber = Number(document.getElementById("startEpisode").value) || 1;
  let visualIndex = 0;

  allRegions.forEach((r) => {
    const include = includedRegionIds.get(r.id) !== false;
    const regionKind = r.label && r.label !== "Episode" ? r.label : "Episode";
    const color = splitColor(visualIndex);
    applyRegionColor(r.id, color);

    const row = document.createElement("div");
    row.className = "regionRow" + (include ? "" : " regionSkipped");

    const outputText = include
      ? (regionKind === "Episode"
          ? `Episode ${String(outputEpisodeNumber).padStart(2, "0")}`
          : `${regionKind} / Ep ${String(outputEpisodeNumber).padStart(2, "0")}`)
      : "skip";

    row.innerHTML = `
      <div><span class="splitNumber" style="background:${color}">${visualIndex + 1}</span></div>
      <div><input type="checkbox" ${include ? "checked" : ""} data-id="${r.id}"></div>
      <div><span class="regionTypeBadge">${escapeHtml(regionKind)}</span></div>
      <div>${fmt(r.start)}</div>
      <div>${fmt(r.end)}</div>
      <div>${fmt(r.end - r.start)}</div>
      <div><span class="regionOutputBadge ${include ? "" : "skip"}">${escapeHtml(outputText)}</span></div>
      <div><button data-delete="${r.id}" title="Delete region">🗑</button></div>
    `;

    row.querySelector("input[type='checkbox']").onchange = (e) => {
      includedRegionIds.set(r.id, e.target.checked);
      renderRegions();
    };

    row.querySelector("button").onclick = () => {
      const region = wsRegions.getRegions().find(x => x.id === r.id);
      if (region) region.remove();
    };

    regionsList.appendChild(row);

    if (include) outputEpisodeNumber += 1;
    visualIndex += 1;
  });

  if (!allRegions.length) {
    const empty = document.createElement("div");
    empty.className = "regionRow";
    empty.innerHTML = `<div></div><div></div><div>No regions yet</div><div></div><div></div><div></div><div></div><div></div>`;
    regionsList.appendChild(empty);
  }

  renderPreviewNames();
  alignRegionsPanelToJobs();
}


function stepFrame(direction) {
  if (!video.src) return;

  video.pause();

  const fps = Number(currentFps) || 29.97;
  const frame = 1 / fps;
  const duration = video.duration || wavesurfer?.getDuration() || 0;
  const nextTime = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, video.currentTime + direction * frame));

  video.currentTime = nextTime;
  updateFrameCounter();
  if (wavesurfer) wavesurfer.setTime(nextTime);
}


function overlappingRegionFor(start, end, oldRegions) {
  const center = (start + end) / 2;

  let best = null;
  let bestOverlap = 0;

  oldRegions.forEach(old => {
    const overlap = Math.max(0, Math.min(end, old.end) - Math.max(start, old.start));

    if (center >= old.start && center <= old.end && overlap >= bestOverlap) {
      best = old;
      bestOverlap = overlap;
    } else if (!best && overlap > bestOverlap) {
      best = old;
      bestOverlap = overlap;
    }
  });

  return best;
}

function rebuildRegionsFromSplitPoints(splitPoints) {
  if (!wavesurfer || !wsRegions) return;

  const duration = wavesurfer.getDuration() || video.duration || 0;
  if (!duration) return;

  const oldRegions = getRegions(false);

  wsRegions.clearRegions();
  includedRegionIds = new Map();

  const points = [0, ...splitPoints.filter(t => t > 0 && t < duration), duration]
    .sort((a, b) => a - b)
    .filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) > 0.5);

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];

    if (end - start < 1) continue;

    const oldMatch = overlappingRegionFor(start, end, oldRegions);
    const preservedLabel = oldMatch ? oldMatch.label : "Episode";
    const preservedInclude = oldMatch ? oldMatch.include !== false : true;

    const region = wsRegions.addRegion({
      start,
      end,
      color: "rgba(46, 160, 67, 0.12)",
      drag: true,
      resize: true,
    });

    includedRegionIds.set(region.id, preservedInclude);
    rememberRegionLabel(region, preservedLabel || "Episode");
  }

  renderRegions();
}

function rebuildRegionsFromRegionSpecs(regionSpecs) {
  if (!wavesurfer || !wsRegions) return;

  wsRegions.clearRegions();
  includedRegionIds = new Map();

  regionSpecs
    .filter(r => Number(r.end) > Number(r.start) && Number(r.end) - Number(r.start) >= 0.25)
    .sort((a, b) => a.start - b.start)
    .forEach(spec => {
      const region = wsRegions.addRegion({
        start: Number(spec.start),
        end: Number(spec.end),
        color: "rgba(46, 160, 67, 0.12)",
        drag: true,
        resize: true,
      });

      includedRegionIds.set(region.id, spec.include !== false);
      rememberRegionLabel(region, spec.label || "Episode");
    });

  renderRegions();
}

function addSplitAtPlayhead() {
  if (!wavesurfer || !wsRegions) return;

  const t = video.currentTime || wavesurfer.getCurrentTime();
  const duration = wavesurfer.getDuration() || video.duration || 0;

  if (!duration || t <= 0 || t >= duration) return;

  const splitTime = Number(t);
  const existingRegions = getRegions(false);

  // If there are no regions yet, split the entire video into two regions.
  if (!existingRegions.length) {
    rebuildRegionsFromRegionSpecs([
      { start: 0, end: splitTime, label: "Episode", include: true },
      { start: splitTime, end: duration, label: "Episode", include: true },
    ]);
    return;
  }

  const tolerance = 0.20;

  // Find the single region that contains the playhead.
  const targetIndex = existingRegions.findIndex(r =>
    splitTime > r.start + tolerance && splitTime < r.end - tolerance
  );

  if (targetIndex === -1) {
    statusPill.textContent = "Split not added";
    alert("Move the playhead inside an existing region before adding a split.");
    return;
  }

  const rebuilt = [];

  existingRegions.forEach((region, index) => {
    if (index !== targetIndex) {
      rebuilt.push({
        start: region.start,
        end: region.end,
        label: region.label,
        include: region.include,
      });
      return;
    }

    // Split only the selected/containing region. This fixes the 00:00:00-start bug
    // where an extra tiny region could be created before the requested split point.
    rebuilt.push({
      start: region.start,
      end: splitTime,
      label: region.label,
      include: region.include,
    });

    rebuilt.push({
      start: splitTime,
      end: region.end,
      label: region.label,
      include: region.include,
    });
  });

  rebuildRegionsFromRegionSpecs(rebuilt);
}

function splitBoundaryPoints() {
  const duration = wavesurfer?.getDuration() || video.duration || 0;
  const points = [];

  getRegions(false).forEach(region => {
    if (region.start > 0.25 && region.start < duration - 0.25) points.push(region.start);
    if (region.end > 0.25 && region.end < duration - 0.25) points.push(region.end);
  });

  return points
    .sort((a, b) => a - b)
    .filter((point, index, arr) => index === 0 || Math.abs(point - arr[index - 1]) > 0.35);
}

function goToSplitPoint(direction) {
  if (!wavesurfer && !video.src) return;

  const duration = wavesurfer?.getDuration() || video.duration || 0;
  const current = video.currentTime || wavesurfer?.getCurrentTime() || 0;
  const points = splitBoundaryPoints();

  if (!points.length) {
    statusPill.textContent = "No split points";
    return;
  }

  const tolerance = 0.15;
  let target = null;

  if (direction > 0) {
    target = points.find(point => point > current + tolerance);
    if (target === undefined || target === null) target = points[0];
  } else {
    const before = points.filter(point => point < current - tolerance);
    target = before.length ? before[before.length - 1] : points[points.length - 1];
  }

  video.currentTime = target;
  if (wavesurfer) wavesurfer.setTime(target);
  updateFrameCounter();
  statusPill.textContent = `Split point ${fmt(target)}`;
}

function nearestSplitPoint(time, tolerance = 0.75) {
  const points = splitBoundaryPoints();
  if (!points.length) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  points.forEach(point => {
    const distance = Math.abs(point - time);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  });

  return bestDistance <= tolerance ? best : null;
}

function mergedRegionLabel(leftLabel, rightLabel) {
  const left = leftLabel || "Episode";
  const right = rightLabel || "Episode";

  if (left === right) return left;

  // If a title/credits region is merged back into an episode, the result
  // should be a normal episode region.
  if (left === "Episode" || right === "Episode") return "Episode";

  // Different non-episode types, such as Titles + Credits, should not keep
  // either special label after merging.
  return "Episode";
}

function deleteCurrentSplitPoint() {
  if (!wavesurfer || !wsRegions) return;

  const current = video.currentTime || wavesurfer.getCurrentTime() || 0;
  const boundary = nearestSplitPoint(current, 0.75);
  const duration = wavesurfer.getDuration() || video.duration || 0;

  if (boundary === null) {
    statusPill.textContent = "No split selected";
    alert("Move the playhead onto a split point first, or use the previous/next split buttons to select one.");
    return;
  }

  const regions = getRegions(false);
  if (!regions.length) {
    statusPill.textContent = "No split to delete";
    return;
  }

  const tolerance = 0.75;
  const leftIndex = regions.findIndex(region => Math.abs(region.end - boundary) <= tolerance);
  const rightIndex = regions.findIndex(region => Math.abs(region.start - boundary) <= tolerance);

  const rebuilt = [];
  let changed = false;

  // Normal case: two adjacent regions touch this split. Merge them.
  if (leftIndex !== -1 && rightIndex !== -1 && leftIndex !== rightIndex) {
    const skipIndex = Math.max(leftIndex, rightIndex);
    const mergeLeft = regions[Math.min(leftIndex, rightIndex)];
    const mergeRight = regions[Math.max(leftIndex, rightIndex)];

    regions.forEach((region, index) => {
      if (index === Math.min(leftIndex, rightIndex)) {
        rebuilt.push({
          start: mergeLeft.start,
          end: mergeRight.end,
          label: mergedRegionLabel(mergeLeft.label, mergeRight.label),
          include: mergeLeft.include !== false || mergeRight.include !== false,
        });
        changed = true;
        return;
      }

      if (index === skipIndex) return;

      rebuilt.push({
        start: region.start,
        end: region.end,
        label: region.label,
        include: region.include,
      });
    });
  }

  // Gap case: split is only the end of a region. Extend that region forward
  // to the next split point or the end of the file.
  else if (leftIndex !== -1) {
    const nextStarts = regions
      .filter((region, index) => index !== leftIndex && region.start > boundary + tolerance)
      .map(region => region.start)
      .sort((a, b) => a - b);

    const newEnd = nextStarts.length ? nextStarts[0] : duration;

    regions.forEach((region, index) => {
      if (index === leftIndex) {
        rebuilt.push({
          start: region.start,
          end: newEnd,
          label: region.label,
          include: region.include,
        });
        changed = true;
        return;
      }

      rebuilt.push({
        start: region.start,
        end: region.end,
        label: region.label,
        include: region.include,
      });
    });
  }

  // Gap case: split is only the beginning of a region. Extend that region
  // backward to the previous split point or the beginning of the file.
  else if (rightIndex !== -1) {
    const previousEnds = regions
      .filter((region, index) => index !== rightIndex && region.end < boundary - tolerance)
      .map(region => region.end)
      .sort((a, b) => b - a);

    const newStart = previousEnds.length ? previousEnds[0] : 0;

    regions.forEach((region, index) => {
      if (index === rightIndex) {
        rebuilt.push({
          start: newStart,
          end: region.end,
          label: region.label,
          include: region.include,
        });
        changed = true;
        return;
      }

      rebuilt.push({
        start: region.start,
        end: region.end,
        label: region.label,
        include: region.include,
      });
    });
  }

  if (!changed) {
    statusPill.textContent = "Split not deleted";
    alert("Could not find a region touching the current split point.");
    return;
  }

  rebuildRegionsFromRegionSpecs(rebuilt);
  video.currentTime = Math.max(0, Math.min(boundary, duration || boundary));
  if (wavesurfer) wavesurfer.setTime(video.currentTime);
  updateFrameCounter();
  statusPill.textContent = `Deleted split ${fmt(boundary)}`;
}


async function detect(mode) {
  if (!currentPath) return alert("Select a file first.");

  const label = mode === "combined" ? "Auto Detect" : mode === "black" ? "Black Frames Detect" : "Silence Detect";
  const detectAbort = new AbortController();
  activeOperationAbort = detectAbort;

  const cancelDetect = () => {
    if (activeOperationAbort) activeOperationAbort.abort();
    statusPill.textContent = "Detect canceled";
    hideBusy();
  };

  showBusy(label, "Scanning the video. This can take a while on large MKV recordings.", "Cancel stops waiting for this detect request and leaves existing regions unchanged.", cancelDetect);
  statusPill.textContent = "Detecting";

  try {
    const introHintInput = document.getElementById("introTitlesHint");
    const introHintSeconds = introHintInput ? parseOptionalTimeSeconds(introHintInput.value) : null;
    const creditsHintInput = document.getElementById("creditsSplitHint");
    const creditsHintSeconds = creditsHintInput ? parseOptionalTimeSeconds(creditsHintInput.value) : null;

    const res = await fetch("/api/detect", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      signal: detectAbort.signal,
      body: JSON.stringify({
        path: currentPath,
        mode,
        expected_episodes: Number(document.getElementById("expectedEpisodes").value || 2),
        split_titles_credits: document.getElementById("splitTitlesCredits").checked,
        intro_titles_hint_time: introHintSeconds,
        credits_split_hint_time: creditsHintSeconds
      })
    });
    const data = await res.json();

    if (!res.ok) {
      statusPill.textContent = "Detection failed";
      return alert(data.detail || "Detection failed");
    }

    wsRegions.clearRegions();
    includedRegionIds = new Map();

    let regions = data.regions || [];

    regions.forEach(r => {
      const region = wsRegions.addRegion({
        start: r.start,
        end: r.end,
        color: mode === "black" ? "rgba(88, 166, 255, 0.14)" : "rgba(255, 165, 0, 0.14)",
        drag: true,
        resize: true,
      });
      includedRegionIds.set(region.id, true);
      rememberRegionLabel(region, r.label || "Episode");
    });

    renderRegions();
    statusPill.textContent = `Detected ${regions.length} regions`;
    if (data.message) console.log("Cutarr Auto Detect:", data.message);
    if (mode === "combined" && regions.length === 0 && data.message) {
      alert(data.message);
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      statusPill.textContent = "Detect canceled";
      return;
    }

    console.error("Detection failed:", err);
    statusPill.textContent = "Detection failed";
    alert("Detection failed. Check container logs.");
  } finally {
    hideBusy();
  }
}

function buildSplitPayload() {
  if (!currentPath) {
    alert("Select a file first.");
    return null;
  }

  const checked = getRegions(true);
  if (!checked.length) {
    alert("Check at least one region to split.");
    return null;
  }

  const show = document.getElementById("showName").value;
  const season = Number(document.getElementById("season").value);
  const startEpisode = Number(document.getElementById("startEpisode").value);

  return {
    path: currentPath,
    displayName: currentPath.split("/").pop(),
    regions: checked.map(r => ({start: r.start, end: r.end, label: r.label})),
    show,
    season,
    start_episode: startEpisode
  };
}

function queueCurrentSplit() {
  const payload = buildSplitPayload();
  if (!payload) return;

  pendingQueue.push(payload);
  renderPendingQueue();
  statusPill.textContent = `Queued ${pendingQueue.length} split job${pendingQueue.length === 1 ? "" : "s"}`;
}

async function splitNow() {
  const payload = buildSplitPayload();
  if (!payload) return;

  splitStatusMode = "single";
  splitTrackedJobIds = new Set();
  splitCompletionShown = false;
  statusPill.textContent = "Starting Split Job";

  const jobId = await startSplitJob(payload);
  if (jobId) {
    splitTrackedJobIds.add(jobId);
    statusPill.textContent = "Split Job Running";
  }
}

function renderPendingQueue() {
  pendingQueueDiv.innerHTML = "";

  if (!pendingQueue.length) {
    pendingQueueDiv.innerHTML = `<div class="small">No queued splits yet.</div>`;
    alignRegionsPanelToJobs();
    return;
  }

  pendingQueue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "queueRow";
    row.innerHTML = `
      <div class="queueTop">
        <div>
          <b>${escapeHtml(item.displayName)}</b>
          <div class="small">${escapeHtml(item.show)} S${String(item.season).padStart(2, "0")} starting E${String(item.start_episode).padStart(2, "0")} · ${item.regions.length} region${item.regions.length === 1 ? "" : "s"}</div>
        </div>
        <button class="queueTrash" data-remove="${index}" title="Remove queued split" aria-label="Remove queued split">🗑</button>
      </div>
    `;
    row.querySelector("button").onclick = () => {
      pendingQueue.splice(index, 1);
      renderPendingQueue();
    };
    pendingQueueDiv.appendChild(row);
  });

  alignRegionsPanelToJobs();
}

async function startSplitJob(payload) {
  const res = await fetch("/api/split", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      path: payload.path,
      regions: payload.regions,
      show: payload.show,
      season: payload.season,
      start_episode: payload.start_episode
    })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.detail || `Split failed for ${payload.displayName}`);
    return null;
  }

  activeJobs.add(data.job_id);
  renderJob(data.job_id, {
    status: "queued",
    progress: 0,
    message: `Queued: ${payload.displayName}`
  });

  return data.job_id;
}

async function runQueue() {
  if (!pendingQueue.length) return alert("There are no queued splits.");

  const toRun = [...pendingQueue];
  pendingQueue = [];
  renderPendingQueue();

  splitStatusMode = "queue";
  splitTrackedJobIds = new Set();
  splitCompletionShown = false;
  statusPill.textContent = "Starting Split Job Queue";

  // Submit quickly; backend starts each job in its own worker thread.
  for (const payload of toRun) {
    const jobId = await startSplitJob(payload);
    if (jobId) splitTrackedJobIds.add(jobId);
  }

  if (splitTrackedJobIds.size) {
    statusPill.textContent = "Split Job Queue Running";
  }
}

function clearQueue() {
  pendingQueue = [];
  renderPendingQueue();
  statusPill.textContent = "Queue cleared";
}

function renderJob(id, job) {
  let row = document.getElementById("job-" + id);
  if (!row) {
    row = document.createElement("div");
    row.className = "jobRow";
    row.id = "job-" + id;
    jobsDiv.prepend(row);
  }
  row.innerHTML = `
    <b>${job.status || "unknown"}</b>
    <div class="small">${escapeHtml(job.message || "")}</div>
    <div class="progressOuter"><div class="progressInner" style="width:${job.progress || 0}%">${job.progress || 0}%</div></div>
    ${job.outputs && job.outputs.length ? `<div class="small">Outputs: ${job.outputs.length}</div>` : ""}
    ${job.error ? `<div class="small">Error: ${escapeHtml(job.error)}</div>` : ""}
  `;
}

async function pollJobs() {
  let trackedStillRunning = false;
  let trackedFinishedCount = 0;
  let trackedFailedCount = 0;

  for (const id of Array.from(activeJobs)) {
    const res = await fetch("/api/jobs/" + id);
    const job = await res.json();
    renderJob(id, job);

    if (splitTrackedJobIds.has(id)) {
      if (["queued", "running"].includes(job.status)) {
        trackedStillRunning = true;
      }
      if (job.status === "finished") {
        trackedFinishedCount += 1;
      }
      if (["failed", "unknown"].includes(job.status)) {
        trackedFailedCount += 1;
      }
    }

    if (["finished", "failed", "unknown"].includes(job.status)) {
      activeJobs.delete(id);
    }
  }

  if (splitStatusMode && splitTrackedJobIds.size && !splitCompletionShown) {
    const doneCount = trackedFinishedCount + trackedFailedCount;

    if (trackedStillRunning) {
      statusPill.textContent = splitStatusMode === "queue" ? "Split Job Queue Running" : "Split Job Running";
    } else if (doneCount >= splitTrackedJobIds.size) {
      if (trackedFailedCount > 0) {
        statusPill.textContent = splitStatusMode === "queue" ? "Split Job Queue Finished With Errors" : "Split Job Finished With Errors";
      } else {
        statusPill.textContent = splitStatusMode === "queue" ? "Split Job Queue Finished" : "Split Job Finished";
      }
      splitCompletionShown = true;
    }
  }
}


function openSettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) {
    console.warn("Cutarr settings overlay was not found.");
    return false;
  }

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  loadSettings();
  return false;
}

function closeSettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return false;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  return false;
}

async function loadSettings() {
  if (!cacheCleanupDaysInput) return;

  try {
    const res = await fetch("/api/settings", {cache: "no-store"});
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Failed to load settings");

    cacheCleanupDaysInput.value = data.cache_cleanup_days ?? 1;

    if (defaultSplitTitlesCreditsInput) {
      defaultSplitTitlesCreditsInput.checked = data.default_split_titles_credits !== false;
    }

    if (defaultFastPreviewNoAudioInput) {
      defaultFastPreviewNoAudioInput.checked = data.default_fast_preview_no_audio === true;
    }

    const splitTitlesCredits = document.getElementById("splitTitlesCredits");
    if (splitTitlesCredits) {
      splitTitlesCredits.checked = data.default_split_titles_credits !== false;
    }

    if (fastPreviewNoAudio) {
      fastPreviewNoAudio.checked = data.default_fast_preview_no_audio === true;
    }

    if (settingsStatus) settingsStatus.textContent = "";
  } catch (err) {
    if (settingsStatus) settingsStatus.textContent = "Failed to load settings.";
    console.error("Settings load failed:", err);
  }
}

async function saveSettings() {
  if (!cacheCleanupDaysInput) return;

  const days = Number(cacheCleanupDaysInput.value || 1);
  const defaultSplitTitlesCredits = defaultSplitTitlesCreditsInput ? defaultSplitTitlesCreditsInput.checked : true;
  const defaultFastPreviewNoAudio = defaultFastPreviewNoAudioInput ? defaultFastPreviewNoAudioInput.checked : false;

  try {
    if (settingsStatus) settingsStatus.textContent = "Saving settings...";

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        cache_cleanup_days: days,
        default_split_titles_credits: defaultSplitTitlesCredits,
        default_fast_preview_no_audio: defaultFastPreviewNoAudio
      })
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Failed to save settings");

    cacheCleanupDaysInput.value = data.settings.cache_cleanup_days;

    if (defaultSplitTitlesCreditsInput) {
      defaultSplitTitlesCreditsInput.checked = data.settings.default_split_titles_credits !== false;
    }

    if (defaultFastPreviewNoAudioInput) {
      defaultFastPreviewNoAudioInput.checked = data.settings.default_fast_preview_no_audio === true;
    }

    const splitTitlesCredits = document.getElementById("splitTitlesCredits");
    if (splitTitlesCredits) {
      splitTitlesCredits.checked = data.settings.default_split_titles_credits !== false;
    }

    if (fastPreviewNoAudio) {
      const oldValue = fastPreviewNoAudio.checked;
      fastPreviewNoAudio.checked = data.settings.default_fast_preview_no_audio === true;
      if (currentPath && oldValue !== fastPreviewNoAudio.checked) {
        selectFile(currentPath);
      }
    }

    if (settingsStatus) {
      const deleted = data.cleanup ? data.cleanup.deleted_files : 0;
      settingsStatus.textContent = `Settings saved. Cache cleanup removed ${deleted} old file${deleted === 1 ? "" : "s"}.`;
    }
  } catch (err) {
    if (settingsStatus) settingsStatus.textContent = "Failed to save settings.";
    console.error("Settings save failed:", err);
  }
}

async function cleanCacheNow() {
  try {
    if (settingsStatus) settingsStatus.textContent = "Cleaning cache...";

    const res = await fetch("/api/cache/cleanup", {method: "POST"});
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Failed to clean cache");

    if (settingsStatus) {
      settingsStatus.textContent = `Cache cleanup removed ${data.deleted_files} old file${data.deleted_files === 1 ? "" : "s"}.`;
    }
  } catch (err) {
    if (settingsStatus) settingsStatus.textContent = "Failed to clean cache.";
    console.error("Cache cleanup failed:", err);
  }
}


async function changeAdminPassword() {
  if (!currentAdminPasswordInput || !newAdminPasswordInput || !confirmAdminPasswordInput) return;

  const currentPassword = currentAdminPasswordInput.value || "";
  const newPassword = newAdminPasswordInput.value || "";
  const confirmPassword = confirmAdminPasswordInput.value || "";

  if (newPassword.length < 6) {
    if (passwordStatus) passwordStatus.textContent = "New password must be at least 6 characters long.";
    return;
  }

  if (newPassword !== confirmPassword) {
    if (passwordStatus) passwordStatus.textContent = "New passwords do not match.";
    return;
  }

  try {
    if (passwordStatus) passwordStatus.textContent = "Changing password...";

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || "Password change failed.");
    }

    currentAdminPasswordInput.value = "";
    newAdminPasswordInput.value = "";
    confirmAdminPasswordInput.value = "";

    if (passwordStatus) passwordStatus.textContent = "Admin password changed.";
  } catch (err) {
    if (passwordStatus) passwordStatus.textContent = err.message || "Password change failed.";
    console.error("Password change failed:", err);
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", {method: "POST"});
  } catch (err) {
    console.warn("Logout request failed:", err);
  }

  window.location.href = "/login";
}

async function cleanupCacheOnPageLoad() {
  try {
    const res = await fetch("/api/cache/cleanup", {method: "POST"});
    const data = await res.json();
    if (res.ok && data.deleted_files > 0) {
      console.log(`Cutarr cache cleanup removed ${data.deleted_files} old file(s).`);
    }
  } catch (err) {
    console.warn("Cutarr cache cleanup skipped:", err);
  }
}


function tightenContentCards() {
  const playerCard = document.querySelector(".playerCard");
  const timelineCard = document.querySelector(".timelineCard");
  const editorPane = document.querySelector(".editorPane");
  const videoShell = document.querySelector(".videoShell");
  const waveformBox = document.getElementById("waveform");

  if (editorPane) {
    editorPane.style.setProperty("grid-template-rows", "max-content max-content max-content", "important");
    editorPane.style.setProperty("grid-auto-rows", "max-content", "important");
    editorPane.style.setProperty("align-items", "start", "important");
    editorPane.style.setProperty("align-content", "start", "important");
  }

  [playerCard, timelineCard].forEach(card => {
    if (!card) return;
    card.style.setProperty("align-self", "start", "important");
    card.style.setProperty("height", "fit-content", "important");
    card.style.setProperty("min-height", "unset", "important");
    card.style.setProperty("max-height", "none", "important");
    card.style.setProperty("padding-bottom", "8px", "important");
    card.style.setProperty("overflow", "visible", "important");
  });

  if (playerCard) {
    playerCard.style.setProperty("display", "block", "important");
  }

  if (timelineCard) {
    timelineCard.style.setProperty("display", "block", "important");
  }

  if (videoShell) {
    videoShell.style.setProperty("flex", "none", "important");
    videoShell.style.setProperty("min-height", "0", "important");
    videoShell.style.setProperty("max-height", "365px", "important");
  }

  if (waveformBox) {
    waveformBox.style.setProperty("flex", "none", "important");
    waveformBox.style.setProperty("height", "116px", "important");
    waveformBox.style.setProperty("min-height", "116px", "important");
    waveformBox.style.setProperty("max-height", "116px", "important");
  }

  centerWaveformCanvas();
}



function centerWaveformCanvas() {
  const waveformBox = document.getElementById("waveform");
  if (!waveformBox) return;

  waveformBox.style.setProperty("display", "flex", "important");
  waveformBox.style.setProperty("align-items", "center", "important");
  waveformBox.style.setProperty("overflow", "hidden", "important");

  Array.from(waveformBox.children).forEach(child => {
    child.style.setProperty("width", "100%", "important");
    child.style.setProperty("flex", "0 0 auto", "important");
    child.style.setProperty("margin-top", "auto", "important");
    child.style.setProperty("margin-bottom", "auto", "important");
  });
}

function alignRegionsPanelToJobs() {
  const regionsPanel = document.querySelector(".regionsPanel");
  const regionsListEl = document.getElementById("regionsList");
  const sectionTitle = regionsPanel ? regionsPanel.querySelector(".sectionTitle") : null;
  const jobsPanel = document.querySelector(".jobsPanel");

  if (!regionsPanel || !regionsListEl || !jobsPanel) return;

  requestAnimationFrame(() => {
    const regionsRect = regionsPanel.getBoundingClientRect();
    const jobsRect = jobsPanel.getBoundingClientRect();

    // Match the bottom of the Regions panel to the bottom of the Queued Splits / Jobs panel.
    const currentHeight = Math.ceil(regionsPanel.offsetHeight || regionsRect.height || 0);
    const targetHeight = Math.max(currentHeight, Math.ceil(jobsRect.bottom - regionsRect.top));

    if (targetHeight < 240) return;

    regionsPanel.style.setProperty("height", `${targetHeight}px`, "important");
    regionsPanel.style.setProperty("min-height", `${targetHeight}px`, "important");
    regionsPanel.style.setProperty("max-height", `${targetHeight}px`, "important");
    regionsPanel.style.setProperty("display", "flex", "important");
    regionsPanel.style.setProperty("flex-direction", "column", "important");
    regionsPanel.style.setProperty("overflow", "hidden", "important");

    // Size the inner list directly from the same target height. This avoids the
    // old CSS max-height/min-height rules leaving the list short inside a tall panel.
    const panelStyles = window.getComputedStyle(regionsPanel);
    const titleHeight = sectionTitle ? sectionTitle.offsetHeight : 0;
    const paddingTop = parseFloat(panelStyles.paddingTop || "0");
    const paddingBottom = parseFloat(panelStyles.paddingBottom || "0");
    const gap = 10;
    const available = Math.max(140, targetHeight - titleHeight - paddingTop - paddingBottom - gap);

    regionsListEl.style.setProperty("height", `${available}px`, "important");
    regionsListEl.style.setProperty("min-height", `${available}px`, "important");
    regionsListEl.style.setProperty("max-height", `${available}px`, "important");
    regionsListEl.style.setProperty("flex", "1 1 auto", "important");
    regionsListEl.style.setProperty("overflow-y", "auto", "important");
    regionsListEl.style.setProperty("overflow-x", "hidden", "important");
  });
}

function alignLayoutPanels() {
  tightenContentCards();
  alignRegionsPanelToJobs();
  setTimeout(alignRegionsPanelToJobs, 80);
}

document.getElementById("addSplit").onclick = addSplitAtPlayhead;
document.getElementById("prevSplitPoint").onclick = () => goToSplitPoint(-1);
document.getElementById("deleteCurrentSplitPoint").onclick = deleteCurrentSplitPoint;
document.getElementById("nextSplitPoint").onclick = () => goToSplitPoint(1);
document.getElementById("detectCombined").onclick = () => detect("combined");
document.getElementById("detectSilence").onclick = () => detect("silence");
document.getElementById("detectBlack").onclick = () => detect("black");
document.getElementById("clearRegions").onclick = () => { if (wsRegions) wsRegions.clearRegions(); includedRegionIds = new Map(); regionLabels = new Map(); renderRegions(); };
document.getElementById("splitNowButton").onclick = splitNow;
document.getElementById("splitButton").onclick = queueCurrentSplit;
document.getElementById("runQueueButton").onclick = runQueue;
document.getElementById("clearQueueButton").onclick = clearQueue;
document.getElementById("frameBack").onclick = () => stepFrame(-1);
document.getElementById("frameForward").onclick = () => stepFrame(1);
document.getElementById("zoom").addEventListener("input", applyWaveformZoom);
document.getElementById("startEpisode").addEventListener("input", renderRegions);
document.getElementById("startEpisode").addEventListener("change", renderRegions);
document.getElementById("startEpisode").addEventListener("keyup", renderRegions);
document.getElementById("showName").addEventListener("input", renderPreviewNames);
document.getElementById("season").addEventListener("input", renderPreviewNames);
search.oninput = renderFiles;

restoreFastPreviewSetting();
attachFastPreviewSettingHandler();


if (settingsMenuButton) {
  settingsMenuButton.addEventListener("click", openSettings);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest && event.target.closest("#settingsMenuButton");
  if (button) openSettings(event);
});

if (settingsCloseButton) {
  settingsCloseButton.addEventListener("click", closeSettings);
}

if (settingsOverlay) {
  settingsOverlay.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) closeSettings(event);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsOverlay && !settingsOverlay.classList.contains("hidden")) {
    closeSettings(event);
  }
});

if (saveSettingsButton) saveSettingsButton.onclick = saveSettings;
if (cleanCacheNowButton) cleanCacheNowButton.onclick = cleanCacheNow;
if (changePasswordButton) changePasswordButton.onclick = changeAdminPassword;
if (logoutButton) logoutButton.onclick = logout;
if (topLogoutButton) topLogoutButton.onclick = logout;

setInterval(pollJobs, 1000);
updateFrameCounter();
if (zoomDisplay) zoomDisplay.textContent = "Fit";
renderPreviewNames();
renderPendingQueue();
updateStorage();
cleanupCacheOnPageLoad();
loadSettings();
alignLayoutPanels();
window.addEventListener("resize", alignLayoutPanels);
browse("").catch(err => console.error("Initial browse failed:", err));
