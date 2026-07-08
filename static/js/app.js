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
let jobDisplayLabels = new Map();
let splitStatusMode = null; // "single" or "queue"
let splitTrackedJobIds = new Set();
let splitCompletionShown = false;
let activeOperationAbort = null;
let mediaLoadToken = 0;
let folderMode = false;
let folderVideos = [];
let folderIndex = 0;

const fileList = document.getElementById("fileList");
const search = document.getElementById("search");
const video = document.getElementById("video");
const regionsList = document.getElementById("regionsList");
const jobsDiv = document.getElementById("jobs");
const pendingQueueDiv = document.getElementById("pendingQueue");
const queueAllFolderButton = document.getElementById("queueAllFolderButton");
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
const detectFolderCombinedButton = document.getElementById("detectFolderCombined");
const breadcrumbs = document.getElementById("breadcrumbs");
const busyOverlay = document.getElementById("busyOverlay");
const busyTitle = document.getElementById("busyTitle");
const busyText = document.getElementById("busyText");
const busyHint = document.getElementById("busyHint");
const busyCancel = document.getElementById("busyCancel");
const busyProgress = document.getElementById("busyProgress");
const busyProgressFill = document.getElementById("busyProgressFill");
const fastPreviewNoAudio = document.getElementById("fastPreviewNoAudio");
const loadFolderModeButton = document.getElementById("loadFolderModeButton");
const exitFolderModeButton = document.getElementById("exitFolderModeButton");
const folderModeStatus = document.getElementById("folderModeStatus");
const folderNavigator = document.getElementById("folderNavigator");
const prevFolderVideoButton = document.getElementById("prevFolderVideo");
const nextFolderVideoButton = document.getElementById("nextFolderVideo");
const folderVideoLabel = document.getElementById("folderVideoLabel");
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
  setBusyProgress(null);

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

function setBusyProgress(value) {
  if (!busyProgress || !busyProgressFill) return;

  if (value === null || value === undefined) {
    busyProgress.classList.add("hidden");
    busyProgressFill.style.width = "0%";
    return;
  }

  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  busyProgress.classList.remove("hidden");
  busyProgressFill.style.width = `${pct}%`;
}

