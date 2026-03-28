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
    this.optionsMenuEl = document.getElementById("options-menu");
    this.optionsBackBtn = document.getElementById("options-back-btn");
    this.optBody = document.querySelector(".opt-body");
    this.healthValueEl = document.getElementById("health-value");
    this.healthFillEl = document.getElementById("health-fill");
    this.healthPanelEl = document.querySelector(".health-panel");
    this.levelValueEl = document.getElementById("level-value");
    this.routeTagEl = document.getElementById("route-tag");
    this.minimapSvgEl = document.getElementById("minimap-svg");
    this.minimapPanelEl = document.querySelector(".minimap-panel");
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

    window.addEventListener("keydown", (e) => {
      if (
        (e.code === "Enter" || e.code === "Escape") &&
        this.gameOverEl &&
        this.gameOverEl.style.display === "flex"
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.retryBtn?.click();
      }
    }, true);

    if (this.completeRetryBtn) {
      this.completeRetryBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }

    this.resizeMinimap();
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
      this.healthFillEl.style.height = `${percent}%`;
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
      this.rocketFillEl.style.height = `${percent}%`;
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

  resizeMinimap() {
    const svg = this.minimapSvgEl;
    if (!svg) {
      return;
    }

    const rect = svg.parentElement?.getBoundingClientRect?.() ?? svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 160));
    const height = Math.max(1, Math.round(rect.height || 196));
    svg.dataset.width = String(width);
    svg.dataset.height = String(height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  updateMinimap(levelProfile, platforms = [], playerPosition = null) {
    const svg = this.minimapSvgEl;
    if (!svg) {
      return;
    }

    this.resizeMinimap();

    const width = Number(svg.dataset.width || 160);
    const height = Number(svg.dataset.height || 196);

    const layout = Array.isArray(levelProfile?.layout) ? levelProfile.layout : [];
    if (!layout.length) {
      svg.innerHTML = "";
      return;
    }

    const activeByDef = new Map();
    for (const platform of platforms) {
      if (platform?.definition) {
        activeByDef.set(platform.definition, platform);
      }
    }

    const nodes = layout
      .map((def) => {
        const active = activeByDef.get(def);
        const pos = active?.mesh?.position ?? def;
        return {
          def,
          x: Number(pos?.x),
          y: Number(pos?.y),
          active: !!active,
          final: !!def.isFinal,
        };
      })
      .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));

    if (!nodes.length) {
      return;
    }

    let minX = nodes[0].x;
    let maxX = nodes[0].x;
    let minY = nodes[0].y;
    let maxY = nodes[0].y;

    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }

    const playerX = Number(playerPosition?.x);
    const playerY = Number(playerPosition?.y);
    const playerVisible = Number.isFinite(playerX) && Number.isFinite(playerY);

    const rangeX = Math.max(1, maxX - minX);
    const rangeY = Math.max(1, maxY - minY);
    const pad = 10;
    const innerW = Math.max(1, width - pad * 2);
    const innerH = Math.max(1, height - pad * 2);
    const scale = Math.min(innerW / rangeX, innerH / rangeY);
    const mapW = rangeX * scale;
    const mapH = rangeY * scale;
    const offsetX = (width - mapW) / 2 - minX * scale;
    const offsetY = (height - mapH) / 2 + maxY * scale;

    const project = (x, y) => ({
      x: offsetX + x * scale,
      y: offsetY - y * scale,
    });

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const hexPoints = (x, y, radius) => {
      const points = [];
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI / 3) * index + Math.PI / 6;
        points.push(
          `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`,
        );
      }
      return points.join(" ");
    };

    const trianglePoints = (cx, cy, angle, size) => {
      const tipX = cx + Math.cos(angle) * size;
      const tipY = cy + Math.sin(angle) * size;
      const leftX = cx + Math.cos(angle + Math.PI * 0.72) * size * 0.72;
      const leftY = cy + Math.sin(angle + Math.PI * 0.72) * size * 0.72;
      const rightX = cx + Math.cos(angle - Math.PI * 0.72) * size * 0.72;
      const rightY = cy + Math.sin(angle - Math.PI * 0.72) * size * 0.72;
      return `${tipX.toFixed(2)},${tipY.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`;
    };

    const pathPoints = nodes
      .map((node) => project(node.x, node.y))
      .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(" ");

    const routeLine = nodes.length > 1
      ? `<polyline points="${pathPoints}" fill="none" stroke="rgba(92, 255, 120, 0.48)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`
      : "";

    const grid = [
      `<line x1="${(width / 4).toFixed(2)}" y1="8" x2="${(width / 4).toFixed(2)}" y2="${(height - 8).toFixed(2)}" />`,
      `<line x1="${(width / 2).toFixed(2)}" y1="8" x2="${(width / 2).toFixed(2)}" y2="${(height - 8).toFixed(2)}" />`,
      `<line x1="${((width / 4) * 3).toFixed(2)}" y1="8" x2="${((width / 4) * 3).toFixed(2)}" y2="${(height - 8).toFixed(2)}" />`,
      `<line x1="8" y1="${(height / 4).toFixed(2)}" x2="${(width - 8).toFixed(2)}" y2="${(height / 4).toFixed(2)}" />`,
      `<line x1="8" y1="${(height / 2).toFixed(2)}" x2="${(width - 8).toFixed(2)}" y2="${(height / 2).toFixed(2)}" />`,
      `<line x1="8" y1="${((height / 4) * 3).toFixed(2)}" x2="${(width - 8).toFixed(2)}" y2="${((height / 4) * 3).toFixed(2)}" />`,
    ].join("");

    const nodesMarkup = nodes
      .map((node) => {
        const point = project(node.x, node.y);
        const radius = node.final ? 4.8 : node.active ? 4.0 : 3.2;
        const fill = node.final
          ? "rgba(255, 216, 102, 0.96)"
          : node.active
            ? "rgba(92, 255, 120, 0.96)"
            : "rgba(92, 255, 120, 0.22)";
        const stroke = node.final
          ? "rgba(255, 245, 191, 0.98)"
          : node.active
            ? "rgba(236, 255, 239, 0.98)"
            : "rgba(92, 255, 120, 0.45)";
        return `<polygon points="${hexPoints(point.x, point.y, radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${node.final ? 1.4 : 1}" />`;
      })
      .join("");

    const playerMarkup = playerVisible
      ? (() => {
          const rawPoint = project(playerX, playerY);
          const markerInset = 8;
          const point = {
            x: clamp(rawPoint.x, markerInset, width - markerInset),
            y: clamp(rawPoint.y, markerInset, height - markerInset),
          };
          const playerOutOfBounds =
            Math.abs(rawPoint.x - point.x) > 0.001 || Math.abs(rawPoint.y - point.y) > 0.001;
          const offscreenAngle = playerOutOfBounds
            ? Math.atan2(rawPoint.y - point.y, rawPoint.x - point.x)
            : 0;
          const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.12;
          const offscreenArrow = playerOutOfBounds
            ? `
              <polygon
                points="${trianglePoints(point.x, point.y, offscreenAngle, 6.4)}"
                fill="rgba(255, 90, 90, 0.94)"
                stroke="rgba(15, 4, 4, 0.96)"
                stroke-width="0.9"
              />
            `
            : "";
          return `
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(6.5 * pulse).toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1.1" />
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(4.1 * pulse).toFixed(2)}" fill="rgba(3,9,6,0.9)" stroke="rgba(198,255,214,0.86)" stroke-width="1" />
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(2.5 * pulse).toFixed(2)}" fill="rgba(255, 92, 92, 0.98)" />
            <line x1="${(point.x - 6.5).toFixed(2)}" y1="${point.y.toFixed(2)}" x2="${(point.x + 6.5).toFixed(2)}" y2="${point.y.toFixed(2)}" stroke="rgba(255,255,255,0.45)" stroke-width="0.8" />
            <line x1="${point.x.toFixed(2)}" y1="${(point.y - 6.5).toFixed(2)}" x2="${point.x.toFixed(2)}" y2="${(point.y + 6.5).toFixed(2)}" stroke="rgba(255,255,255,0.45)" stroke-width="0.8" />
            ${offscreenArrow}
          `;
        })()
      : `
        <circle cx="${(width * 0.5).toFixed(2)}" cy="${(height * 0.82).toFixed(2)}" r="6.4" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1" />
        <circle cx="${(width * 0.5).toFixed(2)}" cy="${(height * 0.82).toFixed(2)}" r="3.2" fill="rgba(255, 92, 92, 0.92)" stroke="rgba(3,9,6,0.94)" stroke-width="1" />
      `;

    svg.innerHTML = `
      <defs>
        <linearGradient id="mm-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0.18)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.36)" />
        </linearGradient>
        <linearGradient id="mm-route" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(92,255,120,0.18)" />
          <stop offset="100%" stop-color="rgba(92,255,120,0.08)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#mm-bg)" />
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(92,255,120,0.05)" />
      <g stroke="rgba(92,255,120,0.12)" stroke-width="1">
        ${grid}
      </g>
      ${routeLine}
      <g filter="none">
        ${nodesMarkup}
      </g>
      ${playerMarkup}
    `;

    if (this.minimapPanelEl) {
      this.minimapPanelEl.dataset.hasRoute = nodes.length ? "true" : "false";
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

  showOptions() {
    if (this.optionsMenuEl) {
      this.optionsMenuEl.style.display = "flex";
    }
  }

  hideOptions() {
    if (this.optionsMenuEl) {
      this.optionsMenuEl.style.display = "none";
    }
  }

  setMasterOffDim(isOff) {
    if (this.optBody) {
      this.optBody.classList.toggle("master-off", isOff);
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
