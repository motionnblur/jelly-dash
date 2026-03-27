const JUMP_SOUND_URL = new URL(
  "../../assets/sounds/jump-sound.mp3",
  import.meta.url,
).href;

export function createJumpSoundController(soundConfig = {}) {
  const volume = soundConfig.jump?.volume ?? 0.75;
  const jumpSound = new Audio(JUMP_SOUND_URL);
  jumpSound.preload = "auto";
  jumpSound.volume = volume;

  function play() {
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

  return {
    play,
  };
}
