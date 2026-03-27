const WIN_SOUND_URL = new URL(
  "../../assets/sounds/win-sound.mp3",
  import.meta.url,
).href;

export function createWinSoundController(soundConfig = {}) {
  const winSound = new Audio(WIN_SOUND_URL);
  winSound.preload = "auto";
  winSound.volume = soundConfig.win?.volume ?? 0.75;

  let enabled = true;

  function play() {
    if (!enabled) return;
    try {
      winSound.currentTime = 0;
      const playback = winSound.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
  }

  function setVolume(v) {
    winSound.volume = v;
  }

  function setEnabled(val) {
    enabled = val;
  }

  return {
    play,
    setVolume,
    setEnabled,
  };
}
