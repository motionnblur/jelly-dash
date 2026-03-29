const BUTTON_CLICK_SOUND_URL = new URL(
  "../../assets/sounds/button-click-sound.mp3",
  import.meta.url,
).href;

export function createButtonClickSoundController(soundConfig = {}) {
  const clickSound = new Audio(BUTTON_CLICK_SOUND_URL);
  clickSound.preload = "metadata";
  clickSound.volume = soundConfig.buttonClick?.volume ?? 0.75;

  let enabled = true;

  function play() {
    if (!enabled) return;
    try {
      clickSound.currentTime = 0;
      const playback = clickSound.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
  }

  function setVolume(v) {
    clickSound.volume = v;
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
