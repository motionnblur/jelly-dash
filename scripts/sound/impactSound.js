const IMPACT_SOUND_URL = new URL(
  "../../assets/sounds/impact-sound.mp3",
  import.meta.url,
).href;

export function createImpactSoundController(soundConfig = {}) {
  const impactSound = new Audio(IMPACT_SOUND_URL);
  impactSound.preload = "auto";
  impactSound.volume = soundConfig.impact?.volume ?? 0.75;

  let enabled = true;

  function play() {
    if (!enabled) return;
    try {
      impactSound.currentTime = 0;
      const playback = impactSound.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
  }

  function setVolume(v) {
    impactSound.volume = v;
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
