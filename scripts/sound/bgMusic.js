const BG_MUSIC_URL = new URL(
  "../../assets/sounds/bg-music.mp3",
  import.meta.url,
).href;

export function createBackgroundMusicController(soundConfig = {}) {
  const initialVolume =
    soundConfig.backgroundMusic?.volume ??
    soundConfig.bgMusic?.volume ??
    0.2;
  const bgMusic = new Audio(BG_MUSIC_URL);
  bgMusic.preload = "none";
  bgMusic.volume = initialVolume;
  bgMusic.loop = true;

  let isPlaying = false;
  let enabled = true;
  let baseVolume = initialVolume;
  let hasRequestedLoad = false;

  function play() {
    if (isPlaying || !enabled) {
      return;
    }

    try {
      if (!hasRequestedLoad) {
        hasRequestedLoad = true;
        bgMusic.load();
      }
      const playback = bgMusic.play();
      isPlaying = true;
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {
          isPlaying = false;
        });
      }
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
  }

  function destroy() {
    try {
      bgMusic.pause();
      bgMusic.currentTime = 0;
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
    isPlaying = false;
  }

  function setVolume(v) {
    baseVolume = v;
    if (enabled) {
      bgMusic.volume = v;
    }
  }

  function setEnabled(val) {
    enabled = val;
    if (!enabled) {
      if (isPlaying) {
        try {
          bgMusic.pause();
        } catch {
          // ignore
        }
        isPlaying = false;
      }
    } else {
      bgMusic.volume = baseVolume;
      play();
    }
  }

  return {
    play,
    destroy,
    setVolume,
    setEnabled,
  };
}
