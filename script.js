const EXPERIENCES = {
  "t08-1": {
    family: "t08",
    idle: "videos/t08-1-idle.mp4",
    active: "videos/t08-1-active.mp4",
  },
  "t08-2": {
    family: "t08",
    idle: "videos/t08-2-idle.mp4",
    active: "videos/t08-2-active.mp4",
  },
  "t08-3": {
    family: "t08",
    idle: "videos/t08-3-idle.mp4",
    active: "videos/t08-3-active.mp4",
  },
  "t08-4": {
    family: "t08",
    idle: "videos/t08-4-idle.mp4",
    active: "videos/t08-4-active.mp4",
  },
  "t13-1": {
    family: "t13",
    idle: "videos/t13-1-idle.mp4",
    active: "videos/t13-1-active.mp4",
  },
  "t13-2": {
    family: "t13",
    idle: "videos/t13-2-idle.mp4",
    active: "videos/t13-2-active.mp4",
  },
  "t13-3": {
    family: "t13",
    idle: "videos/t13-3-idle.mp4",
    active: "videos/t13-3-active.mp4",
  },
};
const EXPERIENCE_IDS = Object.keys(EXPERIENCES);

const homeScreen = document.querySelector("#homeScreen");
const videoScreen = document.querySelector("#videoScreen");
const videoFrame = document.querySelector("#videoFrame");
const idleVideo = document.querySelector("#idleVideo");
const activeVideo = document.querySelector("#activeVideo");
const brightnessOverlay = document.querySelector("#brightnessOverlay");
const brightnessAll = document.querySelector("#brightnessAll");
const brightnessTargetInputs = Array.from(document.querySelectorAll("[data-brightness-target]"));
const brightnessRange = document.querySelector("#brightnessRange");
const brightnessValue = document.querySelector("#brightnessValue");
const syncStatus = document.querySelector("#syncStatus");
const syncCheckButton = document.querySelector("#syncCheckButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const homeButton = document.querySelector("#homeButton");
const SEEK_TIMEOUT_MS = 1000;
const FRAME_TIMEOUT_MS = 1500;
const DEFAULT_BRIGHTNESS = 100;
const BRIGHTNESS_STORAGE_KEY = "package-transport-depot-brightness";
const SYNC_URL_STORAGE_KEY = "package-transport-depot-sync-url";
const SYNC_TOKEN_STORAGE_KEY = "package-transport-depot-sync-token";
const DEFAULT_RENDER_SYNC_URL = "https://package-transport-depot.onrender.com";
const SYNC_POLL_MS = 700;
const SYNC_PUSH_DEBOUNCE_MS = 120;
const SYNC_TIMEOUT_MS = 2500;

let currentExperience = null;
let currentExperienceId = null;
let currentButton = null;
let showingActive = false;
let isSwitching = false;
let activePrimePromise = Promise.resolve(false);
let brightnessLevels = loadBrightnessLevels();
let syncConfig = loadSyncConfig();
let lastRemoteVersion = 0;
let hasReceivedRemoteState = false;
let pushTimer = 0;
let pendingPushLevels = {};
let isApplyingRemoteState = false;

syncBrightnessControl();
startBrightnessSync();

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-experience]");

  if (!trigger) {
    return;
  }

  openExperience(trigger.dataset.experience, trigger);
});

videoFrame.addEventListener("click", () => {
  toggleVideoState();
});

fullscreenButton.addEventListener("click", (event) => {
  event.stopPropagation();
  enterFullscreen();
});

homeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeExperience();
});

brightnessAll.addEventListener("change", () => {
  setAllBrightnessTargets(brightnessAll.checked);
  syncBrightnessControl();
});

brightnessTargetInputs.forEach((input) => {
  input.addEventListener("change", () => {
    syncBrightnessControl();
  });
});

brightnessRange.addEventListener("input", () => {
  setBrightness(getSelectedBrightnessTargets(), brightnessRange.value);
});

syncCheckButton.addEventListener("click", () => {
  checkSyncConnection();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !currentExperience || document.fullscreenElement) {
    return;
  }

  event.preventDefault();
  closeExperience();
});

function openExperience(experienceId, trigger) {
  const experience = EXPERIENCES[experienceId];

  if (!experience) {
    return;
  }

  currentExperience = experience;
  currentExperienceId = experienceId;
  currentButton = trigger;
  showingActive = false;
  isSwitching = false;
  activePrimePromise = Promise.resolve(false);

  applyBrightnessOverlay(experienceId);

  videoFrame.dataset.family = experience.family;
  videoFrame.dataset.experience = experienceId;

  prepareVideo(idleVideo, experience.idle);
  prepareVideo(activeVideo, experience.active);
  setVideoLayer("idle");

  homeScreen.classList.add("is-hidden");
  videoScreen.classList.remove("is-hidden");
  document.body.classList.add("is-playing");

  requestAnimationFrame(async () => {
    await playVideo(idleVideo);
    activePrimePromise = primeVideoAtStart(activeVideo);
  });
}

