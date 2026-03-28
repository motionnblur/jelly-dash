const ROCKET_SOUND_URL = new URL(
  "../../assets/sounds/rocket-sound.mp3",
  import.meta.url,
).href;

export function createRocketSoundController(soundConfig = {}) {
  const rocketSound = new Audio(ROCKET_SOUND_URL);
  rocketSound.preload = "metadata";
  rocketSound.volume = soundConfig.rocket?.volume ?? 0.6;
  rocketSound.loop = true;

  let isPlaying = false;
  let enabled = true;

  function sync(isActive) {
    if (!enabled) {
      if (isPlaying) {
        try {
          rocketSound.pause();
          rocketSound.currentTime = 0;
        } catch {
          // ignore
        }
        isPlaying = false;
      }
      return;
    }

    if (isActive) {
      if (isPlaying) {
        return;
      }

      try {
        rocketSound.currentTime = 0;
        const playback = rocketSound.play();
        if (playback && typeof playback.catch === "function") {
          playback.catch(() => {});
        }
        isPlaying = true;
      } catch {
        // Ignore transient playback failures when the browser blocks audio.
      }
      return;
    }

    if (!isPlaying) {
      return;
    }

    try {
      rocketSound.pause();
      rocketSound.currentTime = 0;
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
    isPlaying = false;
  }

  function destroy() {
    sync(false);
  }

  function setVolume(v) {
    rocketSound.volume = v;
  }

  function setEnabled(val) {
    enabled = val;
    if (!enabled) {
      sync(false);
    }
  }

  return {
    sync,
    destroy,
    setVolume,
    setEnabled,
  };
}
