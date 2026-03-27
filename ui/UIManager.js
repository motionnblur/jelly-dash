/**
 * ui/UIManager.js
 * Handles UI interactions, updates, and events.
 */
export class UIManager {
  constructor() {
    this.healthValueEl = document.getElementById("health-value");
    this.healthFillEl = document.getElementById("health-fill");
    this.healthPanelEl = document.querySelector(".health-panel");
    this.levelValueEl = document.getElementById("level-value");
    this.routeTagEl = document.getElementById("route-tag");
    this.loadingEl = document.getElementById("loading");
    this.gameOverEl = document.getElementById("game-over");
    this.gameCompleteEl = document.getElementById("game-complete");
    this.retryBtn = document.getElementById("retry-btn");
    this.completeRetryBtn = document.getElementById("complete-retry-btn");

    this.rocketValueEl = document.getElementById("rocket-value");
    this.rocketFillEl = document.getElementById("rocket-fill");
    this.rocketPanelEl = document.querySelector(".rocket-panel");

    if (this.retryBtn) {
      this.retryBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }

    if (this.completeRetryBtn) {
      this.completeRetryBtn.addEventListener("click", () => {
        window.location.reload();
      });
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
      this.healthValueEl.innerText = `${percent}`;
    }

    if (this.healthFillEl) {
      this.healthFillEl.style.width = `${percent}%`;
      const isCritical = percent <= 28;
      this.healthFillEl.dataset.critical = isCritical ? "true" : "false";
      if (this.healthPanelEl) {
        this.healthPanelEl.classList.toggle("is-critical", isCritical);
      }
      if (this.healthValueEl) {
        this.healthValueEl.classList.toggle("is-critical", isCritical);
      }
    }
  }

  updateRocket(rocketLevel, isActive) {
    const percent = Math.round(rocketLevel * 100);

    if (this.rocketValueEl) {
      this.rocketValueEl.innerText = `${percent}`;
    }

    if (this.rocketFillEl) {
      this.rocketFillEl.style.width = `${percent}%`;
    }

    if (this.rocketPanelEl) {
      this.rocketPanelEl.classList.toggle("is-active", isActive);
      this.rocketPanelEl.classList.toggle("is-empty", rocketLevel <= 0);
    }
  }

  updateLevel(level, totalLevels, isRespite, label) {
    if (this.levelValueEl) {
      this.levelValueEl.innerText = `${level} / ${totalLevels}`;
    }

    if (this.routeTagEl) {
      this.routeTagEl.innerText = label;
      this.routeTagEl.dataset.respite = isRespite ? "true" : "false";
    }
  }

  showGameOver() {
    if (this.gameOverEl) {
      this.gameOverEl.style.display = "flex";
    }
  }

  hideGameOver() {
    if (this.gameOverEl) {
      this.gameOverEl.style.display = "none";
    }
  }

  showGameComplete() {
    if (this.gameCompleteEl) {
      this.gameCompleteEl.style.display = "flex";
    }
  }

  hideGameComplete() {
    if (this.gameCompleteEl) {
      this.gameCompleteEl.style.display = "none";
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