function hideBusy() {
  busyOverlay.classList.add("hidden");
  setBusyProgress(null);
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

function cleanShowName(raw) {
  return String(raw || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEpisodeInfo(path) {
  const file = path.split("/").pop().replace(/\.[^.]+$/, "");

  // Supports names like:
  // Show.Name.S01E03, Show Name - S01E03, Show_Name_S01_E03,
  // and Show.Name.S01 E03.
  let m = file.match(/^(.*?)[ ._\-]*[Ss](\d{1,2})[ ._\-]*[Ee](\d{1,3})(?:\D|$)/);
  if (m) {
    return {
      show: cleanShowName(m[1]) || "Show Name",
      season: Number(m[2]),
      episode: Number(m[3])
    };
  }

  m = file.match(/^(.*?)[ ._\-]+(\d{1,2})x(\d{1,3})(?:\D|$)/i);
  if (m) {
    return {
      show: cleanShowName(m[1]) || "Show Name",
      season: Number(m[2]),
      episode: Number(m[3])
    };
  }

  return {
    show: cleanShowName(file) || "Show Name",
    season: 1,
    episode: 1
  };
}


function parseSeasonEpisodeSortInfo(name) {
  const m = String(name || "").match(/[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})(?:\D|$)/);
  if (!m) return null;

  return {
    season: Number(m[1]),
    episode: Number(m[2])
  };
}

function sortFolderVideos(files) {
  return [...(files || [])].sort((a, b) => {
    const aInfo = parseSeasonEpisodeSortInfo(a.name);
    const bInfo = parseSeasonEpisodeSortInfo(b.name);

    if (aInfo && bInfo) {
      if (aInfo.season !== bInfo.season) return aInfo.season - bInfo.season;
      if (aInfo.episode !== bInfo.episode) return aInfo.episode - bInfo.episode;
      return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"});
    }

    if (aInfo && !bInfo) return -1;
    if (!aInfo && bInfo) return 1;

    return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"});
  });
}

function currentFolderVideo() {
  if (!folderMode || !Array.isArray(folderVideos) || !folderVideos.length) return null;
  return folderVideos[folderIndex] || null;
}

function syncCurrentFolderVideoState() {
  if (!folderMode || !currentPath || !wsRegions) return;

  const item = folderVideos.find(v => v.path === currentPath);
  if (!item) return;

  item.regions = getRegions(false).map(r => ({
    start: r.start,
    end: r.end,
    label: r.label,
    include: r.include !== false,
  }));
}

function regionsForFolderItem(item) {
  if (!item) return [];

  if (folderMode && item.path === currentPath && wsRegions) {
    return getRegions(false).map(r => ({
      start: r.start,
      end: r.end,
      label: r.label,
      include: r.include !== false,
    }));
  }

  return Array.isArray(item.regions) ? item.regions : [];
}

function checkedRegionCountForFolderItem(item) {
  return regionsForFolderItem(item).filter(r => r.include !== false).length;
}

function folderStartEpisodeForIndex(index) {
  let episode = Number(document.getElementById("startEpisode").value) || 1;

  for (let i = 0; i < index; i += 1) {
    episode += checkedRegionCountForFolderItem(folderVideos[i]);
  }

  return episode;
}

function updateFolderModeUi(refreshFileList = false) {
  const active = folderMode && Array.isArray(folderVideos) && folderVideos.length > 0;

  if (document.body) document.body.classList.toggle("folderModeActive", active);
  if (queueAllFolderButton) queueAllFolderButton.classList.toggle("hidden", !active);

  if (typeof folderNavigator !== "undefined" && folderNavigator) folderNavigator.classList.toggle("hidden", !active);
  if (typeof exitFolderModeButton !== "undefined" && exitFolderModeButton) exitFolderModeButton.classList.toggle("hidden", !folderMode);

  if (typeof folderModeStatus !== "undefined" && folderModeStatus) {
    if (active) {
      folderModeStatus.textContent = `${folderVideos.length} video${folderVideos.length === 1 ? "" : "s"} loaded in Folder Mode.`;
    } else {
      folderModeStatus.textContent = "";
    }
  }

  if (typeof folderVideoLabel !== "undefined" && folderVideoLabel) {
    const item = currentFolderVideo();
    folderVideoLabel.textContent = item
      ? `Video ${folderIndex + 1} of ${folderVideos.length}: ${item.name}`
      : "Folder Mode";
  }

  if (typeof prevFolderVideoButton !== "undefined" && prevFolderVideoButton) prevFolderVideoButton.disabled = !active || folderVideos.length <= 1;
  if (typeof nextFolderVideoButton !== "undefined" && nextFolderVideoButton) nextFolderVideoButton.disabled = !active || folderVideos.length <= 1;

  // Do not redraw the file browser during startup before /api/browse has
  // populated currentListing. That caused the Media Library to stay blank.
  if (refreshFileList && fileList && currentListing && Array.isArray(currentListing.files)) {
    renderFiles();
  }
}

async function loadFolderMode() {
  const files = sortFolderVideos(currentListing.files || []);

  if (!files.length) {
    alert("This folder does not contain supported video files.");
    return;
  }

  const loadAbort = new AbortController();
  activeOperationAbort = loadAbort;
  const previewHasAudio = !useFastPreviewNoAudio();

  showBusy(
    "Loading Folder Mode",
    `Preparing preview and waveform cache for ${files.length} video${files.length === 1 ? "" : "s"}.`,
    previewHasAudio
      ? "Cutarr will build browser previews with audio and waveform data for every video in this folder."
      : "Fast preview is enabled, so Cutarr will build video-only previews and waveform data for every video in this folder.",
    () => {
      loadAbort.abort();
      statusPill.textContent = "Folder load canceled";
      hideBusy();
    }
  );

  folderMode = true;
  folderVideos = files.map((file, index) => ({
    path: file.path,
    name: file.name,
    index,
    info: null,
    regions: [],
    detected: false,
    prepared: false,
    prepareError: null,
  }));
  folderIndex = 0;

  let failedCount = 0;

  try {
    for (let i = 0; i < folderVideos.length; i += 1) {
      if (loadAbort.signal.aborted) throw new DOMException("Operation canceled", "AbortError");

      const item = folderVideos[i];
      const pctStart = (i / folderVideos.length) * 100;

      statusPill.textContent = `Preparing ${i + 1}/${folderVideos.length}`;
      busyTitle.textContent = "Loading Folder Mode";
      busyText.textContent = `Preparing preview/waveform ${i + 1} of ${folderVideos.length}: ${item.name}`;
      busyHint.textContent = "This can take a while the first time. Future folder loads should reuse the cache.";
      setBusyProgress(pctStart);

      try {
        const res = await fetch("/api/prepare-media", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          cache: "no-store",
          signal: loadAbort.signal,
          body: JSON.stringify({
            path: item.path,
            audio: previewHasAudio,
            prepare_preview: true,
            prepare_waveform: true
          })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.detail || "Prepare failed");
        }

        item.info = data;
        item.prepared = true;
        item.prepareError = null;
      } catch (err) {
        if (err && err.name === "AbortError") throw err;

        failedCount += 1;
        item.prepared = false;
        item.prepareError = err.message || String(err);
        console.warn("Folder preview/waveform prepare failed:", item.path, err);

        // Fall back to metadata-only so the file can still be opened manually.
        try {
          const infoRes = await fetch("/api/info?path=" + encodeURIComponent(item.path), {
            cache: "no-store",
            signal: loadAbort.signal
          });
          if (infoRes.ok) item.info = await infoRes.json();
        } catch (infoErr) {
          if (infoErr && infoErr.name === "AbortError") throw infoErr;
          console.warn("Folder metadata fallback failed:", item.path, infoErr);
        }
      }

      setBusyProgress(((i + 1) / folderVideos.length) * 100);
    }

    const firstParsed = parseEpisodeInfo(folderVideos[0].path);
    if (firstParsed.show) document.getElementById("showName").value = firstParsed.show;
    if (firstParsed.season) document.getElementById("season").value = firstParsed.season;
    if (firstParsed.episode) document.getElementById("startEpisode").value = firstParsed.episode;

    hideBusy();
    statusPill.textContent = failedCount
      ? `Folder Mode loaded, ${failedCount} prepare failed`
      : "Folder Mode ready";
    updateFolderModeUi(true);
    loadFolderVideo(0);

    if (failedCount) {
      alert(`${failedCount} video${failedCount === 1 ? "" : "s"} could not be pre-prepared. They may still open, but may take longer when selected.`);
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;

    console.error("Folder Mode load failed:", err);
    statusPill.textContent = "Folder load failed";
    hideBusy();
    alert("Folder Mode load failed. Check container logs.");
  }
}

function exitFolderMode(showStatus = true) {
  syncCurrentFolderVideoState();
  folderMode = false;
  folderVideos = [];
  folderIndex = 0;
  updateFolderModeUi(true);
  renderPreviewNames();
  if (showStatus) statusPill.textContent = "Single File Mode";
}

function loadFolderVideo(index) {
  if (!folderMode || !Array.isArray(folderVideos) || !folderVideos.length) return;

  syncCurrentFolderVideoState();

  if (index < 0) index = folderVideos.length - 1;
  if (index >= folderVideos.length) index = 0;

  folderIndex = index;
  const item = folderVideos[folderIndex];

  updateFolderModeUi(true);
  selectFile(item.path, {
    fromFolder: true,
    preserveNaming: true,
    restoreRegions: item.regions || [],
  });
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
    const isLoadedFolderFile = kind === "file" && folderMode && Array.isArray(folderVideos) && folderVideos.some(v => v.path === path);
    row.className = "fileItem fileItemClickable"
      + (kind === "file" && path === currentPath ? " active" : "")
      + (isLoadedFolderFile ? " folderLoaded" : "");

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

function selectFile(path, options = {}) {
  const fromFolder = options.fromFolder === true;

  if (!fromFolder && folderMode) {
    exitFolderMode(false);
  }

  currentPath = path;
  includedRegionIds = new Map();
  regionLabels = new Map();
  renderFiles();

  const parsed = parseEpisodeInfo(path);
  if (selectedTitle) selectedTitle.textContent = path.split("/").pop();

  if (!fromFolder && !options.preserveNaming) {
    document.getElementById("showName").value = parsed.show || "Show Name";
    document.getElementById("season").value = parsed.season || 1;
    document.getElementById("startEpisode").value = parsed.episode || 1;
  }

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

      if (Array.isArray(options.restoreRegions) && options.restoreRegions.length) {
        rebuildRegionsFromRegionSpecs(options.restoreRegions);
      } else {
        renderRegions();
      }

      if (fromFolder) updateFolderModeUi(false);

      statusPill.textContent = folderMode ? "Folder Video Loaded" : "Media Loaded";
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

  if (folderMode) {
    renderFolderPreviewNames();
    return;
  }

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

function renderFolderPreviewNames() {
  if (!previewNamesList) return;

  syncCurrentFolderVideoState();

  const show = document.getElementById("showName").value;
  const season = Number(document.getElementById("season").value) || 1;
  let episode = Number(document.getElementById("startEpisode").value) || 1;
  let rendered = 0;

  previewNamesList.innerHTML = "";

  folderVideos.forEach((item) => {
    const regions = regionsForFolderItem(item);

    regions.forEach((r, visualIndex) => {
      if (r.include === false) return;

      const color = splitColor(visualIndex);
      const row = document.createElement("div");
      row.className = "previewNameRow";
      row.innerHTML = `
        <span class="previewDot" style="background:${color}"></span>
        <span>
          ${escapeHtml(outputFilename(show, season, episode, r.label))}
          <span class="folderPreviewFile">${escapeHtml(item.name)}</span>
        </span>
      `;
      previewNamesList.appendChild(row);
      episode += 1;
      rendered += 1;
    });
  });

  if (!rendered) {
    previewNamesList.innerHTML = `<p class="small">No checked folder regions yet. Run Detect Loaded Folder or detect the current video.</p>`;
  }
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

  syncCurrentFolderVideoState();
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

  const rebuilt = [];

  if (targetIndex !== -1) {
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
    return;
  }

  // If Auto Detect left a gap with no region at the playhead, allow the user to
  // add a split there. This fills/extends the open span to the next split point
  // or to the beginning/end of the file instead of throwing an error.
  const previousIndex = existingRegions.findLastIndex
    ? existingRegions.findLastIndex(r => r.end < splitTime - tolerance)
    : (() => {
        for (let i = existingRegions.length - 1; i >= 0; i -= 1) {
          if (existingRegions[i].end < splitTime - tolerance) return i;
        }
        return -1;
      })();

  const nextIndex = existingRegions.findIndex(r => r.start > splitTime + tolerance);
  const previous = previousIndex >= 0 ? existingRegions[previousIndex] : null;
  const next = nextIndex >= 0 ? existingRegions[nextIndex] : null;
  const gapStart = previous ? previous.end : 0;
  const gapEnd = next ? next.start : duration;

  if (splitTime <= gapStart + tolerance || splitTime >= gapEnd - tolerance) {
    statusPill.textContent = "Split not added";
    alert("Move the playhead farther from the nearest existing split point before adding a split.");
    return;
  }

  existingRegions.forEach((region, index) => {
    if (previous && index === previousIndex && (region.label || "Episode") === "Episode") {
      // For a normal episode region, extend it up to the new split point.
      rebuilt.push({
        start: region.start,
        end: splitTime,
        label: "Episode",
        include: region.include,
      });
      return;
    }

    rebuilt.push({
      start: region.start,
      end: region.end,
      label: region.label,
      include: region.include,
    });
  });

  if (!previous || (previous.label || "Episode") !== "Episode") {
    rebuilt.push({
      start: gapStart,
      end: splitTime,
      label: "Episode",
      include: true,
    });
  }

  rebuilt.push({
    start: splitTime,
    end: gapEnd,
    label: "Episode",
    include: true,
  });

  rebuildRegionsFromRegionSpecs(rebuilt);
  statusPill.textContent = "Split added";
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
  if (folderMode && Array.isArray(folderVideos) && folderVideos.length) {
    return detectLoadedFolder(mode);
  }

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
    syncCurrentFolderVideoState();
    statusPill.textContent = folderMode ? `Detected ${regions.length} regions for current folder video` : `Detected ${regions.length} regions`;
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


async function detectLoadedFolder(mode = "combined") {
  if (!folderMode || !Array.isArray(folderVideos) || !folderVideos.length) {
    alert("Load a folder first with Folder Mode.");
    return;
  }

  syncCurrentFolderVideoState();

  const detectAbort = new AbortController();
  activeOperationAbort = detectAbort;

  const label = mode === "combined" ? "Auto Detect" : mode === "black" ? "Black Frames Detect" : "Silence Detect";

  const cancelDetect = () => {
    detectAbort.abort();
    statusPill.textContent = "Folder detect canceled";
    hideBusy();
  };

  showBusy(
    `${label} Folder`,
    `Starting ${label.toLowerCase()} for ${folderVideos.length} loaded video${folderVideos.length === 1 ? "" : "s"}.`,
    mode === "combined"
      ? "Intro titles split time and Credits split time are applied to every loaded video if entered."
      : "Cutarr detects each loaded folder video in order. Existing regions for each video are replaced by the new detection results.",
    cancelDetect
  );

  const introHintInput = document.getElementById("introTitlesHint");
  const introHintSeconds = introHintInput ? parseOptionalTimeSeconds(introHintInput.value) : null;
  const creditsHintInput = document.getElementById("creditsSplitHint");
  const creditsHintSeconds = creditsHintInput ? parseOptionalTimeSeconds(creditsHintInput.value) : null;
  let totalRegions = 0;

  try {
    for (let i = 0; i < folderVideos.length; i += 1) {
      if (detectAbort.signal.aborted) throw new DOMException("Operation canceled", "AbortError");

      const item = folderVideos[i];
      statusPill.textContent = `${label} ${i + 1}/${folderVideos.length}`;
      busyText.textContent = `${label} ${i + 1} of ${folderVideos.length}: ${item.name}`;
      setBusyProgress((i / folderVideos.length) * 100);

      const res = await fetch("/api/detect", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        signal: detectAbort.signal,
        body: JSON.stringify({
          path: item.path,
          mode,
          expected_episodes: Number(document.getElementById("expectedEpisodes").value || 2),
          split_titles_credits: document.getElementById("splitTitlesCredits").checked,
          intro_titles_hint_time: introHintSeconds,
          credits_split_hint_time: creditsHintSeconds
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || `Detection failed for ${item.name}`);
      }

      const regions = (data.regions || []).map(r => ({
        start: r.start,
        end: r.end,
        label: r.label || "Episode",
        include: true,
      }));

      item.regions = regions;
      item.detected = true;
      totalRegions += regions.length;

      if (item.path === currentPath) {
        rebuildRegionsFromRegionSpecs(regions);
      }

      setBusyProgress(((i + 1) / folderVideos.length) * 100);
    }

    syncCurrentFolderVideoState();
    renderPreviewNames();
    updateFolderModeUi();
    statusPill.textContent = `${label} folder: ${totalRegions} regions`;
  } catch (err) {
    if (err && err.name === "AbortError") {
      statusPill.textContent = "Folder detect canceled";
      return;
    }

    console.error("Folder detection failed:", err);
    statusPill.textContent = "Folder detect failed";
    alert(err.message || "Folder detection failed. Check container logs.");
  } finally {
    hideBusy();
  }
}

function buildSplitPayload() {
  if (!currentPath) {
    alert("Select a file first.");
    return null;
  }

  syncCurrentFolderVideoState();

  const checked = getRegions(true);
  if (!checked.length) {
    alert("Check at least one region to split.");
    return null;
  }

  const show = document.getElementById("showName").value;
  const season = Number(document.getElementById("season").value);
  const startEpisode = folderMode ? folderStartEpisodeForIndex(folderIndex) : Number(document.getElementById("startEpisode").value);

  return {
    path: currentPath,
    displayName: currentPath.split("/").pop(),
    folderMode,
    folderIndex,
    regions: checked.map(r => ({start: r.start, end: r.end, label: r.label})),
    show,
    season,
    start_episode: startEpisode
  };
}

function payloadEpisodeLabel(payload) {
  const season = String(Number(payload.season) || 1).padStart(2, "0");
  const start = Number(payload.start_episode) || 1;
  const count = Array.isArray(payload.regions) ? payload.regions.length : 0;

  if (count <= 1) {
    return `S${season}E${String(start).padStart(2, "0")}`;
  }

  const end = start + count - 1;
  return `S${season}E${String(start).padStart(2, "0")}-E${String(end).padStart(2, "0")}`;
}

function buildFolderPayloadForItem(item, index) {
  if (!item) return null;

  syncCurrentFolderVideoState();

  const regions = regionsForFolderItem(item).filter(r => r.include !== false);
  if (!regions.length) return null;

  const show = document.getElementById("showName").value;
  const season = Number(document.getElementById("season").value) || 1;
  const startEpisode = folderStartEpisodeForIndex(index);

  return {
    path: item.path,
    displayName: item.name || item.path.split("/").pop(),
    folderMode: true,
    folderIndex: index,
    regions: regions.map(r => ({start: r.start, end: r.end, label: r.label || "Episode"})),
    show,
    season,
    start_episode: startEpisode
  };
}

function queueAllFolderSplits() {
  if (!folderMode || !Array.isArray(folderVideos) || !folderVideos.length) {
    alert("Load a folder first with Folder Mode.");
    return;
  }

  syncCurrentFolderVideoState();

  const payloads = [];
  folderVideos.forEach((item, index) => {
    const payload = buildFolderPayloadForItem(item, index);
    if (payload) payloads.push(payload);
  });

  if (!payloads.length) {
    alert("No checked regions were found in the loaded folder videos.");
    return;
  }

  pendingQueue.push(...payloads);
  renderPendingQueue();
  renderPreviewNames();
  statusPill.textContent = `Queued ${payloads.length} folder video split job${payloads.length === 1 ? "" : "s"}`;
}

function queueCurrentSplit() {
  const payload = buildSplitPayload();
  if (!payload) return;

  pendingQueue.push(payload);
  renderPendingQueue();
  renderPreviewNames();
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
          <div class="small">${escapeHtml(item.show)} ${payloadEpisodeLabel(item)} · ${item.regions.length} region${item.regions.length === 1 ? "" : "s"} · ${escapeHtml(item.displayName)}</div>
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

async function startSplitJob(payload, displayLabel = null) {
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
  const label = displayLabel || `${payloadEpisodeLabel(payload)} · ${payload.displayName}`;
  jobDisplayLabels.set(data.job_id, label);
  renderJob(data.job_id, {
    status: "queued",
    progress: 0,
    message: `Queued: ${payload.displayName}`
  });

  return data.job_id;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJobCompletion(jobId) {
  while (true) {
    const res = await fetch("/api/jobs/" + jobId, {cache: "no-store"});
    const job = await res.json();
    renderJob(jobId, job);

    if (["finished", "failed", "unknown"].includes(job.status)) {
      activeJobs.delete(jobId);
      return job;
    }

    await sleep(1000);
  }
}

async function runQueue() {
  if (!pendingQueue.length) return alert("There are no queued splits.");

  const toRun = [...pendingQueue];
  pendingQueue = [];
  renderPendingQueue();

  splitStatusMode = null;
  splitTrackedJobIds = new Set();
  splitCompletionShown = false;
  statusPill.textContent = "Starting Split Job Queue";

  let finishedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < toRun.length; i += 1) {
    const payload = toRun[i];
    const episodeLabel = payloadEpisodeLabel(payload);
    const displayLabel = `Job ${i + 1} of ${toRun.length} · ${episodeLabel} · ${payload.displayName}`;

    statusPill.textContent = `Splitting job ${i + 1} of ${toRun.length}: ${episodeLabel}`;

    const jobId = await startSplitJob(payload, displayLabel);
    if (!jobId) {
      failedCount += 1;
      continue;
    }

    const job = await waitForJobCompletion(jobId);

    if (job.status === "finished") {
      finishedCount += 1;
    } else {
      failedCount += 1;
    }
  }

  splitCompletionShown = true;
  statusPill.textContent = failedCount
    ? `Split Job Queue Finished With Errors (${finishedCount}/${toRun.length} completed)`
    : "Split Job Queue Finished";
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
    <div class="small">${jobDisplayLabels.has(id) ? `<b>${escapeHtml(jobDisplayLabels.get(id))}</b><br>` : ""}${escapeHtml(job.message || "")}</div>
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
      // Keep the label visible in the completed job row.
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
if (queueAllFolderButton) queueAllFolderButton.onclick = queueAllFolderSplits;
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

if (typeof loadFolderModeButton !== "undefined" && loadFolderModeButton) loadFolderModeButton.onclick = loadFolderMode;
if (typeof exitFolderModeButton !== "undefined" && exitFolderModeButton) exitFolderModeButton.onclick = () => exitFolderMode(true);
if (typeof prevFolderVideoButton !== "undefined" && prevFolderVideoButton) prevFolderVideoButton.onclick = () => loadFolderVideo(folderIndex - 1);
if (typeof nextFolderVideoButton !== "undefined" && nextFolderVideoButton) nextFolderVideoButton.onclick = () => loadFolderVideo(folderIndex + 1);
try {
  updateFolderModeUi(false);
} catch (err) {
  console.warn("Folder Mode UI init failed:", err);
}


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

window.addEventListener("error", (event) => {
  console.error("Cutarr interface error:", event.error || event.message);
  if (statusPill) statusPill.textContent = "Interface error";
});

setInterval(pollJobs, 1000);
try { updateFrameCounter(); } catch (err) { console.error("Frame counter startup failed:", err); }
try { if (zoomDisplay) zoomDisplay.textContent = "Fit"; } catch (err) { console.error("Zoom startup failed:", err); }
try { renderPreviewNames(); } catch (err) { console.error("Preview names startup failed:", err); }
try { renderPendingQueue(); } catch (err) { console.error("Pending queue startup failed:", err); }
updateStorage().catch(err => console.error("Storage update failed:", err));
cleanupCacheOnPageLoad().catch(err => console.error("Startup cache cleanup failed:", err));
loadSettings().catch(err => console.error("Settings load failed:", err));
try { alignLayoutPanels(); } catch (err) { console.error("Layout startup failed:", err); }
window.addEventListener("resize", () => {
  try { alignLayoutPanels(); } catch (err) { console.error("Layout resize failed:", err); }
});
browse("").catch(err => console.error("Initial browse failed:", err));
