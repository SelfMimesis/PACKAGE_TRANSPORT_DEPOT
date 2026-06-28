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

const homeScreen = document.querySelector("#homeScreen");
const videoScreen = document.querySelector("#videoScreen");
const videoFrame = document.querySelector("#videoFrame");
const idleVideo = document.querySelector("#idleVideo");
const activeVideo = document.querySelector("#activeVideo");
const brightnessOverlay = document.querySelector("#brightnessOverlay");
const brightnessTarget = document.querySelector("#brightnessTarget");
const brightnessRange = document.querySelector("#brightnessRange");
const brightnessValue = document.querySelector("#brightnessValue");
const fullscreenButton = document.querySelector("#fullscreenButton");
const homeButton = document.querySelector("#homeButton");
const CROSSFADE_MS = 200;
const SEEK_TIMEOUT_MS = 1000;
const FRAME_TIMEOUT_MS = 1500;
const DEFAULT_BRIGHTNESS = 100;
const BRIGHTNESS_STORAGE_KEY = "package-transport-depot-brightness";

let currentExperience = null;
let currentExperienceId = null;
let currentButton = null;
let showingActive = false;
let isSwitching = false;
let brightnessLevels = loadBrightnessLevels();

syncBrightnessControl();

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

brightnessTarget.addEventListener("change", () => {
  syncBrightnessControl();
});

brightnessRange.addEventListener("input", () => {
  setBrightness(brightnessTarget.value, brightnessRange.value);
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

  selectBrightnessTarget(experienceId);
  applyBrightnessOverlay(experienceId);

  videoFrame.dataset.family = experience.family;
  videoFrame.dataset.experience = experienceId;

  prepareVideo(idleVideo, experience.idle);
  prepareVideo(activeVideo, experience.active);
  setVideoLayer("idle", { instant: true });

  homeScreen.classList.add("is-hidden");
  videoScreen.classList.remove("is-hidden");
  document.body.classList.add("is-playing");

  requestAnimationFrame(() => {
    playVideo(idleVideo);
    playVideo(activeVideo);
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
        await setVideoLayer("idle");
      }
    } else {
      await seekVideo(activeVideo, 0);
      await playVideo(activeVideo);
      if (await waitForDrawableFrame(activeVideo)) {
        await setVideoLayer("active");
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

function setVideoLayer(mode, options = {}) {
  const target = mode === "active" ? activeVideo : idleVideo;
  const previous = mode === "active" ? idleVideo : activeVideo;
  const isInstant = Boolean(options.instant);

  showingActive = mode === "active";

  target.classList.remove("is-current", "is-next", "is-visible");
  previous.classList.remove("is-next", "is-visible");

  if (isInstant) {
    previous.classList.remove("is-current");
    target.classList.add("is-current");
    return Promise.resolve();
  }

  previous.classList.add("is-current");
  target.classList.add("is-next");
  target.offsetWidth;

  return new Promise((resolve) => {
    let resolved = false;
    let timer = 0;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      window.clearTimeout(timer);
      target.removeEventListener("transitionend", handleTransitionEnd);
      target.classList.remove("is-next", "is-visible");
      target.classList.add("is-current");
      previous.classList.remove("is-current");
      resolve();
    };

    const handleTransitionEnd = (event) => {
      if (event.target === target && event.propertyName === "opacity") {
        finish();
      }
    };

    timer = window.setTimeout(finish, CROSSFADE_MS + 80);
    target.addEventListener("transitionend", handleTransitionEnd);

    requestAnimationFrame(() => {
      target.classList.add("is-visible");
    });
  });
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

function selectBrightnessTarget(experienceId) {
  if (brightnessTarget.value !== experienceId) {
    brightnessTarget.value = experienceId;
  }

  syncBrightnessControl();
}

function syncBrightnessControl() {
  const experienceId = brightnessTarget.value;
  const brightness = getBrightness(experienceId);

  brightnessRange.value = String(brightness);
  brightnessValue.textContent = `${brightness}%`;
}

function setBrightness(experienceId, value) {
  const brightness = clampBrightness(value);

  brightnessLevels = {
    ...brightnessLevels,
    [experienceId]: brightness,
  };

  saveBrightnessLevels();

  if (brightnessTarget.value === experienceId) {
    brightnessRange.value = String(brightness);
    brightnessValue.textContent = `${brightness}%`;
  }

  if (currentExperienceId === experienceId) {
    applyBrightnessOverlay(experienceId);
  }
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

function waitForDrawableFrame(video) {
  if (video.readyState >= 2) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve(true));
    });
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
      video.removeEventListener("error", fail);
      resolve(false);
    };

    timer = window.setTimeout(finish, FRAME_TIMEOUT_MS);
    video.addEventListener("loadeddata", finish);
    video.addEventListener("canplay", finish);
    video.addEventListener("error", fail);
  });
}

async function syncIdleToActive() {
  if (!Number.isFinite(idleVideo.duration) || idleVideo.duration <= 0) {
    return;
  }

  const targetTime = activeVideo.currentTime % idleVideo.duration;
  await seekVideo(idleVideo, targetTime);
}

function closeExperience() {
  if (!currentExperience) {
    return;
  }

  resetVideo(idleVideo);
  resetVideo(activeVideo);
  setVideoLayer("idle", { instant: true });

  currentExperience = null;
  currentExperienceId = null;
  showingActive = false;
  isSwitching = false;

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
