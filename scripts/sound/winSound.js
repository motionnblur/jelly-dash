const WIN_SOUND_URL = new URL(
  "../../assets/sounds/win-sound.mp3",
  import.meta.url,
).href;

export function createWinSoundController(soundConfig = {}) {
  const volume = soundConfig.win?.volume ?? 0.75;
  const winSound = new Audio(WIN_SOUND_URL);
  winSound.preload = "auto";
  winSound.volume = volume;

  function play() {
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

  return {
    play,
  };
}
