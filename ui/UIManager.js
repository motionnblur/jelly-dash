/**
 * ui/UIManager.js
 * Handles UI interactions, updates, and events.
 */
export class UIManager {
  constructor() {
    this.coinValueEl = document.getElementById("coin-value");
    this.loadingEl = document.getElementById("loading");
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