async function toggleVideoState() {
  if (!currentExperience || isSwitching) {
    return;
  }

  isSwitching = true;

  try {
    if (showingActive) {
      await syncIdleToActive();
      await playVideo(idleVideo);
      if (await waitForDrawableFrame(idleVideo)) {
        setVideoLayer("idle");
        resetActiveBehindCurrent();
      }
    } else {
      const isActiveReady = await activePrimePromise;

      if (isActiveReady || (await primeVideoAtStart(activeVideo))) {
        setVideoLayer("active");
        await playVideo(activeVideo);
        activePrimePromise = Promise.resolve(false);
      }
    }
  } finally {
    isSwitching = false;
  }
}

function prepareVideo(video, src) {
  video.pause();
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";

  if (video.getAttribute("src") !== src) {
    video.src = src;
  }

  video.load();
}

function setVideoLayer(mode) {
  const target = mode === "active" ? activeVideo : idleVideo;
  const previous = mode === "active" ? idleVideo : activeVideo;

  showingActive = mode === "active";

  target.classList.remove("is-under");
  target.classList.add("is-current");
  previous.classList.remove("is-current");
  previous.classList.add("is-under");
}

function playVideo(video) {
  const playPromise = video.play();

  if (!playPromise) {
    return Promise.resolve();
  }

  return playPromise.catch(() => {
    return Promise.resolve();
  });
}

function seekVideo(video, time) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = 0;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      window.clearTimeout(timer);
      video.removeEventListener("seeked", finish);
      resolve();
    };

    const safeTime = getSafeTime(video, time);

    if (Math.abs(video.currentTime - safeTime) < 0.04) {
      finish();
      return;
    }

    timer = window.setTimeout(finish, SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", finish, { once: true });

    try {
      video.currentTime = safeTime;
    } catch {
      finish();
    }
  });
}

function getSafeTime(video, time) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return Math.max(0, time);
  }

  return Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
}

async function primeVideoAtStart(video) {
  if (!video.getAttribute("src") || video.error) {
    return false;
  }

  video.pause();

  if (!(await waitForMediaData(video))) {
    return false;
  }

  await seekVideo(video, 0);
  return waitForDrawableFrame(video);
}

function resetActiveBehindCurrent() {
  activePrimePromise = (async () => {
    if (!currentExperience || !activeVideo.getAttribute("src")) {
      return false;
    }

    activeVideo.pause();
    await seekVideo(activeVideo, 0);
    return waitForDrawableFrame(activeVideo);
  })().catch(() => false);
}

function syncBrightnessControl() {
  const selectedTargets = getSelectedBrightnessTargets();
  const selectedLevels = selectedTargets.map((experienceId) => getBrightness(experienceId));
  const uniqueLevels = Array.from(new Set(selectedLevels));

  brightnessAll.checked = selectedTargets.length === brightnessTargetInputs.length;
  brightnessAll.indeterminate = selectedTargets.length > 0 && selectedTargets.length < brightnessTargetInputs.length;

  if (selectedTargets.length === 0) {
    brightnessRange.disabled = true;
    brightnessValue.textContent = "--";
    return;
  }

  brightnessRange.disabled = false;

  if (uniqueLevels.length === 1) {
    brightnessRange.value = String(uniqueLevels[0]);
    brightnessValue.textContent = `${uniqueLevels[0]}%`;
    return;
  }

  const averageLevel = Math.round(selectedLevels.reduce((total, level) => total + level, 0) / selectedLevels.length);

  brightnessRange.value = String(averageLevel);
  brightnessValue.textContent = "MIX";
}

function setBrightness(experienceIds, value, options = {}) {
  if (experienceIds.length === 0) {
    return;
  }

  const brightness = clampBrightness(value);
  const nextLevels = { ...brightnessLevels };
  const changedLevels = {};

  experienceIds.forEach((experienceId) => {
    nextLevels[experienceId] = brightness;
    changedLevels[experienceId] = brightness;
  });

  brightnessLevels = nextLevels;

  saveBrightnessLevels();
  brightnessRange.value = String(brightness);
  brightnessValue.textContent = `${brightness}%`;

  if (currentExperienceId && experienceIds.includes(currentExperienceId)) {
    applyBrightnessOverlay(currentExperienceId);
  }

  if (!options.fromRemote) {
    scheduleBrightnessPush(changedLevels);
  }
}

function setAllBrightnessTargets(isChecked) {
  brightnessTargetInputs.forEach((input) => {
    input.checked = isChecked;
  });
}

