/**
 * ui/UIManager.js
 * Handles UI interactions, updates, and events.
 */
export class UIManager {
  constructor() {
    this.pausedEl = document.getElementById("paused");
    this.escMenuEl = document.getElementById("esc-menu");
    this.escRestartBtn = document.getElementById("esc-restart-btn");
    this.escOptionsBtn = document.getElementById("esc-options-btn");
    this.escResumeBtn = document.getElementById("esc-resume-btn");
    this.healthValueEl = document.getElementById("health-value");
    this.healthFillEl = document.getElementById("health-fill");
    this.healthPanelEl = document.querySelector(".health-panel");
    this.levelValueEl = document.getElementById("level-value");
    this.routeTagEl = document.getElementById("route-tag");
    this.loadingEl = document.getElementById("loading");
    this.gameOverEl = document.getElementById("game-over");
    this.gameOverTitleEl = document.getElementById("game-over-title");
    this.gameOverMsgEl = document.getElementById("game-over-msg");
    this.gameCompleteEl = document.getElementById("game-complete");
    this.retryBtn = document.getElementById("retry-btn");
    this.completeRetryBtn = document.getElementById("complete-retry-btn");

    this.rocketValueEl = document.getElementById("rocket-value");
    this.rocketFillEl = document.getElementById("rocket-fill");
    this.rocketPanelEl = document.querySelector(".rocket-panel");
    
    // Cheat Console
    this.consoleEl = document.getElementById("cheat-console");
    this.consoleInputEl = document.getElementById("console-input");
    this.consoleLogEl = document.getElementById("console-log");
    this.consoleBooted = false;

    if (this.consoleInputEl) {
      this.consoleInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.handleConsoleInput();
        }
      });
    }

    if (this.retryBtn) {
      this.retryBtn.addEventListener("click", () => {
        if (window.retryLevel) {
          window.retryLevel();
        } else {
          window.location.reload();
        }
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

  showGameOver(title, message) {
    if (this.gameOverTitleEl && title) {
      this.gameOverTitleEl.innerText = title;
    }
    if (this.gameOverMsgEl && message) {
      this.gameOverMsgEl.innerText = message;
    }
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

  showPaused() {
    if (this.pausedEl) {
      this.pausedEl.style.display = "flex";
    }
  }

  hidePaused() {
    if (this.pausedEl) {
      this.pausedEl.style.display = "none";
    }
  }

  showEscMenu() {
    if (this.escMenuEl) {
      this.escMenuEl.style.display = "flex";
    }
  }

  hideEscMenu() {
    if (this.escMenuEl) {
      this.escMenuEl.style.display = "none";
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

  handleConsoleInput() {
    const input = this.consoleInputEl.value.trim();
    if (input) {
      this.logToConsole(`> ${input}`);
      // Dispatch custom event for Engine to handle commands
      const event = new CustomEvent("cheat-command", { detail: input });
      window.dispatchEvent(event);
      this.consoleInputEl.value = "";
    }
  }

  toggleConsole() {
    if (!this.consoleEl) return;
    const isHidden = this.consoleEl.style.display === "none";
    this.consoleEl.style.display = isHidden ? "flex" : "none";
    if (isHidden) {
      this.consoleInputEl.focus();
      if (!this.consoleBooted) {
        this.logToConsole("Terminal online. Standing by for command.");
        this.consoleBooted = true;
      }
    } else {
      // Clear terminal on close
      if (this.consoleLogEl) this.consoleLogEl.innerHTML = "";
      if (this.consoleInputEl) this.consoleInputEl.value = "";
      this.consoleBooted = false;
    }
  }

  logToConsole(message) {
    if (!this.consoleLogEl) return;
    const div = document.createElement("div");
    div.innerText = message;
    this.consoleLogEl.appendChild(div);
    this.consoleLogEl.scrollTop = this.consoleLogEl.scrollHeight;
  }
}

export const uiManager = new UIManager();
