const ROCKET_SOUND_URL = new URL(
  "../../assets/sounds/rocket-sound.mp3",
  import.meta.url,
).href;

export function createRocketSoundController(soundConfig = {}) {
  const volume = soundConfig.rocket?.volume ?? 0.6;
  const rocketSound = new Audio(ROCKET_SOUND_URL);
  rocketSound.preload = "auto";
  rocketSound.volume = volume;
  rocketSound.loop = true;

  let isPlaying = false;

  function sync(isActive) {
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

  return {
    sync,
    destroy,
  };
}
