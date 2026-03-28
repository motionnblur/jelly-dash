const JUMP_SOUND_URL = new URL(
  "../../assets/sounds/jump-sound.mp3",
  import.meta.url,
).href;

export function createJumpSoundController(soundConfig = {}) {
  const jumpSound = new Audio(JUMP_SOUND_URL);
  jumpSound.preload = "metadata";
  jumpSound.volume = soundConfig.jump?.volume ?? 0.75;

  let enabled = true;

  function play() {
    if (!enabled) return;
    try {
      jumpSound.currentTime = 0;
      const playback = jumpSound.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    } catch {
      // Ignore transient playback failures when the browser blocks audio.
    }
  }

  function setVolume(v) {
    jumpSound.volume = v;
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