function getSelectedBrightnessTargets() {
  return brightnessTargetInputs.filter((input) => input.checked).map((input) => input.value);
}

function applyBrightnessOverlay(experienceId) {
  const brightness = getBrightness(experienceId);
  const dimOpacity = (DEFAULT_BRIGHTNESS - brightness) / DEFAULT_BRIGHTNESS;

  brightnessOverlay.style.setProperty("--dim-opacity", dimOpacity.toFixed(2));
}

function getBrightness(experienceId) {
  return clampBrightness(brightnessLevels[experienceId] ?? DEFAULT_BRIGHTNESS);
}

function clampBrightness(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_BRIGHTNESS;
  }

  return Math.min(DEFAULT_BRIGHTNESS, Math.max(0, Math.round(parsed)));
}

function loadBrightnessLevels() {
  try {
    const savedValue = window.localStorage.getItem(BRIGHTNESS_STORAGE_KEY);

    if (!savedValue) {
      return {};
    }

    const parsedValue = JSON.parse(savedValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      return {};
    }

    return parsedValue;
  } catch {
    return {};
  }
}

function saveBrightnessLevels() {
  try {
    window.localStorage.setItem(BRIGHTNESS_STORAGE_KEY, JSON.stringify(brightnessLevels));
  } catch {
    // El prototipo sigue funcionando aunque el navegador bloquee localStorage.
  }
}

function loadSyncConfig() {
  const params = new URLSearchParams(window.location.search);
  const querySyncUrl = params.get("sync");
  const queryToken = params.get("key") || params.get("token");
  const isSyncDisabled = querySyncUrl === "off";
  let apiUrl = "";
  let token = "";

  try {
    if (isSyncDisabled) {
      window.localStorage.removeItem(SYNC_URL_STORAGE_KEY);
    } else if (querySyncUrl) {
      window.localStorage.setItem(SYNC_URL_STORAGE_KEY, querySyncUrl);
    }

    if (queryToken) {
      window.localStorage.setItem(SYNC_TOKEN_STORAGE_KEY, queryToken);
    }

    apiUrl = isSyncDisabled ? "" : window.localStorage.getItem(SYNC_URL_STORAGE_KEY) || DEFAULT_RENDER_SYNC_URL;
    token = window.localStorage.getItem(SYNC_TOKEN_STORAGE_KEY) || "";
  } catch {
    apiUrl = isSyncDisabled ? "" : querySyncUrl || DEFAULT_RENDER_SYNC_URL;
    token = queryToken || "";
  }

  if (params.has("sync") || params.has("key") || params.has("token")) {
    cleanSyncQueryParams(params);
  }

  return {
    apiUrl: normalizeSyncUrl(apiUrl),
    token,
  };
}

function cleanSyncQueryParams(params) {
  if (!window.history.replaceState) {
    return;
  }

  params.delete("sync");
  params.delete("key");
  params.delete("token");

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;

  window.history.replaceState({}, document.title, nextUrl);
}

function normalizeSyncUrl(url) {
  const trimmedUrl = String(url || "").trim();

  if (!trimmedUrl || trimmedUrl === "off") {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    return parsedUrl.origin;
  } catch {
    return "";
  }
}

function startBrightnessSync() {
  if (!syncConfig.apiUrl) {
    setSyncStatus("OFF", "offline");
    return;
  }

  setSyncStatus("SYNC...", "syncing");
  pullBrightnessFromServer();
  window.setInterval(pullBrightnessFromServer, SYNC_POLL_MS);
}

async function checkSyncConnection() {
  if (!syncConfig.apiUrl) {
    setSyncStatus("OFF", "offline");
    return;
  }

  setSyncStatus("CHECK...", "syncing");
  await pullBrightnessFromServer();
}

function scheduleBrightnessPush(levels) {
  if (!syncConfig.apiUrl || isApplyingRemoteState) {
    return;
  }

  pendingPushLevels = {
    ...pendingPushLevels,
    ...levels,
  };

  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(pushBrightnessToServer, SYNC_PUSH_DEBOUNCE_MS);
}

