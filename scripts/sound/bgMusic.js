const BG_MUSIC_URL = new URL(
  "../../assets/sounds/bg-music.mp3",
  import.meta.url,
).href;

export function createBackgroundMusicController() {
  const bgMusic = new Audio(BG_MUSIC_URL);
  bgMusic.preload = "auto";
  bgMusic.volume = 0.2;
  bgMusic.loop = true;

  let isPlaying = false;

  function play() {
    if (isPlaying) {
      return;
    }

    try {
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

  return {
    play,
    destroy,
  };
}
