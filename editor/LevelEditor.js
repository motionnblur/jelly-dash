import * as THREE from "three";

const SHAPE_DEFAULT_ROTY = { hex: Math.PI / 6, square: Math.PI / 4, triangle: Math.PI / 2 };

const AXIS_COLORS  = { x: 0xff2222, y: 0x22ff44, z: 0x2266ff };
const AXIS_HOVER   = 0xffdd00;
const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const MAX_HISTORY = 60;

function freshPlatformDef(layout) {
  const nonFinals = layout.filter((d) => !d.isFinal);
  const last = nonFinals[nonFinals.length - 1];
  return {
    x: last ? last.x : 0,
    y: last ? last.y + 3.5 : 2,
    z: 0,
    w: 3.2, h: 0.5, d: 3.2,
    color: layout[0]?.color ?? 0x7401ff,
    isFinal: false,
    shape: "hex",
    rotationY: Math.PI / 6,
    isDestroyable: false,
    hitsToBreak: 2,
    bobPhase: 0,
    motionAmplitude: 0, motionSpeed: 1.0,
    swingAmplitude: 0,  swingSpeed: 1.0,
  };
}

// ─── Gizmo builder ────────────────────────────────────────────────────────────

function buildGizmo(scene) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 999;
  scene.add(group);

  const translateMats = {};
  const translateMeshes = [];
  const rotateMeshes = [];

  ["x", "y", "z"].forEach((axis) => {
    const color = AXIS_COLORS[axis];
    const mat   = new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false });
    translateMats[axis]  = mat;

    const axisGroup = new THREE.Group();
    axisGroup.renderOrder = 999;

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), mat);
    shaft.position.y = 0.55;
    shaft.renderOrder = 999;
    shaft.userData.gizmoAxis = axis;
    shaft.userData.gizmoMode = "translate";
    axisGroup.add(shaft);
    translateMeshes.push(shaft);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), mat);
    tip.position.y = 1.24;
    tip.renderOrder = 999;
    tip.userData.gizmoAxis = axis;
    tip.userData.gizmoMode = "translate";
    axisGroup.add(tip);
    translateMeshes.push(tip);

    if (axis === "x") axisGroup.rotation.z = -Math.PI / 2;
    if (axis === "z") axisGroup.rotation.x =  Math.PI / 2;

    group.add(axisGroup);
  });

  const rotateMat = new THREE.MeshBasicMaterial({
    color: AXIS_COLORS.y,
    depthTest: false,
    toneMapped: false,
    transparent: true,
    opacity: 0.9,
  });
  const rotateRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.45, 0.055, 12, 96),
    rotateMat,
  );
  rotateRing.renderOrder = 999;
  rotateRing.rotation.x = Math.PI / 2; // Y-axis ring
  rotateRing.userData.gizmoAxis = "y";
  rotateRing.userData.gizmoMode = "rotate";
  group.add(rotateRing);
  rotateMeshes.push(rotateRing);

  return {
    group,
    translateMats,
    rotateMat,
    translateMeshes,
    rotateMeshes,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function initLevelEditor({
  scene,
  camera,
  renderer,
  platforms,
  pickups,
  levelState,
  gameplayState,
  clock,
  player,
  rebuildCurrentLevelPlatforms,
  buildLevel,
  resetPlayerForTest,
}) {
  let isOpen        = false;
  let isTestMode    = false;
  let selectedIndex = -1;
  let selectedType  = null; // "platform" | "pickup" | null

  // ── History ────────────────────────────────────────────────────────────────
  const history = [];

  function pushHistory() {
    const profile = levelState.currentProfile;
    if (!profile) return;
    history.push({
      layout:  JSON.parse(JSON.stringify(profile.layout)),
      pickups: JSON.parse(JSON.stringify(profile.pickups ?? [])),
    });
    if (history.length > MAX_HISTORY) history.shift();
  }

  function undo() {
    if (history.length === 0) return;
    const snapshot = history.pop();
    if (!levelState.currentProfile) return;

    // Restore layout in-place
    levelState.currentProfile.layout.length = 0;
    for (const d of snapshot.layout) levelState.currentProfile.layout.push(d);

    // Restore pickups in-place
    if (!levelState.currentProfile.pickups) levelState.currentProfile.pickups = [];
    levelState.currentProfile.pickups.length = 0;
    for (const p of snapshot.pickups) levelState.currentProfile.pickups.push(p);

    // Clamp selection to new lengths
    if (selectedType === "platform" && selectedIndex >= levelState.currentProfile.layout.length) {
      clearHighlight();
      selectedIndex = -1;
      selectedType = null;
      gizmo.visible = false;
    } else if (selectedType === "pickup" && selectedIndex >= levelState.currentProfile.pickups.length) {
      clearHighlight();
      selectedIndex = -1;
      selectedType = null;
      gizmo.visible = false;
    }

    // Rebuild (bypass rebuild() to avoid side-effects)
    rebuildCurrentLevelPlatforms();

    // Re-apply selection highlight if still valid
    if (selectedType === "platform" && selectedIndex >= 0 && platforms[selectedIndex]) {
      const mat = platforms[selectedIndex].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    } else if (selectedType === "pickup" && selectedIndex >= 0 && pickups[selectedIndex]) {
      const mat = pickups[selectedIndex].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    }

    renderPlatformList();
    renderPickupList();
    renderProperties();
    placeGizmo();
  }

  // ── Camera / orbit ─────────────────────────────────────────────────────────
  const savedCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const orbit = {
    dragging: false, panning: false, moved: false,
    lastX: 0, lastY: 0,
    theta: 0, phi: 0.42, radius: 22,
    target: new THREE.Vector3(0, 5, 0),
  };

  // ── Gizmo drag ─────────────────────────────────────────────────────────────
  const drag = {
    active: false, axis: null, mode: "translate",
    plane: new THREE.Plane(),
    planeHit: new THREE.Vector3(),
    startPos: new THREE.Vector3(),
    startRotationY: 0,
    startAngle: 0,
  };
  let hoveredAxis = null;
  let transformMode = "translate"; // "translate" | "rotate"

  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();

  // ── Build gizmo ────────────────────────────────────────────────────────────
  const {
    group: gizmo,
    translateMats: gizmoTranslateMats,
    rotateMat: gizmoRotateMat,
    translateMeshes: gizmoTranslateMeshes,
    rotateMeshes: gizmoRotateMeshes,
  } = buildGizmo(scene);

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const fab              = document.getElementById("editor-fab");
  const panel            = document.getElementById("level-editor");
  const closeBtn         = document.getElementById("editor-close-btn");
  const platformListEl   = document.getElementById("editor-platform-list");
  const pickupListEl     = document.getElementById("editor-pickup-list");
  const propertiesEl     = document.getElementById("editor-properties");
  const addBtn           = document.getElementById("editor-add-btn");
  const deleteBtn        = document.getElementById("editor-delete-btn");
  const exportBtn        = document.getElementById("editor-export-btn");
  const undoBtn          = document.getElementById("editor-undo-btn");
  const testBtn          = document.getElementById("editor-test-btn");
  const stopTestBtn      = document.getElementById("editor-stop-test");
  const prevLvlBtn       = document.getElementById("editor-prev-level");
  const nextLvlBtn       = document.getElementById("editor-next-level");
  const levelLabelEl     = document.getElementById("editor-level-label");
  const addHealthPickupBtn = document.getElementById("editor-add-health-btn");
  const addRocketPickupBtn = document.getElementById("editor-add-rocket-btn");

  // ── Game UI elements to hide while editor is open ─────────────────────────
  const gameHudEls = [
    document.getElementById("overlay"),
    document.querySelector(".level-panel"),
    document.getElementById("dev-level-picker"),
  ].filter(Boolean);

  // ── Open / Close ───────────────────────────────────────────────────────────
  function openEditor() {
    isOpen = true;
    gameplayState.isEditorOpen = true;
    gameplayState.isPaused     = true;
    clock.getDelta();

    panel.classList.add("editor-panel--open");
    fab.classList.add("editor-fab--active");
    gameHudEls.forEach((el) => { el.style.display = "none"; });
    if (player) player.visible = false;

    savedCam.pos.copy(camera.position);
    savedCam.quat.copy(camera.quaternion);

    if (platforms.length > 0) {
      let sumY = 0;
      for (const p of platforms) sumY += p.mesh.position.y;
      orbit.target.set(0, sumY / platforms.length + 1, 0);
    }
    const dx = camera.position.x - orbit.target.x;
    const dy = camera.position.y - orbit.target.y;
    const dz = camera.position.z - orbit.target.z;
    orbit.radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    orbit.theta  = Math.atan2(dx, dz);
    orbit.phi    = Math.asin(Math.max(-1, Math.min(1, dy / orbit.radius)));

    refreshLevelLabel();
    renderPlatformList();
    renderPickupList();
    renderProperties();
    syncOrbitCamera();

    renderer.domElement.addEventListener("mousedown",   onMouseDown);
    renderer.domElement.addEventListener("click",       onCanvasClick);
    window.addEventListener("mousemove",               onMouseMove);
    window.addEventListener("mouseup",                 onMouseUp);
    renderer.domElement.addEventListener("wheel",       onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", suppressCtx);
    window.addEventListener("keydown",                 onEditorKeyDown);
  }

  function closeEditor() {
    if (isTestMode) {
      isTestMode = false;
      stopTestBtn.style.display = "none";
    }
    isOpen = false;
    gameplayState.isEditorOpen = false;
    gameplayState.isPaused     = false;
    clock.getDelta();

    panel.classList.remove("editor-panel--open");
    fab.classList.remove("editor-fab--active");
    gameHudEls.forEach((el) => { el.style.display = ""; });
    if (player) player.visible = true;

    clearHighlight();
    selectedIndex = -1;
    selectedType  = null;
    gizmo.visible = false;
    history.length = 0;

    camera.position.copy(savedCam.pos);
    camera.quaternion.copy(savedCam.quat);

    renderer.domElement.removeEventListener("mousedown",   onMouseDown);
    renderer.domElement.removeEventListener("click",       onCanvasClick);
    window.removeEventListener("mousemove",               onMouseMove);
    window.removeEventListener("mouseup",                 onMouseUp);
    renderer.domElement.removeEventListener("wheel",       onWheel);
    renderer.domElement.removeEventListener("contextmenu", suppressCtx);
    window.removeEventListener("keydown",                 onEditorKeyDown);
  }

  function enterTestMode() {
    isTestMode = true;

    // Remove editor input listeners while playing
    renderer.domElement.removeEventListener("mousedown",   onMouseDown);
    renderer.domElement.removeEventListener("click",       onCanvasClick);
    window.removeEventListener("mousemove",               onMouseMove);
    window.removeEventListener("mouseup",                 onMouseUp);
    renderer.domElement.removeEventListener("wheel",       onWheel);
    renderer.domElement.removeEventListener("contextmenu", suppressCtx);
    window.removeEventListener("keydown",                 onEditorKeyDown);

    // Ensure platforms reflect current edits
    rebuildCurrentLevelPlatforms();

    // Reset player to level start
    resetPlayerForTest?.();

    // Hide editor panel and gizmo
    panel.classList.remove("editor-panel--open");
    gizmo.visible = false;

    // Restore gameplay camera and show player + HUD
    camera.position.copy(savedCam.pos);
    camera.quaternion.copy(savedCam.quat);
    if (player) player.visible = true;
    gameHudEls.forEach((el) => { el.style.display = ""; });

    // Resume gameplay
    gameplayState.isEditorOpen = false;
    gameplayState.isPaused     = false;
    clock.getDelta();

    stopTestBtn.style.display = "";
  }

  function exitTestMode() {
    isTestMode = false;

    // Restore platforms (may have been destroyed during test) and reset player
    rebuildCurrentLevelPlatforms();
    resetPlayerForTest?.();

    // Re-pause and restore editor state
    gameplayState.isEditorOpen = true;
    gameplayState.isPaused     = true;
    clock.getDelta();

    // Restore orbital camera
    syncOrbitCamera();

    // Hide player and HUD, show editor panel
    if (player) player.visible = false;
    gameHudEls.forEach((el) => { el.style.display = "none"; });
    panel.classList.add("editor-panel--open");
    placeGizmo();

    stopTestBtn.style.display = "none";

    // Re-add editor input listeners
    renderer.domElement.addEventListener("mousedown",   onMouseDown);
    renderer.domElement.addEventListener("click",       onCanvasClick);
    window.addEventListener("mousemove",               onMouseMove);
    window.addEventListener("mouseup",                 onMouseUp);
    renderer.domElement.addEventListener("wheel",       onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", suppressCtx);
    window.addEventListener("keydown",                 onEditorKeyDown);
  }

  const suppressCtx = (e) => e.preventDefault();
  fab.addEventListener("click",   () => (isOpen ? closeEditor() : openEditor()));
  closeBtn.addEventListener("click", closeEditor);
  testBtn?.addEventListener("click", () => (isTestMode ? exitTestMode() : enterTestMode()));
  stopTestBtn?.addEventListener("click", exitTestMode);

  function resetOrbitCamera() {
    orbit.theta  = 0;
    orbit.phi    = 0.42;
    orbit.radius = 22;
    if (platforms.length > 0) {
      let sumY = 0;
      for (const p of platforms) sumY += p.mesh.position.y;
      orbit.target.set(0, sumY / platforms.length + 1, 0);
    } else {
      orbit.target.set(0, 5, 0);
    }
    syncOrbitCamera();
  }

  function onEditorKeyDown(e) {
    // Don't intercept shortcuts while typing in form controls.
    const active = document.activeElement;
    if (active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        active?.tagName === "SELECT" ||
        active?.isContentEditable) return;

    const modKey = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (modKey && !e.shiftKey && key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (modKey && !e.shiftKey && key === "d") {
      e.preventDefault();
      duplicateSelectedObject();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      deleteSelectedObject();
      return;
    }
    if (key === "q") {
      e.preventDefault();
      toggleTransformMode();
      placeGizmo();
      return;
    }
    if (key === "r") {
      e.preventDefault();
      resetOrbitCamera();
    }
  }

  // ── Level navigation ───────────────────────────────────────────────────────
  function refreshLevelLabel() {
    if (levelLabelEl)
      levelLabelEl.textContent = `${levelState.currentLevel} / ${levelState.totalLevels}`;
  }

  function afterLevelChange() {
    history.length = 0; // history is per-level
    refreshLevelLabel();
    renderPlatformList();
    renderPickupList();
    renderProperties();
    if (platforms.length > 0) {
      let sumY = 0;
      for (const p of platforms) sumY += p.mesh.position.y;
      orbit.target.set(0, sumY / platforms.length + 1, 0);
      syncOrbitCamera();
    }
  }

  prevLvlBtn.addEventListener("click", () => {
    if (levelState.currentLevel <= 1) return;
    resetSelection();
    buildLevel(levelState.currentLevel - 1);
    afterLevelChange();
  });

  nextLvlBtn.addEventListener("click", () => {
    if (levelState.currentLevel >= levelState.totalLevels) return;
    resetSelection();
    buildLevel(levelState.currentLevel + 1);
    afterLevelChange();
  });

  // ── Platform list ──────────────────────────────────────────────────────────
  function renderPlatformList() {
    const layout = levelState.currentProfile?.layout ?? [];
    platformListEl.innerHTML = "";
    layout.forEach((def, i) => {
      const el   = document.createElement("div");
      el.className = "ed-item" + (selectedType === "platform" && i === selectedIndex ? " ed-item--sel" : "");
      const icon = def.isFinal ? "★"
        : def.shape === "triangle" ? "▲"
        : def.shape === "square"   ? "■" : "⬡";
      const name = def.isFinal ? "FINAL HEX" : `Platform ${i + 1}`;
      el.innerHTML = `
        <span class="ed-item-icon">${icon}</span>
        <span class="ed-item-name">${name}</span>
        <span class="ed-item-pos">(${def.x.toFixed(1)}, ${def.y.toFixed(1)})</span>`;
      el.addEventListener("click", () => selectPlatform(i));
      platformListEl.appendChild(el);
    });
  }

  function renderPickupList() {
    if (!pickupListEl) return;
    const defs = levelState.currentProfile?.pickups ?? [];
    pickupListEl.innerHTML = "";
    defs.forEach((def, i) => {
      const el = document.createElement("div");
      const isHealth = def.type === "health";
      const typeClass = isHealth ? "ed-item--pickup-health" : "ed-item--pickup-rocket";
      el.className = "ed-item " + typeClass + (selectedType === "pickup" && i === selectedIndex ? " ed-item--sel" : "");
      const icon = isHealth ? "⊕" : "▲";
      const name = isHealth ? "Health" : "Rocket";
      el.innerHTML = `
        <span class="ed-item-icon">${icon}</span>
        <span class="ed-item-name">${name} Pickup</span>
        <span class="ed-item-pos">(${def.x.toFixed(1)}, ${def.y.toFixed(1)})</span>`;
      el.addEventListener("click", () => selectPickup(i));
      pickupListEl.appendChild(el);
    });
  }

  // ── Selection + gizmo ─────────────────────────────────────────────────────
  function clearHighlight() {
    if (selectedType === "platform" && selectedIndex >= 0 && platforms[selectedIndex]) {
      const mat = platforms[selectedIndex].mesh.material;
      if (mat._edOrig !== undefined) {
        mat.emissive.setHex(mat._edOrig);
        mat.emissiveIntensity = mat._edOrigI;
        delete mat._edOrig;
        delete mat._edOrigI;
      }
    } else if (selectedType === "pickup" && selectedIndex >= 0 && pickups[selectedIndex]) {
      const mat = pickups[selectedIndex].mesh.material;
      if (mat._edOrig !== undefined) {
        mat.emissive.setHex(mat._edOrig);
        mat.emissiveIntensity = mat._edOrigI;
        delete mat._edOrig;
        delete mat._edOrigI;
      }
    }
  }

  function resetSelection() {
    clearHighlight();
    selectedIndex = -1;
    selectedType  = null;
    gizmo.visible = false;
  }

  function selectPlatform(index) {
    clearHighlight();
    selectedIndex = index;
    selectedType  = "platform";
    if (platforms[index]) {
      const mat = platforms[index].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    }
    renderPlatformList();
    renderPickupList();
    renderProperties();
    placeGizmo();
  }

  function selectPickup(index) {
    clearHighlight();
    selectedIndex = index;
    selectedType  = "pickup";
    if (pickups[index]) {
      const mat = pickups[index].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    }
    renderPlatformList();
    renderPickupList();
    renderProperties();
    placeGizmo();
  }

  function placeGizmo() {
    if (selectedIndex < 0) { gizmo.visible = false; return; }
    if (selectedType === "platform") {
      if (!platforms[selectedIndex]) { gizmo.visible = false; return; }
      gizmo.position.copy(platforms[selectedIndex].mesh.position);
    } else if (selectedType === "pickup") {
      if (!pickups[selectedIndex]) { gizmo.visible = false; return; }
      gizmo.position.copy(pickups[selectedIndex].mesh.position);
    } else {
      gizmo.visible = false; return;
    }
    gizmo.visible = true;
    applyGizmoModeVisibility();
    scaleGizmo();
  }

  function applyGizmoModeVisibility() {
    const isTranslate = transformMode === "translate";
    gizmoTranslateMeshes.forEach((mesh) => { mesh.visible = isTranslate; });
    gizmoRotateMeshes.forEach((mesh) => { mesh.visible = !isTranslate; });

    hoveredAxis = null;
    ["x", "y", "z"].forEach((axis) => {
      gizmoTranslateMats[axis]?.color.setHex(AXIS_COLORS[axis]);
    });
    gizmoRotateMat.color.setHex(AXIS_COLORS.y);
  }

  function toggleTransformMode() {
    transformMode = transformMode === "translate" ? "rotate" : "translate";
    applyGizmoModeVisibility();
  }

  function getActiveGizmoMeshes() {
    return transformMode === "translate" ? gizmoTranslateMeshes : gizmoRotateMeshes;
  }

  function scaleGizmo() {
    if (!gizmo.visible) return;
    gizmo.scale.setScalar(camera.position.distanceTo(gizmo.position) * 0.13);
  }

  // ── Properties panel ───────────────────────────────────────────────────────
  function renderProperties() {
    if (selectedType === "pickup") {
      const def = levelState.currentProfile?.pickups?.[selectedIndex];
      if (!def) {
        propertiesEl.innerHTML = '<div class="ed-no-sel">Click a platform or pickup to edit</div>';
        return;
      }
      const isHealth = def.type === "health";
      const typeLabel = isHealth ? "HEALTH PICKUP" : "ROCKET PICKUP";
      const typeColor = isHealth ? "#44ff88" : "#ff4433";
      const amountPct = Math.round((def.amount ?? (isHealth ? 0.25 : 0.30)) * 100);
      const amountLabel = isHealth ? "HP Restore %" : "Fuel Restore %";
      propertiesEl.innerHTML = `
        <div class="ed-section" style="color:${typeColor}">${typeLabel}</div>
        <div class="ed-section">POSITION</div>
        <div class="ed-row"><label class="ed-lbl ed-lbl--x">X</label><input class="ed-num" id="p-x" type="number" value="${def.x.toFixed(2)}" step="0.25"></div>
        <div class="ed-row"><label class="ed-lbl ed-lbl--y">Y</label><input class="ed-num" id="p-y" type="number" value="${def.y.toFixed(2)}" step="0.25"></div>
        <div class="ed-row"><label class="ed-lbl ed-lbl--z">Z</label><input class="ed-num" id="p-z" type="number" value="${def.z.toFixed(2)}" step="0.25"></div>
        <div class="ed-section">VALUE</div>
        <div class="ed-row"><label>${amountLabel}</label><input class="ed-num" id="p-amount" type="number" value="${amountPct}" step="5" min="1" max="100"></div>`;
      bindPickupPropertyEvents(def);
      return;
    }

    const def = selectedIndex >= 0 ? levelState.currentProfile?.layout[selectedIndex] : null;
    if (!def) {
      propertiesEl.innerHTML = '<div class="ed-no-sel">Click a platform or pickup to edit</div>';
      return;
    }
    const colorHex = "#" + def.color.toString(16).padStart(6, "0");
    const rotDeg   = (((def.rotationY ?? 0) * 180) / Math.PI).toFixed(1);
    propertiesEl.innerHTML = `
      <div class="ed-section">POSITION</div>
      <div class="ed-row"><label class="ed-lbl ed-lbl--x">X</label><input class="ed-num" id="p-x" type="number" value="${def.x.toFixed(2)}" step="0.25"></div>
      <div class="ed-row"><label class="ed-lbl ed-lbl--y">Y</label><input class="ed-num" id="p-y" type="number" value="${def.y.toFixed(2)}" step="0.25"></div>
      <div class="ed-row"><label class="ed-lbl ed-lbl--z">Z</label><input class="ed-num" id="p-z" type="number" value="${def.z.toFixed(2)}" step="0.25"></div>

      <div class="ed-section">SIZE</div>
      <div class="ed-row"><label>W / D</label><input class="ed-num" id="p-w" type="number" value="${def.w.toFixed(2)}" step="0.1" min="0.5"></div>
      <div class="ed-row"><label>Height</label><input class="ed-num" id="p-h" type="number" value="${def.h.toFixed(2)}" step="0.05" min="0.1"></div>

      <div class="ed-section">APPEARANCE</div>
      <div class="ed-row"><label>Shape</label>
        <select class="ed-sel" id="p-shape">
          <option value="hex"      ${def.shape==="hex"      ?"selected":""}>Hexagon</option>
          <option value="square"   ${def.shape==="square"   ?"selected":""}>Square</option>
          <option value="triangle" ${def.shape==="triangle" ?"selected":""}>Triangle</option>
        </select></div>
      <div class="ed-row"><label>Rot °</label><input class="ed-num" id="p-rot" type="number" value="${rotDeg}" step="5"></div>
      <div class="ed-row"><label>Color</label><input class="ed-color" id="p-color" type="color" value="${colorHex}"></div>

      <div class="ed-section">VERTICAL MOTION</div>
      <div class="ed-row"><label>Amplitude</label><input class="ed-num" id="p-mamp" type="number" value="${(def.motionAmplitude??0).toFixed(2)}" step="0.1" min="0"></div>
      <div class="ed-row"><label>Speed</label><input class="ed-num" id="p-mspd" type="number" value="${(def.motionSpeed??1).toFixed(2)}" step="0.1" min="0.1"></div>

      <div class="ed-section">HORIZONTAL SWING</div>
      <div class="ed-row"><label>Amplitude</label><input class="ed-num" id="p-samp" type="number" value="${(def.swingAmplitude??0).toFixed(2)}" step="0.1" min="0"></div>
      <div class="ed-row"><label>Speed</label><input class="ed-num" id="p-sspd" type="number" value="${(def.swingSpeed??1).toFixed(2)}" step="0.1" min="0.1"></div>

      <div class="ed-section">FLAGS</div>
      <div class="ed-row ed-row--check"><label>Final Platform</label><input class="ed-chk" id="p-final" type="checkbox" ${def.isFinal?"checked":""}></div>
      <div class="ed-row ed-row--check"><label>Destroyable</label><input class="ed-chk" id="p-destroy" type="checkbox" ${def.isDestroyable?"checked":""}></div>
      <div class="ed-row"><label>Hits to break</label><input class="ed-num" id="p-hits" type="number" value="${def.hitsToBreak??2}" step="1" min="1"></div>`;
    bindPropertyEvents(def);
  }

  function bindPickupPropertyEvents(def) {
    function n(id, key, transform) {
      document.getElementById(id)?.addEventListener("change", (e) => {
        pushHistory();
        def[key] = transform ? transform(e.target.value) : parseFloat(e.target.value);
        rebuild();
      });
    }
    n("p-x", "x");
    n("p-y", "y");
    n("p-z", "z");
    // amount stored as 0–1, displayed as 0–100 %
    n("p-amount", "amount", (v) => Math.max(0.01, Math.min(1.0, parseFloat(v) / 100)));
  }

  function bindPropertyEvents(def) {
    // n: numeric input — pushes history then applies change + rebuild
    function n(id, key, parse = parseFloat, extra) {
      document.getElementById(id)?.addEventListener("change", (e) => {
        pushHistory();
        def[key] = parse(e.target.value);
        if (extra) extra(def);
        rebuild();
      });
    }
    // c: checkbox
    function c(id, key) {
      document.getElementById(id)?.addEventListener("change", (e) => {
        pushHistory();
        def[key] = e.target.checked;
        rebuild();
      });
    }

    n("p-x", "x"); n("p-y", "y"); n("p-z", "z");
    n("p-w", "w", parseFloat, (d) => { d.d = d.w; });
    n("p-h", "h");
    n("p-mamp", "motionAmplitude"); n("p-mspd", "motionSpeed");
    n("p-samp", "swingAmplitude");  n("p-sspd", "swingSpeed");
    n("p-hits", "hitsToBreak", parseInt);
    c("p-final", "isFinal"); c("p-destroy", "isDestroyable");

    document.getElementById("p-rot")?.addEventListener("change", (e) => {
      pushHistory();
      def.rotationY = (parseFloat(e.target.value) * Math.PI) / 180;
      rebuild();
    });
    document.getElementById("p-color")?.addEventListener("input", (e) => {
      pushHistory();
      def.color = parseInt(e.target.value.slice(1), 16);
      rebuild();
    });
    document.getElementById("p-shape")?.addEventListener("change", (e) => {
      pushHistory();
      def.shape     = e.target.value;
      def.rotationY = SHAPE_DEFAULT_ROTY[def.shape] ?? 0;
      const rotEl   = document.getElementById("p-rot");
      if (rotEl) rotEl.value = ((def.rotationY * 180) / Math.PI).toFixed(1);
      rebuild();
    });
  }

  // Rebuild without pushing history — callers are responsible for pushing beforehand
  function rebuild() {
    const prevIndex = selectedIndex;
    const prevType  = selectedType;
    rebuildCurrentLevelPlatforms();
    if (prevType === "platform" && prevIndex >= 0 && platforms[prevIndex]) {
      selectedIndex = prevIndex;
      selectedType  = prevType;
      const mat = platforms[prevIndex].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    } else if (prevType === "pickup" && prevIndex >= 0 && pickups[prevIndex]) {
      selectedIndex = prevIndex;
      selectedType  = prevType;
      const mat = pickups[prevIndex].mesh.material;
      mat._edOrig  = mat.emissive.getHex();
      mat._edOrigI = mat.emissiveIntensity;
      mat.emissive.setHex(0x00e5ff);
      mat.emissiveIntensity = 1.0;
    }
    renderPlatformList();
    renderPickupList();
    placeGizmo();
  }

  // ── Add / Delete / Undo / Export ───────────────────────────────────────────
  addBtn.addEventListener("click", () => {
    if (!levelState.currentProfile) return;
    pushHistory();
    const layout   = levelState.currentProfile.layout;
    const newDef   = freshPlatformDef(layout);
    const finalIdx = layout.findIndex((d) => d.isFinal);
    if (finalIdx >= 0) layout.splice(finalIdx, 0, newDef);
    else layout.push(newDef);
    const newIdx = finalIdx >= 0 ? finalIdx : layout.length - 1;
    rebuildCurrentLevelPlatforms();
    selectPlatform(newIdx);
    renderProperties();
  });

  function deleteSelectedObject() {
    if (selectedIndex < 0 || !levelState.currentProfile) return;
    if (selectedType === "pickup") {
      const pickupDefs = levelState.currentProfile.pickups;
      if (!pickupDefs || pickupDefs.length === 0) return;
      pushHistory();
      clearHighlight();
      pickupDefs.splice(selectedIndex, 1);
      selectedIndex = -1;
      selectedType  = null;
      gizmo.visible = false;
      rebuildCurrentLevelPlatforms();
      renderPlatformList();
      renderPickupList();
      renderProperties();
    } else {
      const layout = levelState.currentProfile.layout;
      if (layout.length <= 1) return;
      pushHistory();
      clearHighlight();
      layout.splice(selectedIndex, 1);
      selectedIndex = -1;
      selectedType  = null;
      gizmo.visible = false;
      rebuildCurrentLevelPlatforms();
      renderPlatformList();
      renderPickupList();
      renderProperties();
    }
  }

  function duplicateSelectedObject() {
    if (selectedIndex < 0 || !levelState.currentProfile) return;

    if (selectedType === "pickup") {
      const pickupDefs = levelState.currentProfile.pickups;
      const src = pickupDefs?.[selectedIndex];
      if (!src) return;
      pushHistory();
      const dup = {
        ...src,
        x: (src.x ?? 0) + 1.5,
        y: (src.y ?? 0) + 1.0,
        z: src.z ?? 0,
      };
      const insertIndex = selectedIndex + 1;
      pickupDefs.splice(insertIndex, 0, dup);
      rebuildCurrentLevelPlatforms();
      selectPickup(insertIndex);
      renderProperties();
      return;
    }

    const layout = levelState.currentProfile.layout;
    const src = layout[selectedIndex];
    if (!src) return;
    pushHistory();
    const dup = JSON.parse(JSON.stringify(src));
    dup.isFinal = false; // keep one canonical final platform in the level
    dup.x = (src.x ?? 0) + 1.5;
    dup.y = (src.y ?? 0) + 1.0;
    dup.z = src.z ?? 0;
    const insertIndex = src.isFinal ? selectedIndex : selectedIndex + 1;
    layout.splice(insertIndex, 0, dup);
    rebuildCurrentLevelPlatforms();
    selectPlatform(insertIndex);
    renderProperties();
  }

  deleteBtn.addEventListener("click", deleteSelectedObject);

  undoBtn?.addEventListener("click", undo);

  function addPickup(type) {
    if (!levelState.currentProfile) return;
    if (!levelState.currentProfile.pickups) levelState.currentProfile.pickups = [];
    pushHistory();
    const layout = levelState.currentProfile.layout;
    const nonFinals = layout.filter((d) => !d.isFinal);
    const last = nonFinals[nonFinals.length - 1];
    const defaultAmount = type === "health" ? 0.25 : 0.30;
    const newDef = {
      x: last ? last.x + 1.5 : 1.5,
      y: last ? last.y + 1.5 : 4.0,
      z: 0,
      rotationY: 0,
      type,
      amount: defaultAmount,
    };
    levelState.currentProfile.pickups.push(newDef);
    rebuildCurrentLevelPlatforms();
    selectPickup(levelState.currentProfile.pickups.length - 1);
    renderProperties();
  }

  addHealthPickupBtn?.addEventListener("click", () => addPickup("health"));
  addRocketPickupBtn?.addEventListener("click", () => addPickup("rocket"));

  // Read all visible property inputs and write them into the layout/pickup def.
  // This captures any uncommitted input values (typed but not yet blurred)
  // before serializing the profile for save.
  function flushPropertiesToDef() {
    if (selectedIndex < 0 || !levelState.currentProfile) return;
    const g = (id) => document.getElementById(id);

    if (selectedType === "pickup") {
      const def = levelState.currentProfile.pickups?.[selectedIndex];
      if (!def) return;
      const x = parseFloat(g("p-x")?.value); if (!isNaN(x)) def.x = x;
      const y = parseFloat(g("p-y")?.value); if (!isNaN(y)) def.y = y;
      const z = parseFloat(g("p-z")?.value); if (!isNaN(z)) def.z = z;
      const amt = parseFloat(g("p-amount")?.value);
      if (!isNaN(amt)) def.amount = Math.max(0.01, Math.min(1.0, amt / 100));
      return;
    }

    const def = levelState.currentProfile.layout[selectedIndex];
    if (!def) return;

    const x = parseFloat(g("p-x")?.value);   if (!isNaN(x))   def.x = x;
    const y = parseFloat(g("p-y")?.value);   if (!isNaN(y))   def.y = y;
    const z = parseFloat(g("p-z")?.value);   if (!isNaN(z))   def.z = z;
    const w = parseFloat(g("p-w")?.value);   if (!isNaN(w)) { def.w = w; def.d = w; }
    const h = parseFloat(g("p-h")?.value);   if (!isNaN(h))   def.h = h;
    const rot = parseFloat(g("p-rot")?.value); if (!isNaN(rot)) def.rotationY = (rot * Math.PI) / 180;
    const shapeEl = g("p-shape"); if (shapeEl) def.shape = shapeEl.value;
    const colorEl = g("p-color"); if (colorEl) def.color = parseInt(colorEl.value.slice(1), 16);
    const mamp = parseFloat(g("p-mamp")?.value); if (!isNaN(mamp)) def.motionAmplitude = mamp;
    const mspd = parseFloat(g("p-mspd")?.value); if (!isNaN(mspd)) def.motionSpeed    = mspd;
    const samp = parseFloat(g("p-samp")?.value); if (!isNaN(samp)) def.swingAmplitude  = samp;
    const sspd = parseFloat(g("p-sspd")?.value); if (!isNaN(sspd)) def.swingSpeed      = sspd;
    const finalEl   = g("p-final");   if (finalEl)   def.isFinal      = finalEl.checked;
    const destroyEl = g("p-destroy"); if (destroyEl) def.isDestroyable = destroyEl.checked;
    const hits = parseInt(g("p-hits")?.value); if (!isNaN(hits)) def.hitsToBreak = hits;
  }

  exportBtn.addEventListener("click", () => {
    if (!levelState.currentProfile) return;
    flushPropertiesToDef();
    const profile = levelState.currentProfile;
    exportBtn.textContent = "SAVING...";
    exportBtn.disabled = true;
    fetch("/api/save-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          exportBtn.textContent = "✓ SAVED";
          setTimeout(() => {
            exportBtn.textContent = "SAVE";
            exportBtn.disabled = false;
          }, 1500);
        } else {
          throw new Error(data.error ?? "Unknown error");
        }
      })
      .catch((err) => {
        console.error("Save failed:", err);
        exportBtn.textContent = "✗ FAILED";
        exportBtn.disabled = false;
        setTimeout(() => { exportBtn.textContent = "SAVE"; }, 2000);
      });
  });

  // ── Gizmo drag helpers ─────────────────────────────────────────────────────
  function makeDragPlane(axis) {
    const axisVec = AXIS_VECTORS[axis];
    const origin  = gizmo.position.clone();
    const camDir  = camera.position.clone().sub(origin).normalize();
    const proj    = camDir.clone().sub(axisVec.clone().multiplyScalar(camDir.dot(axisVec)));
    const normal  = proj.length() > 0.001 ? proj.normalize()
      : new THREE.Vector3(axisVec.x === 0 ? 1 : 0, axisVec.y === 0 ? 1 : 0, 0);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }

  function makeRotatePlaneY() {
    return new THREE.Plane().setFromNormalAndCoplanarPoint(
      AXIS_VECTORS.y,
      gizmo.position.clone(),
    );
  }

  function normalizeAngleDelta(angle) {
    let out = angle;
    while (out > Math.PI) out -= Math.PI * 2;
    while (out < -Math.PI) out += Math.PI * 2;
    return out;
  }

  function eventToMouse(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  function rayPlaneHit(plane) {
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  // ── Mouse events ───────────────────────────────────────────────────────────
  function onMouseDown(e) {
    orbit.moved = false;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;

    if (e.button === 0) {
      eventToMouse(e);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(getActiveGizmoMeshes(), false);
      if (hits.length > 0) {
        const axis  = hits[0].object.userData.gizmoAxis;
        const mode  = hits[0].object.userData.gizmoMode || "translate";
        const def = selectedType === "pickup"
          ? levelState.currentProfile?.pickups?.[selectedIndex]
          : levelState.currentProfile?.layout[selectedIndex];
        if (!def) return;

        pushHistory(); // snapshot before drag starts
        drag.active = true;
        drag.axis   = axis;
        drag.mode   = mode;
        if (mode === "rotate") {
          drag.plane = makeRotatePlaneY();
          const hit = rayPlaneHit(drag.plane);
          drag.startAngle = hit
            ? Math.atan2(hit.z - gizmo.position.z, hit.x - gizmo.position.x)
            : 0;
          drag.startRotationY = def.rotationY ?? 0;
        } else {
          drag.plane  = makeDragPlane(axis);
          const hit   = rayPlaneHit(drag.plane);
          if (hit) drag.planeHit.copy(hit);
          drag.startPos.set(def.x, def.y, def.z);
        }
        return;
      }
      orbit.dragging = true;
    }
    if (e.button === 2) { orbit.panning = true; e.preventDefault(); }
  }

  function onMouseMove(e) {
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) orbit.moved = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;

    if (drag.active) {
      eventToMouse(e);
      raycaster.setFromCamera(mouse, camera);
      const hit = rayPlaneHit(drag.plane);
      if (hit) {
        if (drag.mode === "rotate") {
          const nextAngle = Math.atan2(
            hit.z - gizmo.position.z,
            hit.x - gizmo.position.x,
          );
          const delta = normalizeAngleDelta(nextAngle - drag.startAngle);
          const nextRotationY = drag.startRotationY + delta;

          if (selectedType === "pickup") {
            const def = levelState.currentProfile?.pickups?.[selectedIndex];
            if (def) {
              def.rotationY = nextRotationY;
              const pickup = pickups[selectedIndex];
              if (pickup) pickup.mesh.rotation.y = nextRotationY;
            }
          } else {
            const def = levelState.currentProfile?.layout[selectedIndex];
            if (def) {
              def.rotationY = nextRotationY;
              const platform = platforms[selectedIndex];
              if (platform) platform.mesh.rotation.y = nextRotationY;
              const rotEl = document.getElementById("p-rot");
              if (rotEl) rotEl.value = ((nextRotationY * 180) / Math.PI).toFixed(1);
            }
          }
        } else {
          const movement = hit.clone().sub(drag.planeHit).dot(AXIS_VECTORS[drag.axis]);
          if (selectedType === "pickup") {
            const def = levelState.currentProfile?.pickups?.[selectedIndex];
            if (def) {
              def[drag.axis] = drag.startPos[drag.axis] + movement;
              const pickup = pickups[selectedIndex];
              if (pickup) pickup.mesh.position[drag.axis] = def[drag.axis];
              gizmo.position[drag.axis] = def[drag.axis];
              const el = document.getElementById(`p-${drag.axis}`);
              if (el) el.value = def[drag.axis].toFixed(2);
              const listItems = pickupListEl?.querySelectorAll(".ed-item-pos");
              if (listItems?.[selectedIndex])
                listItems[selectedIndex].textContent = `(${def.x.toFixed(1)}, ${def.y.toFixed(1)})`;
            }
          } else {
            const def = levelState.currentProfile?.layout[selectedIndex];
            if (def) {
              def[drag.axis] = drag.startPos[drag.axis] + movement;
              const platform = platforms[selectedIndex];
              if (platform) {
                platform.mesh.position[drag.axis] = def[drag.axis];
                platform.body.setNextKinematicTranslation(platform.mesh.position);
                if (drag.axis === "x") { platform.originalX = def.x; platform.currentX = def.x; }
                if (drag.axis === "y") { platform.originalY = def.y; platform.currentY = def.y; }
              }
              gizmo.position[drag.axis] = def[drag.axis];
              const el = document.getElementById(`p-${drag.axis}`);
              if (el) el.value = def[drag.axis].toFixed(2);
              const listItems = platformListEl.querySelectorAll(".ed-item-pos");
              if (listItems[selectedIndex])
                listItems[selectedIndex].textContent = `(${def.x.toFixed(1)}, ${def.y.toFixed(1)})`;
            }
          }
        }
      }
      return;
    }

    if (orbit.dragging) {
      orbit.theta -= dx * 0.007;
      orbit.phi   = Math.max(-1.4, Math.min(1.4, orbit.phi + dy * 0.007));
      syncOrbitCamera(); return;
    }
    if (orbit.panning) {
      const s = orbit.radius * 0.002;
      orbit.target.x -= dx * s;
      orbit.target.y -= dy * s;
      syncOrbitCamera(); return;
    }

    // Hover highlight
    if (gizmo.visible) {
      eventToMouse(e);
      raycaster.setFromCamera(mouse, camera);
      const hits       = raycaster.intersectObjects(getActiveGizmoMeshes(), false);
      const newHovered = hits.length > 0 ? hits[0].object.userData.gizmoAxis : null;
      if (newHovered !== hoveredAxis) {
        hoveredAxis = newHovered;
        if (transformMode === "translate") {
          ["x", "y", "z"].forEach((a) => {
            gizmoTranslateMats[a].color.setHex(hoveredAxis === a ? AXIS_HOVER : AXIS_COLORS[a]);
          });
        } else {
          gizmoRotateMat.color.setHex(hoveredAxis ? AXIS_HOVER : AXIS_COLORS.y);
        }
      }
    }
  }

  function onMouseUp() {
    orbit.dragging = false;
    orbit.panning  = false;
    if (drag.active) {
      const didDrag = drag.mode;
      drag.active = false;
      drag.axis   = null;
      drag.mode = "translate";
      if (didDrag) rebuild(); // history was already pushed at drag start
    }
  }

  function onWheel(e) {
    e.preventDefault();
    orbit.radius = Math.max(3, Math.min(80, orbit.radius + e.deltaY * 0.05));
    syncOrbitCamera();
  }

  function onCanvasClick(e) {
    if (orbit.moved) return;
    eventToMouse(e);
    raycaster.setFromCamera(mouse, camera);
    if (gizmo.visible && raycaster.intersectObjects(getActiveGizmoMeshes(), false).length > 0) return;

    const platformMeshes = platforms.map((p) => p.mesh);
    const pickupMeshes   = pickups.map((pk) => pk.mesh);
    const allMeshes      = [...platformMeshes, ...pickupMeshes];
    const hits = raycaster.intersectObjects(allMeshes, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && !allMeshes.includes(obj)) obj = obj.parent;
      const pidx = platformMeshes.indexOf(obj);
      if (pidx >= 0) { selectPlatform(pidx); return; }
      const kidx = pickupMeshes.indexOf(obj);
      if (kidx >= 0) { selectPickup(kidx); return; }
    }
    resetSelection();
    renderPlatformList();
    renderPickupList();
    renderProperties();
  }

  // ── Orbit camera ───────────────────────────────────────────────────────────
  function syncOrbitCamera() {
    const { theta, phi, radius, target } = orbit;
    camera.position.set(
      target.x + radius * Math.cos(phi) * Math.sin(theta),
      target.y + radius * Math.sin(phi),
      target.z + radius * Math.cos(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
    scaleGizmo();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    isOpen: () => isOpen,
    open: openEditor,
    close: closeEditor,
    toggle: () => (isOpen ? closeEditor() : openEditor()),
    tick: syncOrbitCamera,
  };
}
