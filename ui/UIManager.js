/**
 * ui/UIManager.js
 * Handles UI interactions, updates, and events.
 */
export class UIManager {
  constructor() {
    this.coinValueEl = document.getElementById("coin-value");
    this.loadingEl = document.getElementById("loading");
    this.gameOverEl = document.getElementById("game-over");
    this.retryBtn = document.getElementById("retry-btn");

    if (this.retryBtn) {
      this.retryBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }
  }

  /**
   * Updates the displayed coin count.
   * @param {number} count 
   */
  updateCoinCount(count) {
    if (this.coinValueEl) {
      this.coinValueEl.innerText = count.toString();
    }
  }

  showGameOver() {
    if (this.gameOverEl) {
      this.gameOverEl.style.display = "flex";
    }
  }

  /**
   * Hides and removes the loading overlay.
   */
  removeLoadingScreen() {
    if (this.loadingEl) {
      this.loadingEl.style.opacity = 0;
      setTimeout(() => {
        this.loadingEl.remove();
        this.loadingEl = null;
      }, 500);
    }
  }
}

export const uiManager = new UIManager();