async function pullBrightnessFromServer() {
  if (!syncConfig.apiUrl || isApplyingRemoteState) {
    return;
  }

  try {
    const response = await fetchWithTimeout(getBrightnessEndpoint(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      setSyncStatus("OFFLINE", "offline");
      return;
    }

    const remoteState = await response.json();
    setSyncStatus("ONLINE", "online");

    if (typeof remoteState.version !== "number") {
      return;
    }

    if (hasReceivedRemoteState && remoteState.version === lastRemoteVersion) {
      return;
    }

    hasReceivedRemoteState = true;
    lastRemoteVersion = remoteState.version;
    applyRemoteBrightnessLevels(remoteState.levels);
  } catch {
    setSyncStatus("OFFLINE", "offline");
    // Si Render esta dormido o sin configurar, el control local sigue activo.
  }
}

async function pushBrightnessToServer() {
  if (!syncConfig.apiUrl) {
    return;
  }

  const levelsToPush = { ...pendingPushLevels };

  if (Object.keys(levelsToPush).length === 0) {
    return;
  }

  pendingPushLevels = {};

  try {
    const headers = {
      "Content-Type": "application/json",
    };

    if (syncConfig.token) {
      headers["X-Control-Token"] = syncConfig.token;
    }

    const response = await fetchWithTimeout(getBrightnessEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ levels: levelsToPush }),
    });

    if (!response.ok) {
      setSyncStatus("OFFLINE", "offline");
      pendingPushLevels = {
        ...levelsToPush,
        ...pendingPushLevels,
      };
      return;
    }

    const remoteState = await response.json();
    setSyncStatus("ONLINE", "online");

    if (typeof remoteState.version === "number") {
      hasReceivedRemoteState = true;
      lastRemoteVersion = remoteState.version;
    }
  } catch {
    setSyncStatus("OFFLINE", "offline");
    pendingPushLevels = {
      ...levelsToPush,
      ...pendingPushLevels,
    };
    // Evita bloquear la interfaz si la red o Render no responde.
  }
}

function applyRemoteBrightnessLevels(levels) {
  const remoteLevels = normalizeBrightnessLevels(levels);

  if (Object.keys(remoteLevels).length === 0) {
    return;
  }

  isApplyingRemoteState = true;
  brightnessLevels = {
    ...brightnessLevels,
    ...remoteLevels,
  };

  saveBrightnessLevels();
  syncBrightnessControl();

  if (currentExperienceId) {
    applyBrightnessOverlay(currentExperienceId);
  }

  isApplyingRemoteState = false;
}

function normalizeBrightnessLevels(levels) {
  if (!levels || typeof levels !== "object") {
    return {};
  }

  return Object.entries(levels).reduce((validLevels, [experienceId, value]) => {
    if (!EXPERIENCE_IDS.includes(experienceId)) {
      return validLevels;
    }

    validLevels[experienceId] = clampBrightness(value);
    return validLevels;
  }, {});
}

function getBrightnessEndpoint() {
  return `${syncConfig.apiUrl}/api/brightness`;
}

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    window.clearTimeout(timer);
  });
}

function setSyncStatus(label, state) {
  if (!syncStatus) {
    return;
  }

  syncStatus.textContent = label;
  syncStatus.dataset.state = state;
}

function waitForMediaData(video) {
  if (video.readyState >= 2) {
    return Promise.resolve(true);
  }

  if (video.error) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timer = 0;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      video.removeEventListener("canplaythrough", finish);
      video.removeEventListener("error", fail);
      resolve(video.readyState >= 2 && !video.error);
    };

    const fail = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      video.removeEventListener("canplaythrough", finish);
      video.removeEventListener("error", fail);
      resolve(false);
    };

    timer = window.setTimeout(finish, FRAME_TIMEOUT_MS);
    video.addEventListener("loadeddata", finish);
    video.addEventListener("canplay", finish);
    video.addEventListener("canplaythrough", finish);
    video.addEventListener("error", fail);
  });
}

async function waitForDrawableFrame(video) {
  if (!(await waitForMediaData(video))) {
    return false;
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timer = 0;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      window.clearTimeout(timer);
      resolve(video.readyState >= 2 && !video.error);
    };

    timer = window.setTimeout(finish, FRAME_TIMEOUT_MS);

    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        video.requestVideoFrameCallback(finish);
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } catch {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      }
    } else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  });
}

async function syncIdleToActive() {
  if (!Number.isFinite(idleVideo.duration) || idleVideo.duration <= 0) {
    return;
  }

  const targetTime = activeVideo.currentTime % idleVideo.duration;
  await seekVideo(idleVideo, targetTime);
  await waitForDrawableFrame(idleVideo);
}

function closeExperience() {
  if (!currentExperience) {
    return;
  }

  resetVideo(idleVideo);
  resetVideo(activeVideo);
  setVideoLayer("idle");

  currentExperience = null;
  currentExperienceId = null;
  showingActive = false;
  isSwitching = false;
  activePrimePromise = Promise.resolve(false);

  videoScreen.classList.add("is-hidden");
  homeScreen.classList.remove("is-hidden");
  document.body.classList.remove("is-playing");

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  if (currentButton) {
    currentButton.focus({ preventScroll: true });
  }
}

function resetVideo(video) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function enterFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
    return;
  }

  document.documentElement.requestFullscreen().catch(() => {});
}
