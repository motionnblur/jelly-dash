/**
 * ui/UIManager.js
 * Handles UI interactions, updates, and events.
 */
export class UIManager {
  constructor() {
    this.coinValueEl = document.getElementById("coin-value");
    this.healthValueEl = document.getElementById("health-value");
    this.healthFillEl = document.getElementById("health-fill");
    this.healthPanelEl = document.querySelector(".health-panel");
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

  /**
   * Updates the gel health bar based on the player's current gel mass.
   * @param {number} gelMass
   */
  updateHealth(gelMass) {
    const clamped = Math.max(0, Math.min(1, gelMass));
    const percent = Math.round(clamped * 100);

    if (this.healthValueEl) {
      this.healthValueEl.innerText = `${percent}%`;
    }

    if (this.healthFillEl) {
      this.healthFillEl.style.width = `${percent}%`;
      const isCritical = percent <= 35;
      this.healthFillEl.dataset.critical = isCritical ? "true" : "false";
      if (this.healthPanelEl) {
        this.healthPanelEl.classList.toggle("is-critical", isCritical);
      }
      if (this.healthValueEl) {
        this.healthValueEl.classList.toggle("is-critical", isCritical);
      }
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
