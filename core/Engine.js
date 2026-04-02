import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { luaRuntime } from "./LuaRuntime";
import { uiManager } from "../ui/UIManager";
import { createBackgroundMusicController } from "../scripts/sound/bgMusic";
import { createJumpSoundController } from "../scripts/sound/jumpSound";
import { createRocketSoundController } from "../scripts/sound/rocketSound";
import { createImpactSoundController } from "../scripts/sound/impactSound";
import { createWinSoundController } from "../scripts/sound/winSound";
import { createButtonClickSoundController } from "../scripts/sound/buttonClickSound";
import worldConfig from "../configs/world-config.json";
import playerConfig from "../configs/player-config.json";
import soundConfig from "../configs/sound-config.json";
import pickupConfig from "../configs/pickup-config.json";

const luaModules = import.meta.glob("../scripts/**/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
});

const levelJsonModules = import.meta.glob("../configs/levels/level*.json", {
  eager: true,
  import: "default",
});
const IS_DEV = import.meta.env.DEV;

let scene;
let camera;
let renderer;
let world;
let clock;
let player;
let playerBody;
let playerCollider;
let animationId;
let spaceBackdropGroup;
let bgMusicController;
let levelEditorRef;
let jumpSoundController;
let rocketSoundController;
let impactSoundController;
let winSoundController;
let buttonClickSoundController;
let levelEditorModulePromise;

const platforms = [];
const particles = [];
const particlePool = [];
const pickups = [];
const keys = {};
const PARTICLE_GEOMETRY = new THREE.SphereGeometry(1, 6, 6);

const audioOptions = {
  master: true,
  bgMusic:  { enabled: true, volume: soundConfig.backgroundMusic?.volume ?? 0.12 },
  jump:     { enabled: true, volume: soundConfig.jump?.volume             ?? 0.35 },
  rocket:   { enabled: true, volume: soundConfig.rocket?.volume           ?? 0.80 },
  impact:   { enabled: true, volume: soundConfig.impact?.volume           ?? 0.75 },
  win:         { enabled: true, volume: soundConfig.win?.volume              ?? 0.75 },
  buttonClick: { enabled: true, volume: soundConfig.buttonClick?.volume     ?? 0.75 },
};

const {
  rendering: {
    skyColor: SKY_COLOR,
    fogColor: FOG_COLOR,
    maxPixelRatio: MAX_PIXEL_RATIO = 1.25,
  },
  campaign: {
    levelCount: LEVEL_COUNT,
  },
  physics: {
    gravity: INITIAL_GRAVITY,
    platformHeight: PLATFORM_HEIGHT,
  },
} = worldConfig;

const {
  movement: {
    speed: PLAYER_SPEED,
    jumpImpulse: JUMP_IMPULSE,
    spawn: PLAYER_SPAWN,
  },
  gelEconomy: {
    jumpCost: JUMP_GEL_COST,
    walkCost: WALK_GEL_COST,
    walkStepDistance: WALK_STEP_DISTANCE,
    criticalThreshold: GEL_CRITICAL_THRESHOLD,
    gameOverThreshold: GEL_GAME_OVER_THRESHOLD,
    rocketGelCost: ROCKET_GEL_COST,
  },
  detection: {
    groundRayOffsets: PLAYER_GROUND_RAY_OFFSETS,
    groundRayStartY: PLAYER_GROUND_RAY_START_Y,
    groundRayLength: PLAYER_GROUND_RAY_LENGTH,
    groundCoyoteTime: PLAYER_GROUND_COYOTE_TIME,
  },
  boundaries: {
    spaceshipAltitudeThreshold: SPACESHIP_ALTITUDE_THRESHOLD,
  },
  camera: {
    xFollowFactor: CAMERA_X_FOLLOW_FACTOR = 0.15,
    xFollowClamp: CAMERA_X_FOLLOW_CLAMP = Infinity,
    lookAtXFactor: CAMERA_LOOK_AT_X_FACTOR = 0.12,
    jumpShakeMax: JUMP_CAMERA_SHAKE_MAX,
    jumpShakeDecay: JUMP_CAMERA_SHAKE_DECAY,
    jumpShakeOffset: JUMP_CAMERA_SHAKE_OFFSET,
    jumpShakeRoll: JUMP_CAMERA_SHAKE_ROLL,
  },
  rockets: {
    thrust: ROCKET_THRUST,
    drainRate: ROCKET_DRAIN_RATE,
    refillRate: ROCKET_REFILL_RATE,
  },
} = playerConfig;

const playerState = {
  gelMass: 1.0,
  isGameOver: false,
  lastGrounded: true,
  lastVelY: 0,
  airborneTime: 0,
  lastLandingAirTime: 0,
  lastLandingImpactSpeed: 0,
  particleTimer: 0,
  walkDistanceAccumulator: 0,
  groundedCoyoteTimer: 0,
  spawnLandingGrace: true,
  jellyUniforms: {
    uVelocity: { value: new THREE.Vector3() },
    uImpact: { value: 0 },
    uTime: { value: 0 },
    uScale: { value: new THREE.Vector3(1, 1, 1) },
    uTilt: { value: 0 },
  },
  rocketLevel: 1.0,
  isRocketActive: false,
  pendingHealthRestore: 0,
  pendingRocketFuel: 0,
  rocketMeshes: [],
  rocketSpin: 0,
  rocketSpinBaseDirection: 1,
  isGodMode: false,
  isRocketBoy: false,
};

const levelState = {
  currentLevel: 1,
  totalLevels: LEVEL_COUNT,
  profiles: [],
  currentProfile: null,
  finalPlatform: null,
  transitionTimer: 0,
  pendingLevel: null,
  isTransitioning: false,
  isGameComplete: false,
};

const gameplayState = {
  manualStepMode: false,
  isPaused: false,
  isEscMenuOpen: false,
  isOptionsOpen: false,
  isEditorOpen: false,
  isTitleScreen: true,
  optionsFromTitle: false,
};

const jumpCameraState = {
  shake: 0,
  phase: 0,
};

const gameConfig = {
  ...playerConfig,
  playerSpeed: PLAYER_SPEED,
  jumpImpulse: JUMP_IMPULSE,
  gravity: INITIAL_GRAVITY,
};

window.addEventListener("cheat-command", (e) => {
  const command = String(e.detail || "").toLowerCase();
  luaRuntime.callFunction("onCheatCommand", command);
});

function getPlayerSnapshot() {
  if (!playerBody) {
    return null;
  }

  const translation = playerBody.translation();
  const velocity = playerBody.linvel();
  const hit = sampleGroundHit(translation);
  const finalPlatform = levelState.finalPlatform;
  const isFinalHit =
    !!hit && !!finalPlatform && hit.collider.handle === finalPlatform.collider.handle;

  const pendingHealthRestore = playerState.pendingHealthRestore;
  const pendingRocketFuel = playerState.pendingRocketFuel;
  playerState.pendingHealthRestore = 0;
  playerState.pendingRocketFuel = 0;

  let groundPlatformVelY = 0;
  if (hit) {
    const hitHandle = hit.collider.handle;
    for (const platform of platforms) {
      if (platform.collider.handle === hitHandle) {
        groundPlatformVelY = platform.lastVelY || 0;
        break;
      }
    }
  }

  return {
    translation: { x: translation.x, y: translation.y, z: translation.z },
    velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    isGrounded: !!hit,
    groundHitHandle: hit ? hit.collider.handle : null,
    groundHitToi: hit ? hit.timeOfImpact : null,
    groundPlatformVelY,
    hitFinal: isFinalHit,
    isTransitioning: levelState.isTransitioning,
    isGameComplete: levelState.isGameComplete,
    isGameOver: playerState.isGameOver,
    pendingHealthRestore,
    pendingRocketFuel,
    keys: {
      left:  !!(keys["KeyA"] || keys["ArrowLeft"]),
      right: !!(keys["KeyD"] || keys["ArrowRight"]),
      jump:  !!keys["Space"],
      boost: !!(keys["ShiftLeft"] || keys["ShiftRight"]),
    },
  };
}

function applyRendererQuality() {
  if (!renderer) {
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
}

function ensureBackgroundMusicController() {
  if (!bgMusicController) {
    bgMusicController = createBackgroundMusicController(soundConfig);
    applyAudioChannel("bgMusic");
  }

  return bgMusicController;
}

function primeBackgroundMusic() {
  const ctrl = ensureBackgroundMusicController();
  if (audioOptions.master && audioOptions.bgMusic.enabled) {
    ctrl.play();
  }
}

async function ensureLevelEditorReady() {
  if (!IS_DEV) {
    return null;
  }

  if (levelEditorRef) {
    return levelEditorRef;
  }

  if (!levelEditorModulePromise) {
    levelEditorModulePromise = import("../editor/LevelEditor.js");
  }

  const { initLevelEditor } = await levelEditorModulePromise;
  if (levelEditorRef) {
    return levelEditorRef;
  }

  levelEditorRef = initLevelEditor({
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
    resetPlayerForTest: () => {
      playerState.isGameOver = false;
      uiManager.hideGameOver();
      resetPlayerForLevel();
    },
  });

  return levelEditorRef;
}

function removeProductionEditorUI() {
  if (IS_DEV) {
    return;
  }

  document.getElementById("editor-fab")?.remove();
  document.getElementById("level-editor")?.remove();
  document.getElementById("editor-stop-test")?.remove();
}

function ensureDevEditorTrigger() {
  if (!IS_DEV || document.getElementById("editor-fab")) {
    return;
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <button id="editor-fab" title="Level Editor" aria-label="Open level editor">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <rect x="11.5" y="1.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <rect x="1.5" y="11.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <rect x="11.5" y="11.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `,
  );
}

function applyPlayerFrameState(nextState = {}) {
  if (!nextState) {
    return;
  }

  if (typeof nextState.gelMass === "number") {
    playerState.gelMass = clamp(nextState.gelMass, 0, 1);
    syncPlayerCollider();
    uiManager.updateHealth(playerState.gelMass);
  }

  if (typeof nextState.rocketLevel === "number") {
    playerState.rocketLevel = clamp(nextState.rocketLevel, 0, 1);
  }

  if (typeof nextState.isRocketActive === "boolean") {
    playerState.isRocketActive = nextState.isRocketActive;
    rocketSoundController?.sync(playerState.isRocketActive);
  }

  if (typeof nextState.rocketSpin === "number") {
    playerState.rocketSpin = nextState.rocketSpin;
  }

  if (typeof nextState.rocketSpinBaseDirection === "number") {
    playerState.rocketSpinBaseDirection = nextState.rocketSpinBaseDirection;
  }

  if (typeof nextState.isGodMode === "boolean") {
    playerState.isGodMode = nextState.isGodMode;
  }

  if (typeof nextState.isRocketBoy === "boolean") {
    playerState.isRocketBoy = nextState.isRocketBoy;
  }

  if (typeof nextState.isGameOver === "boolean") {
    playerState.isGameOver = playerState.isGameOver || nextState.isGameOver;
  }

  if (typeof nextState.lastGrounded === "boolean") {
    playerState.lastGrounded = nextState.lastGrounded;
  }

  if (typeof nextState.lastVelY === "number") {
    playerState.lastVelY = nextState.lastVelY;
  }

  if (typeof nextState.airborneTime === "number") {
    playerState.airborneTime = nextState.airborneTime;
  }

  if (typeof nextState.lastLandingAirTime === "number") {
    playerState.lastLandingAirTime = nextState.lastLandingAirTime;
  }

  if (typeof nextState.lastLandingImpactSpeed === "number") {
    playerState.lastLandingImpactSpeed = nextState.lastLandingImpactSpeed;
  }

  if (nextState.velocity && playerBody) {
    playerBody.setLinvel(
      {
        x: nextState.velocity.x ?? 0,
        y: nextState.velocity.y ?? 0,
        z: nextState.velocity.z ?? 0,
      },
      true,
    );
  }

  if (nextState.jelly) {
    const jelly = nextState.jelly;
    if (jelly.velocity) {
      playerState.jellyUniforms.uVelocity.value.set(
        jelly.velocity.x ?? 0,
        jelly.velocity.y ?? 0,
        jelly.velocity.z ?? 0,
      );
    }
    if (typeof jelly.impact === "number") {
      playerState.jellyUniforms.uImpact.value = jelly.impact;
    }
    if (typeof jelly.time === "number") {
      playerState.jellyUniforms.uTime.value = jelly.time;
    }
    if (jelly.scale) {
      playerState.jellyUniforms.uScale.value.set(
        jelly.scale.x ?? 1,
        jelly.scale.y ?? 1,
        jelly.scale.z ?? jelly.scale.x ?? 1,
      );
    }
    if (typeof jelly.tilt === "number") {
      playerState.jellyUniforms.uTilt.value = jelly.tilt;
    }
  }

  if (playerState.rocketMeshes.length > 0) {
    const scaleXZ =
      nextState.jelly?.scale?.x ?? playerState.jellyUniforms.uScale.value.x;
    if (playerState.rocketMeshes[0]) {
      playerState.rocketMeshes[0].position.x = -0.5 * scaleXZ - 0.1;
    }
    if (playerState.rocketMeshes[1]) {
      playerState.rocketMeshes[1].position.x = 0.5 * scaleXZ + 0.1;
    }
  }

  if (playerState.thrusterGlows && playerState.thrusterGlows.length > 0) {
    const glowScale = playerState.isRocketActive ? 1 : 0;
    playerState.thrusterGlows.forEach((glow) => {
      glow.scale.set(glowScale, glowScale ? 1 : 0, glowScale);
    });
  }

  if (player) {
    player.rotation.y = playerState.rocketSpin;
    player.rotation.z = 0;
  }

  uiManager.updateRocket(playerState.rocketLevel, playerState.isRocketActive);
}

const existingCanvas = document.querySelector("canvas");
if (existingCanvas) {
  existingCanvas.remove();
}

async function init() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: gameConfig.gravity, z: 0 });
  removeProductionEditorUI();
  ensureDevEditorTrigger();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 12, 120);

  const { width: initW, height: initH } = getPortraitSize();

  camera = new THREE.PerspectiveCamera(
    75,
    initW / initH,
    0.1,
    1000,
  );
  camera.position.set(0, 4.4, 14);
  camera.lookAt(0, 2.2, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  applyRendererQuality();
  renderer.setSize(initW, initH);
  renderer.setClearColor(SKY_COLOR, 1);
  const gameWrap = document.getElementById('game-wrap');
  gameWrap.style.width = initW + 'px';
  gameWrap.style.height = initH + 'px';
  gameWrap.appendChild(renderer.domElement);

  jumpSoundController = createJumpSoundController(soundConfig);
  rocketSoundController = createRocketSoundController(soundConfig);
  impactSoundController = createImpactSoundController(soundConfig);
  winSoundController = createWinSoundController(soundConfig);
  buttonClickSoundController = createButtonClickSoundController(soundConfig);

  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xc7d8ff, 0x0b1020, 0.95));

  const sun = new THREE.DirectionalLight(0xbcdcff, 1.25);
  sun.position.set(12, 28, 16);
  scene.add(sun);

  const rimLight = new THREE.PointLight(0x7dd3fc, 0.8, 42);
  rimLight.position.set(-10, 10, 14);
  scene.add(rimLight);

  await luaRuntime.init({
    config: gameConfig,
    game: {
      createGround: () => createGround(),
      createPlatform: (x, y, z, w, h, d, color) =>
        createPlatform(x, y, z, w, h, d, color),
      logConsole: (message) => uiManager.logToConsole(String(message)),
      random: () => Math.random(),
      startLevelTransition: () => startLevelTransition(),
      triggerGameOver: (cause, delayMs = 0) => triggerGameOver(cause, delayMs),
      triggerSpaceshipStrike: (x, y, z) =>
        triggerSpaceshipStrike({ x, y, z }),
      isKeyDown: (code) => !!keys[code],
      player: {
        ensure: () => {
          if (!player) {
            createPlayer();
          }
        },
        spawn: (x, y, z) => {
          if (!player) createPlayer();
          playerBody.setTranslation({ x, y, z }, true);
          playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
          playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
          player.position.set(x, y, z);
          playerState._lastColliderMass = null;
        },
        resetPresentation: () => {
          camera.position.set(0, 4.4, 14);
          camera.lookAt(0, 2.2, 0);
          jumpCameraState.shake = 0;
          jumpCameraState.phase = 0;
          uiManager.hideGameOver();
          uiManager.hideGameComplete();
        },
        read: () => getPlayerSnapshot(),
        apply: (state) => applyPlayerFrameState(state),
        drainGel: (amount) => {
          drainGel(amount);
          return playerState.gelMass;
        },
        playJumpSound: () => jumpSoundController?.play(),
        spawnParticles: (
          x,
          y,
          z,
          color,
          count = 8,
          speedScale = 1.0,
          options = {},
        ) => spawnParticles(x, y, z, color, count, speedScale, options),
        playImpactSound: () => impactSoundController?.play(),
        triggerLandingCameraEffect: (airborneTime, impactSpeed) =>
          triggerLandingCameraEffect(airborneTime, impactSpeed),
        syncCollider: (force = false) => syncPlayerCollider(force),
      },
      setGravity: (y) => {
        gameConfig.gravity = y;
        world.gravity = { x: 0, y, z: 0 };
      },
    },
  });

  for (const path in luaModules) {
    const fileName = path.replace("../scripts/", "");
    await luaRuntime.mountFile(fileName, luaModules[path]);
  }

  await luaRuntime.run('require("init")');

  levelState.profiles = buildLevelProfilesFromFiles(levelJsonModules);
  buildLevel(1);
  setupTestingHooks();

  const editorFab = IS_DEV ? document.getElementById("editor-fab") : null;
  if (editorFab) {
    editorFab.addEventListener(
      "click",
      async (event) => {
        if (levelEditorRef) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        const ref = await ensureLevelEditorReady();
        ref?.open?.();
      },
      { capture: true, once: true },
    );
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("pointerdown", primeBackgroundMusic, { passive: true });
  document.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      buttonClickSoundController?.play();
    }
  });

  const titlePlayBtn = document.getElementById("title-play-btn");
  if (titlePlayBtn) {
    titlePlayBtn.addEventListener("click", () => {
      gameplayState.isTitleScreen = false;
      uiManager.hideTitleScreen();
      uiManager.hideConsole();
      clock.getDelta(); // discard accumulated delta so physics doesn't spike on start
    });
  }

  const titleOptionsBtn = document.getElementById("title-options-btn");
  if (titleOptionsBtn) {
    titleOptionsBtn.addEventListener("click", () => {
      gameplayState.isOptionsOpen = true;
      gameplayState.optionsFromTitle = true;
      uiManager.hideConsole();
      uiManager.showOptions();
    });
  }

  animate();
}

function onKeyDown(event) {
  primeBackgroundMusic();

  const canOpenConsole =
    !gameplayState.isTitleScreen &&
    !gameplayState.isPaused &&
    !gameplayState.isEscMenuOpen &&
    !gameplayState.isOptionsOpen &&
    !gameplayState.isEditorOpen &&
    !playerState.isGameOver &&
    !levelState.isGameComplete;
  const isConsoleOpen = uiManager.consoleEl?.style.display === "flex";

  if (event.code === "Backquote") {
    event.preventDefault();
    if (isConsoleOpen || canOpenConsole) {
      uiManager.toggleConsole();
    }
    return;
  }

  // Ignore game input if typing in an input field
  if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
    return;
  }

  if (gameplayState.isEditorOpen) return;

  if (event.code === "KeyP" && !playerState.isGameOver && !levelState.isGameComplete && !gameplayState.isTitleScreen) {
    gameplayState.isPaused = !gameplayState.isPaused;
    if (gameplayState.isPaused) {
      uiManager.showPaused();
    } else {
      uiManager.hidePaused();
      clock.getDelta(); // discard accumulated delta so physics doesn't spike on resume
    }
    return;
  }

  if (event.code === "Escape" && !playerState.isGameOver && !levelState.isGameComplete) {
    if (gameplayState.isOptionsOpen) {
      closeOptions();
    } else if (gameplayState.isTitleScreen) {
      return;
    } else if (gameplayState.isEscMenuOpen) {
      closeEscMenu();
    } else {
      openEscMenu();
    }
    return;
  }

  keys[event.code] = true;
}

function onKeyUp(event) {
  if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
    keys[event.code] = false; // Still release keys to be safe
    return;
  }
  keys[event.code] = false;
}

function applyAudioChannel(channel) {
  const opt = audioOptions[channel];
  const eff = audioOptions.master && opt.enabled;
  const ctrl = { bgMusic: bgMusicController, jump: jumpSoundController, rocket: rocketSoundController, impact: impactSoundController, win: winSoundController, buttonClick: buttonClickSoundController }[channel];
  ctrl?.setVolume(opt.volume);
  ctrl?.setEnabled(eff);
}

function applyAllAudio() {
  ["bgMusic", "jump", "rocket", "impact", "win", "buttonClick"].forEach(applyAudioChannel);
}

function initOptionsUI() {
  // Helper to sync a volume slider and its label display
  function bindSlider(sliderId, labelId, channel) {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(labelId);
    if (!slider || !label) return;
    const pct = Math.round(audioOptions[channel].volume * 100);
    slider.value = pct;
    label.textContent = pct;
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      label.textContent = v;
      audioOptions[channel].volume = v / 100;
      applyAudioChannel(channel);
    });
  }

  // Helper to sync an enable toggle
  function bindToggle(checkboxId, channel) {
    const cb = document.getElementById(checkboxId);
    if (!cb) return;
    cb.checked = audioOptions[channel].enabled;
    cb.addEventListener("change", () => {
      audioOptions[channel].enabled = cb.checked;
      applyAudioChannel(channel);
    });
  }

  // Master toggle
  const masterCb = document.getElementById("opt-master");
  if (masterCb) {
    masterCb.checked = audioOptions.master;
    masterCb.addEventListener("change", () => {
      audioOptions.master = masterCb.checked;
      uiManager.setMasterOffDim(!audioOptions.master);
      applyAllAudio();
    });
  }

  bindToggle("opt-bgmusic-enabled", "bgMusic");
  bindSlider("opt-bgmusic-vol", "opt-bgmusic-vol-val", "bgMusic");

  bindToggle("opt-jump-enabled",   "jump");
  bindSlider("opt-jump-vol",   "opt-jump-vol-val",   "jump");

  bindToggle("opt-rocket-enabled", "rocket");
  bindSlider("opt-rocket-vol", "opt-rocket-vol-val", "rocket");

  bindToggle("opt-impact-enabled", "impact");
  bindSlider("opt-impact-vol", "opt-impact-vol-val", "impact");

  bindToggle("opt-win-enabled",    "win");
  bindSlider("opt-win-vol",    "opt-win-vol-val",    "win");

  bindToggle("opt-btnclick-enabled", "buttonClick");
  bindSlider("opt-btnclick-vol", "opt-btnclick-vol-val", "buttonClick");

  // BACK button
  if (uiManager.optionsBackBtn) {
    uiManager.optionsBackBtn.addEventListener("click", () => {
      closeOptions();
    });
  }
}

function openOptions() {
  gameplayState.isOptionsOpen = true;
  uiManager.hideEscMenu();
  uiManager.hideConsole();
  uiManager.showOptions();
}

function closeOptions() {
  gameplayState.isOptionsOpen = false;
  uiManager.hideOptions();
  if (gameplayState.optionsFromTitle) {
    gameplayState.optionsFromTitle = false;
    uiManager.hideConsole();
    uiManager.showTitleScreen();
  } else {
    uiManager.showEscMenu();
  }
}

function openEscMenu() {
  gameplayState.isEscMenuOpen = true;
  gameplayState.isPaused = true;
  uiManager.hideConsole();
  uiManager.showEscMenu();
}

function closeEscMenu() {
  gameplayState.isEscMenuOpen = false;
  gameplayState.isPaused = false;
  uiManager.hideEscMenu();
  clock.getDelta(); // discard accumulated delta so physics doesn't spike on resume
}

function createGround() {
  if (spaceBackdropGroup) {
    scene.remove(spaceBackdropGroup);
  }

  spaceBackdropGroup = new THREE.Group();

  const starCount = 420;
  const positions = new Float32Array(starCount * 3);
  const rng = mulberry32(0x8b51f1aa);

  for (let index = 0; index < starCount; index += 1) {
    const offset = index * 3;
    positions[offset] = (rng() * 2 - 1) * 58;
    positions[offset + 1] = rng() * 170 - 24;
    positions[offset + 2] = (rng() * 2 - 1) * 52;
  }

  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );

  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  });

  const stars = new THREE.Points(starsGeometry, starsMaterial);
  spaceBackdropGroup.add(stars);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(72, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0x0d1733,
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide,
    }),
  );
  spaceBackdropGroup.add(glow);

  scene.add(spaceBackdropGroup);
}

function createPickup(def) {
  const isHealth = def.type === "health";
  const color = isHealth ? 0x44ff88 : 0xff2222;
  const geometry = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    metalness: 0.3,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(def.x, def.y, def.z);
  mesh.rotation.y = def.rotationY ?? 0;
  scene.add(mesh);
  const pickup = { mesh, type: def.type, collected: false, def };
  pickups.push(pickup);
  return pickup;
}

function clearPickups() {
  for (const pickup of pickups) {
    if (!pickup.collected) {
      scene.remove(pickup.mesh);
      pickup.mesh.geometry.dispose();
      pickup.mesh.material.dispose();
    }
  }
  pickups.length = 0;
}

function normalizePlatformShape(shape) {
  if (shape === "triangle" || shape === "square" || shape === "hex") {
    return shape;
  }
  return "hex";
}

function getPlatformShapeSpec(shape) {
  const normalized = normalizePlatformShape(shape);
  switch (normalized) {
    case "triangle":
      return { shape: "triangle", sides: 3, defaultRotationY: Math.PI / 2 };
    case "square":
      return { shape: "square", sides: 4, defaultRotationY: Math.PI / 4 };
    case "hex":
    default:
      return { shape: "hex", sides: 6, defaultRotationY: Math.PI / 6 };
  }
}

function createPlatform(x, y, z, w, h, d, color, options = {}) {
  const radius = Math.max(w, d) / 2;
  const isDestroyable = !!options.isDestroyable;
  const hitsToBreak = isDestroyable
    ? Math.max(1, Math.round(options.hitsToBreak ?? 2))
    : 0;
  const platformColor = isDestroyable ? 0xffffff : color;
  const shapeSpec = getPlatformShapeSpec(
    options.shape ?? options.definition?.shape,
  );
  const rotationY =
    typeof options.rotationY === "number"
      ? options.rotationY
      : typeof options.definition?.rotationY === "number"
        ? options.definition.rotationY
        : shapeSpec.defaultRotationY;
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    h,
    shapeSpec.sides,
  );
  const material = new THREE.MeshStandardMaterial({
    color: platformColor,
    emissive: options.isFinal ? 0xffd166 : platformColor,
    emissiveIntensity: options.isFinal ? 0.55 : 0.24,
    metalness: options.isFinal ? 0.62 : 0.35,
    roughness: options.isFinal ? 0.18 : 0.26,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;

  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: options.isFinal ? 0xfff2b1 : 0xffffff,
      transparent: true,
      opacity: options.isFinal ? 0.65 : 0.18,
    }),
  );
  mesh.add(rim);

  if (options.isFinal) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.72, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfff0a8,
        transparent: true,
        opacity: 0.9,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * 0.65;
    mesh.add(ring);

    const beacon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff7d1 }),
    );
    beacon.position.y = h * 1.55;
    mesh.add(beacon);
  }

  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
  );

  const vertices = [];
  const sides = shapeSpec.sides;
  const offset = rotationY;
  for (let index = 0; index < sides; index += 1) {
    const angle = (index * Math.PI * 2) / sides + offset;
    const vx = radius * Math.cos(angle);
    const vz = radius * Math.sin(angle);
    vertices.push(vx, -h / 2, vz);
    vertices.push(vx, h / 2, vz);
  }

  const collider = world.createCollider(
    RAPIER.ColliderDesc.convexHull(new Float32Array(vertices))
      .setFriction(0)
      .setRestitution(0),
    body,
  );

  const platform = {
    mesh,
    body,
    collider,
    originalY: y,
    currentY: y,
    originalX: x,
    currentX: x,
    bobPhase: options.bobPhase ?? Math.random() * Math.PI * 2,
    motionAmplitude: options.motionAmplitude ?? 0,
    motionSpeed: options.motionSpeed ?? 0,
    swingAmplitude: options.swingAmplitude ?? 0,
    swingSpeed: options.swingSpeed ?? 0,
    isFinal: !!options.isFinal,
    isDestroyable,
    hitsToBreak,
    hitsRemaining: hitsToBreak,
    wasSteppedOn: false,
    steppedOnGrace: 0,
    lastVelY: 0,
    shape: shapeSpec.shape,
    rotationY,
    definition: options.definition ?? null,
  };

  platforms.push(platform);
  if (platform.isFinal) {
    levelState.finalPlatform = platform;
  }

  return platform;
}

function destroyPlatform(platform) {
  if (!platform || platform.isFinal) {
    return;
  }

  const meshPosition = platform.mesh?.position;
  if (meshPosition) {
    spawnParticles(
      meshPosition.x,
      meshPosition.y + 0.2,
      meshPosition.z,
      0x70e1ff,
      16,
      1.25,
      { lifeDecay: 0.5 },
    );
  }

  if (platform.mesh) {
    scene.remove(platform.mesh);
    platform.mesh.geometry?.dispose?.();
    if (Array.isArray(platform.mesh.material)) {
      platform.mesh.material.forEach((material) => material?.dispose?.());
    } else {
      platform.mesh.material?.dispose?.();
    }
  }
  world.removeRigidBody(platform.body);

  const index = platforms.indexOf(platform);
  if (index >= 0) {
    platforms.splice(index, 1);
  }
}

function createPlayer() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x5cff78,
    emissive: 0x2be866,
    emissiveIntensity: 0.22,
    roughness: 0.18,
    metalness: 0.65,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVelocity = playerState.jellyUniforms.uVelocity;
    shader.uniforms.uImpact = playerState.jellyUniforms.uImpact;
    shader.uniforms.uTime = playerState.jellyUniforms.uTime;
    shader.uniforms.uScale = playerState.jellyUniforms.uScale;
    shader.uniforms.uTilt = playerState.jellyUniforms.uTilt;

    shader.vertexShader = `
      uniform vec3 uVelocity;
      uniform float uImpact;
      uniform float uTime;
      uniform vec3 uScale;
      uniform float uTilt;
      ${shader.vertexShader}
    `.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>

      transformed.y += 0.5;
      transformed.y *= uScale.y;
      transformed.xz *= uScale.xz;
      transformed.y -= 0.5 * uScale.y;

      float h = (transformed.y + 0.5 * uScale.y) / uScale.y;
      transformed.x += h * uTilt;

      float jiggle = sin(uTime * 15.0 + transformed.y * 2.0) * length(uVelocity.xz) * 0.01;
      transformed.x += jiggle * h;
      `,
    );
  };

  player = new THREE.Mesh(geometry, material);
  player.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
  scene.add(player);

  const playerDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z)
    .setCanSleep(false)
    .enabledRotations(false, false, false)
    .enabledTranslations(true, true, false);

  playerBody = world.createRigidBody(playerDesc);
  playerCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setFriction(0).setRestitution(0),
    playerBody,
  );

  // Add Rocket Visuals
  playerState.rocketMeshes = [];
  const rocketGeom = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 8);
  const rocketMat = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    metalness: 0.8,
    roughness: 0.2,
  });

  const leftRocket = new THREE.Mesh(rocketGeom, rocketMat);
  leftRocket.position.set(-0.6, 0, 0);
  player.add(leftRocket);
  playerState.rocketMeshes.push(leftRocket);

  const rightRocket = new THREE.Mesh(rocketGeom, rocketMat);
  rightRocket.position.set(0.6, 0, 0);
  player.add(rightRocket);
  playerState.rocketMeshes.push(rightRocket);

  // Thruster glow
  const glowGeom = new THREE.CylinderGeometry(0.1, 0, 0.4, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff4433,
    transparent: true,
    opacity: 0.8,
  });

  const leftGlow = new THREE.Mesh(glowGeom, glowMat);
  leftGlow.position.set(0, -0.4, 0);
  leftGlow.scale.set(0, 0, 0);
  leftRocket.add(leftGlow);

  const rightGlow = new THREE.Mesh(glowGeom, glowMat);
  rightGlow.position.set(0, -0.4, 0);
  rightGlow.scale.set(0, 0, 0);
  rightRocket.add(rightGlow);

  playerState.thrusterGlows = [leftGlow, rightGlow];
}

function triggerLandingCameraEffect(airborneTime, impactSpeed) {
  const fallStrength = clamp((airborneTime - 0.08) / 0.9, 0, 1);
  const impactStrength = clamp(Math.abs(impactSpeed) / 12, 0, 1);
  const shakeStrength = clamp(fallStrength * 0.8 + impactStrength * 0.35, 0, 1);

  if (shakeStrength <= 0) {
    return;
  }

  jumpCameraState.shake = Math.min(
    JUMP_CAMERA_SHAKE_MAX,
    jumpCameraState.shake + 0.18 + shakeStrength * 0.82,
  );

  const reference = playerBody ? playerBody.translation() : PLAYER_SPAWN;
  jumpCameraState.phase =
    playerState.jellyUniforms.uTime.value * 20 +
    reference.x * 1.3 +
    reference.y * 0.8 +
    airborneTime * 11.0;
}

function updateLandingCameraEffect(delta) {
  jumpCameraState.phase += delta * (18 + jumpCameraState.shake * 10);
  jumpCameraState.shake = Math.max(
    0,
    jumpCameraState.shake - delta * JUMP_CAMERA_SHAKE_DECAY,
  );
}

function triggerSpaceshipStrike(pos) {
  const rayGeo = new THREE.CylinderGeometry(0.5, 0.5, 200, 16);
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
  const ray = new THREE.Mesh(rayGeo, rayMat);
  ray.position.set(pos.x, pos.y + 100, pos.z);
  scene.add(ray);
  
  // Flash effect
  const flashGeo = new THREE.SphereGeometry(4, 32, 32);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(pos);
  scene.add(flash);

  triggerGameOver("spaceship", 2000);
}

function triggerGameOver(cause, delayMs = 0) {
  if (playerState.isGameOver) return;
  playerState.isGameOver = true;
  if (playerBody) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  
  const showUI = () => {
    if (cause === "fall") {
      uiManager.showGameOver("RUN COLLAPSED", "The gel dissolved in the void.");
    } else if (cause === "spaceship") {
      uiManager.showGameOver("GEL EVAPORATED", "Illegal altitude detected. Orbit enforcers triggered.");
    } else {
      uiManager.showGameOver("GEL DEPLETED", "You lost too much of yourself to go on.");
    }
  };

  if (delayMs > 0) {
    setTimeout(showUI, delayMs);
  } else {
    showUI();
  }
}

function drainGel(amount) {
  if (
    playerState.isGameOver ||
    levelState.isTransitioning ||
    levelState.isGameComplete ||
    playerState.isGodMode
  ) {
    return playerState.gelMass;
  }

  playerState.gelMass = Math.max(0, playerState.gelMass - amount);
  uiManager.updateHealth(playerState.gelMass);

  if (playerState.gelMass <= GEL_GAME_OVER_THRESHOLD) {
    triggerGameOver("depleted");
  }

  return playerState.gelMass;
}

function spawnParticles(
  x,
  y,
  z,
  color,
  count = 8,
  speedScale = 1.0,
  options = {},
) {
  const drainAmount =
    color === 0x44ff44 && options.drainGelTotal ? options.drainGelTotal : 0;

  if (drainAmount > 0) {
    drainGel(drainAmount);
    if (options.playImpactSound) {
      impactSoundController?.play();
    }
  }

  const particleScale =
    (color === 0x44ff44 ? Math.max(playerState.gelMass, 0.45) : 1.0) * (options.sizeScale ?? 1.0);
  const particleSize = 0.08 * particleScale;

  for (let index = 0; index < count; index += 1) {
    const particle = acquireParticle();
    particle.mesh.visible = true;
    particle.mesh.position.set(x, y, z);
    particle.mesh.scale.setScalar(particleSize);
    particle.mesh.material.color.setHex(color);
    particle.mesh.material.opacity = 1;

    particle.velocity.set(
      (Math.random() - 0.5) * 5.5 * speedScale,
      Math.random() * 6.5 * speedScale,
      (Math.random() - 0.5) * 2.5 * speedScale,
    );
    particle.life = 1.0;
    particle.lifeDecay = options.lifeDecay ?? 1.5;
    particles.push(particle);
  }

  return playerState.gelMass;
}

function acquireParticle() {
  const pooled = particlePool.find((particle) => !particle.active);
  if (pooled) {
    pooled.active = true;
    return pooled;
  }

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(PARTICLE_GEOMETRY, material);
  mesh.visible = false;
  scene.add(mesh);

  const particle = {
    active: true,
    mesh,
    velocity: new THREE.Vector3(),
    life: 0,
    lifeDecay: 1.5,
  };
  particlePool.push(particle);
  return particle;
}

function releaseParticle(particle) {
  particle.active = false;
  particle.life = 0;
  particle.mesh.visible = false;
}

function syncPlayerCollider(force = false) {
  const currentMass = playerState.gelMass;
  if (
    !playerCollider ||
    force ||
    !playerState._lastColliderMass ||
    Math.abs(playerState._lastColliderMass - currentMass) > 0.01
  ) {
    if (playerCollider) {
      world.removeCollider(playerCollider, false);
    }
    const halfSize = Math.max(0.05, 0.5 * currentMass);
    playerCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
        .setFriction(0)
        .setRestitution(0),
      playerBody,
    );
    playerState._lastColliderMass = currentMass;
  }
}

function clearPlatforms() {
  for (const platform of platforms) {
    scene.remove(platform.mesh);
    world.removeRigidBody(platform.body);
  }
  platforms.length = 0;
  levelState.finalPlatform = null;
}

function clearParticles() {
  for (const particle of particles) {
    releaseParticle(particle);
  }
  particles.length = 0;
}

function resetPlayerForLevel() {
  luaRuntime.callFunction(
    "onPlayerLevelReset",
    PLAYER_SPAWN.x,
    PLAYER_SPAWN.y,
    PLAYER_SPAWN.z,
  );
}

function buildLevel(levelNumber) {
  const profile = levelState.profiles[levelNumber - 1];
  if (!profile) {
    return;
  }

  clearPlatforms();
  clearParticles();
  clearPickups();

  levelState.currentLevel = levelNumber;
  levelState.currentProfile = profile;
  levelState.isTransitioning = false;
  levelState.transitionTimer = 0;
  levelState.pendingLevel = null;
  levelState.isGameComplete = false;
  playerState.isGameOver = false;

  for (const definition of profile.layout) {
    createPlatform(
      definition.x,
      definition.y,
      definition.z,
      definition.w,
      definition.h,
      definition.d,
      definition.color,
      {
        isFinal: definition.isFinal,
        definition,
        motionAmplitude: definition.motionAmplitude,
        motionSpeed: definition.motionSpeed,
        swingAmplitude: definition.swingAmplitude,
        swingSpeed: definition.swingSpeed,
        bobPhase: definition.bobPhase,
        rotationY: definition.rotationY,
        isDestroyable: definition.isDestroyable,
        hitsToBreak: definition.hitsToBreak,
      },
    );
  }

  for (const def of profile.pickups ?? []) {
    createPickup(def);
  }

  resetPlayerForLevel();
  uiManager.updateLevel(
    profile.level,
    LEVEL_COUNT,
    profile.isRespite,
    profile.label,
  );
  uiManager.updateMinimap(
    levelState.currentProfile,
    platforms,
    playerBody ? playerBody.translation() : null,
    true,
  );
}

function rebuildCurrentLevelPlatforms() {
  if (!levelState.currentProfile) return;
  clearPlatforms();
  for (const definition of levelState.currentProfile.layout) {
    createPlatform(
      definition.x,
      definition.y,
      definition.z,
      definition.w,
      definition.h,
      definition.d,
      definition.color,
      {
        isFinal: definition.isFinal,
        definition,
        shape: definition.shape,
        rotationY: definition.rotationY,
        motionAmplitude: definition.motionAmplitude,
        motionSpeed: definition.motionSpeed,
        swingAmplitude: definition.swingAmplitude,
        swingSpeed: definition.swingSpeed,
        bobPhase: definition.bobPhase,
        isDestroyable: definition.isDestroyable,
        hitsToBreak: definition.hitsToBreak,
      },
    );
  }
  clearPickups();
  for (const def of levelState.currentProfile.pickups ?? []) {
    createPickup(def);
  }
  uiManager.updateMinimap(
    levelState.currentProfile,
    platforms,
    playerBody ? playerBody.translation() : null,
    true,
  );
}

function startLevelTransition() {
  if (
    levelState.isTransitioning ||
    playerState.isGameOver ||
    levelState.isGameComplete
  ) {
    return;
  }

  const nextLevel = levelState.currentLevel + 1;
  levelState.isTransitioning = true;
  levelState.transitionTimer = 1.25; // 3 second delay
  levelState.pendingLevel = nextLevel <= LEVEL_COUNT ? nextLevel : "complete";

  winSoundController?.play();

  if (playerBody) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  if (levelState.finalPlatform) {
    const { x, y, z } = levelState.finalPlatform.mesh.position;
    // Colorful confetti spawn
    const confettiColors = [
      0xffd166, 0xff5f9d, 0x77ff88, 0x70e1ff, 0xff8a5b, 0xffffff,
    ];
    for (let c = 0; c < 8; c++) {
      const color =
        confettiColors[Math.floor(Math.random() * confettiColors.length)];
      spawnParticles(
        x + (Math.random() - 0.5) * 3,
        y + 1.2,
        z + (Math.random() - 0.5) * 3,
        color,
        15,
        2.2 + Math.random() * 0.8,
        { lifeDecay: 0.35 }, // Confetti lasts ~3 seconds
      );
    }
  }
}

function queueLevelRestart() {
  if (
    levelState.isTransitioning ||
    playerState.isGameOver ||
    levelState.isGameComplete
  ) {
    return;
  }

  levelState.isTransitioning = true;
  levelState.transitionTimer = 0.35;
  levelState.pendingLevel = levelState.currentLevel;

  if (playerBody) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function finishCampaign() {
  levelState.isGameComplete = true;
  levelState.isTransitioning = false;
  levelState.transitionTimer = 0;
  levelState.pendingLevel = null;
  uiManager.showGameComplete();
}

function sampleGroundHit(translation) {
  // Scale ray start with current collider half-size so the origin stays
  // just above the collider bottom regardless of how small the player is.
  // At full size (gelMass=1.0, halfSize=0.5): rayStartY = -0.4, matching the
  // original config. At smaller sizes the offset shrinks proportionally.
  const halfSize = Math.max(0.05, 0.5 * playerState.gelMass);
  const rayStartY = -(halfSize * 0.8);
  for (const xOffset of PLAYER_GROUND_RAY_OFFSETS) {
    const ray = new RAPIER.Ray(
      {
        x: translation.x + xOffset,
        y: translation.y + rayStartY,
        z: translation.z,
      },
      { x: 0, y: -1, z: 0 },
    );
    const hit = world.castRay(
      ray,
      PLAYER_GROUND_RAY_LENGTH,
      true,
      null,
      null,
      null,
      playerBody,
    );
    if (hit) {
      return hit;
    }
  }

  return null;
}

function updateCamera(targetPosition) {
  const targetCamXRaw = targetPosition.x * CAMERA_X_FOLLOW_FACTOR;
  const targetCamX = Math.max(
    -CAMERA_X_FOLLOW_CLAMP,
    Math.min(CAMERA_X_FOLLOW_CLAMP, targetCamXRaw),
  );
  const targetCamY = targetPosition.y + 4.8;
  const targetLookAtXRaw = targetPosition.x * CAMERA_LOOK_AT_X_FACTOR;
  const targetLookAtX = Math.max(
    -CAMERA_X_FOLLOW_CLAMP,
    Math.min(CAMERA_X_FOLLOW_CLAMP, targetLookAtXRaw),
  );

  camera.position.x += (targetCamX - camera.position.x) * 0.1;
  camera.position.y += (targetCamY - camera.position.y) * 0.1;
  camera.lookAt(targetLookAtX, targetPosition.y + 1.2, 0);

  if (jumpCameraState.shake > 0) {
    const shake = jumpCameraState.shake * JUMP_CAMERA_SHAKE_OFFSET;
    camera.position.x += Math.sin(jumpCameraState.phase * 1.7) * shake;
    camera.position.y += Math.cos(jumpCameraState.phase * 2.1) * shake * 0.75;
    camera.rotateZ(
      Math.sin(jumpCameraState.phase * 2.6) *
        jumpCameraState.shake *
        JUMP_CAMERA_SHAKE_ROLL,
    );
  }
}

function clampPlayerToViewX() {
  if (!playerBody) return;
  const translation = playerBody.translation();
  const zDist = camera.position.z - translation.z;
  const halfFovRad = (camera.fov / 2) * (Math.PI / 180);
  const halfWidth = Math.tan(halfFovRad) * camera.aspect * zDist;
  const margin = 0.5;
  const minX = camera.position.x - halfWidth + margin;
  const maxX = camera.position.x + halfWidth - margin;

  if (translation.x < minX || translation.x > maxX) {
    const clampedX = Math.max(minX, Math.min(maxX, translation.x));
    playerBody.setTranslation(
      { x: clampedX, y: translation.y, z: translation.z },
      true,
    );
    const vel = playerBody.linvel();
    if (
      (translation.x < minX && vel.x < 0) ||
      (translation.x > maxX && vel.x > 0)
    ) {
      playerBody.setLinvel({ x: 0, y: vel.y, z: vel.z }, true);
    }
  }
}

function updateTransition(delta) {
  if (!levelState.isTransitioning) {
    return;
  }

  levelState.transitionTimer = Math.max(0, levelState.transitionTimer - delta);
  if (levelState.transitionTimer > 0) {
    return;
  }

  if (levelState.pendingLevel === "complete") {
    finishCampaign();
    return;
  }

  if (typeof levelState.pendingLevel === "number") {
    buildLevel(levelState.pendingLevel);
  }
}

function updateParticles(delta) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= delta * (particle.lifeDecay || 1.5);
    particle.velocity.y += gameConfig.gravity * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.material.opacity = particle.life;

    if (particle.life <= 0) {
      releaseParticle(particle);
      particles.splice(index, 1);
    }
  }
}

function updatePlatforms(groundHitHandle, groundHitToi, delta) {
  const platformsToDestroy = [];

  for (const platform of platforms) {
    const isRayHit =
      groundHitHandle !== null && groundHitHandle === platform.collider.handle;

    if (isRayHit) {
      platform.steppedOnGrace = 0.1;
    } else if (platform.steppedOnGrace > 0) {
      platform.steppedOnGrace -= delta;
    }

    const isSteppedOn = isRayHit || platform.steppedOnGrace > 0;
    const wasSteppedOn = !!platform.wasSteppedOn;

    if (isSteppedOn && !wasSteppedOn && platform.isDestroyable && !platform.isFinal) {
      platform.hitsRemaining = Math.max(0, platform.hitsRemaining - 1);
      if (platform.hitsRemaining <= 0) {
        platformsToDestroy.push(platform);
        platform.wasSteppedOn = isSteppedOn;
        continue;
      }
    }

    platform.wasSteppedOn = isSteppedOn;

    const sinkDepth = platform.isFinal ? 0.42 : 0.58;
    const sinkSpeed = platform.isFinal ? 0.08 : 0.1;
    const returnSpeed = platform.isFinal ? 0.045 : 0.03;
    const bobOffset = platform.isFinal
      ? Math.sin(
          playerState.jellyUniforms.uTime.value * 1.8 + platform.bobPhase,
        ) * 0.08
      : platform.motionAmplitude > 0
        ? Math.sin(
            playerState.jellyUniforms.uTime.value * platform.motionSpeed +
              platform.bobPhase,
          ) * platform.motionAmplitude
        : 0;

    const targetY =
      (isSteppedOn ? platform.originalY - sinkDepth : platform.originalY) +
      bobOffset;
    const alpha = isSteppedOn ? sinkSpeed : returnSpeed;

    const prevY = platform.currentY;
    platform.currentY +=
      (targetY - platform.currentY) * alpha * Math.min(1, delta * 60);
    platform.lastVelY = delta > 0 ? (platform.currentY - prevY) / delta : 0;

    const prevX = platform.currentX;
    const swingOffset =
      platform.swingAmplitude > 0
        ? Math.cos(
            playerState.jellyUniforms.uTime.value * platform.swingSpeed +
              platform.bobPhase,
          ) * platform.swingAmplitude
        : 0;
    platform.currentX = platform.originalX + swingOffset;

    const halfSize = Math.max(0.05, 0.5 * playerState.gelMass);
    const isInContact = isRayHit && groundHitToi !== null && groundHitToi <= halfSize * 0.4;
    if (isInContact && delta > 0 && playerBody) {
      const platformVx = (platform.currentX - prevX) / delta;
      const vel = playerBody.linvel();
      // Match Y to platform unless the player is actively jumping above it
      const newVelY = vel.y > platform.lastVelY + 1.0 ? vel.y : platform.lastVelY;
      playerBody.setLinvel({ x: vel.x + platformVx, y: newVelY, z: vel.z }, true);
    }

    platform.body.setNextKinematicTranslation({
      x: platform.currentX,
      y: platform.currentY,
      z: platform.mesh.position.z,
    });
    platform.mesh.position.x = platform.currentX;
    platform.mesh.position.y = platform.currentY;
  }

  for (const platform of platformsToDestroy) {
    destroyPlatform(platform);
  }
}

function updatePickups(playerTranslation) {
  const time = playerState.jellyUniforms.uTime.value;
  for (const pickup of pickups) {
    if (pickup.collected) continue;
    pickup.mesh.position.y = pickup.def.y + Math.sin(time * 3.0 + pickup.def.x) * 0.12;
    pickup.mesh.rotation.y = time * 1.8 + (pickup.def.rotationY ?? 0);

    if (!playerTranslation || playerState.isGameOver || levelState.isTransitioning || levelState.isGameComplete) continue;
    const dx = pickup.def.x - playerTranslation.x;
    const dy = pickup.def.y - playerTranslation.y;
    const dz = pickup.def.z - playerTranslation.z;
    if (dx * dx + dy * dy + dz * dz < 0.81) {
      pickup.collected = true;
      scene.remove(pickup.mesh);
      pickup.mesh.geometry.dispose();
      pickup.mesh.material.dispose();
      if (pickup.type === "health") {
        const amount = pickup.def.amount ?? pickupConfig.health.amount;
        playerState.pendingHealthRestore += amount;
        spawnParticles(pickup.def.x, pickup.def.y, pickup.def.z, 0x44ff88, 10, 0.9, {});
      } else if (pickup.type === "rocket") {
        const amount = pickup.def.amount ?? pickupConfig.rocket.amount;
        playerState.pendingRocketFuel += amount;
        spawnParticles(pickup.def.x, pickup.def.y, pickup.def.z, 0xff4433, 10, 0.9, {});
      }
    }
  }
}

function updateFrame(rawDelta) {
  const delta = Math.min(rawDelta, 1 / 30);
  updateParticles(delta);

  if (playerState.isGameOver || levelState.isGameComplete) {
    return;
  }

  updateTransition(delta);
  if (playerState.isGameOver || levelState.isGameComplete) {
    return;
  }

  world.integrationParameters.dt = delta;
  world.step();
  luaRuntime.callFunction("onUpdate", delta);
  clampPlayerToViewX();
  const snapshot = getPlayerSnapshot();
  if (!snapshot) {
    return;
  }

  updateLandingCameraEffect(delta);
  updatePlatforms(snapshot.groundHitHandle, snapshot.groundHitToi, delta);
  updatePickups(snapshot.translation);

  if (snapshot.isGameOver || levelState.isGameComplete) {
    player.position.copy(snapshot.translation);
    updateCamera(snapshot.translation);
    return;
  }

  player.position.copy(snapshot.translation);
  updateCamera(snapshot.translation);
  uiManager.updateMinimap(
    levelState.currentProfile,
    platforms,
    snapshot.translation,
  );
}

function animate() {
  animationId = requestAnimationFrame(animate);

  if (!gameplayState.manualStepMode && !gameplayState.isPaused && !gameplayState.isTitleScreen) {
    updateFrame(clock.getDelta());
  }

  if (levelEditorRef?.isOpen()) {
    levelEditorRef.tick();
  }

  renderer.render(scene, camera);
}

function getPortraitSize() {
  const h = window.innerHeight;
  const w = Math.min(window.innerWidth, Math.round(h * 9 / 16));
  return { width: w, height: h };
}

function onWindowResize() {
  const { width, height } = getPortraitSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  applyRendererQuality();
  renderer.setSize(width, height);
  const gameWrap = document.getElementById('game-wrap');
  gameWrap.style.width = width + 'px';
  gameWrap.style.height = height + 'px';
  uiManager.resizeMinimap();
}

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildLevelProfilesFromFiles(modules) {
  const profiles = [];
  for (let level = 1; level <= LEVEL_COUNT; level += 1) {
    const key = `../configs/levels/level${level}.json`;
    const profile = modules[key];
    if (!profile) throw new Error(`Missing level file: ${key}`);
    profiles.push(profile);
  }
  return profiles;
}

function setupTestingHooks() {
  window.render_game_to_text = () =>
    JSON.stringify({
      mode: playerState.isGameOver
        ? "game_over"
        : levelState.isGameComplete
          ? "game_complete"
          : levelState.isTransitioning
            ? "transition"
            : "playing",
      coordinateSystem: "x right, y up, z depth toward camera",
      level: {
        current: levelState.currentLevel,
        total: LEVEL_COUNT,
        label: levelState.currentProfile?.label ?? "",
        respite: !!levelState.currentProfile?.isRespite,
        routeAxis: "vertical",
      },
      camera: {
        shake: Number(jumpCameraState.shake.toFixed(3)),
        phase: Number(jumpCameraState.phase.toFixed(3)),
      },
      player: playerBody
        ? {
            x: Number(playerBody.translation().x.toFixed(2)),
            y: Number(playerBody.translation().y.toFixed(2)),
            vx: Number(playerBody.linvel().x.toFixed(2)),
            vy: Number(playerBody.linvel().y.toFixed(2)),
            airborneTime: Number(playerState.airborneTime.toFixed(3)),
            lastLandingAirTime: Number(
              playerState.lastLandingAirTime.toFixed(3),
            ),
            lastLandingImpactSpeed: Number(
              playerState.lastLandingImpactSpeed.toFixed(3),
            ),
            gelMass: Number(playerState.gelMass.toFixed(3)),
            rocketLevel: Number(playerState.rocketLevel.toFixed(3)),
            rocketActive: playerState.isRocketActive,
            godMode: playerState.isGodMode,
            rocketBoy: playerState.isRocketBoy,
          }
        : null,
      platforms: platforms.map((platform) => ({
        x: Number(platform.mesh.position.x.toFixed(2)),
        y: Number(platform.mesh.position.y.toFixed(2)),
        final: platform.isFinal,
        shape: platform.shape,
        rotationY: Number(platform.rotationY.toFixed(3)),
        destroyable: platform.isDestroyable,
        hitsRemaining: platform.hitsRemaining,
        motionAmplitude: Number(platform.motionAmplitude.toFixed(3)),
        motionSpeed: Number(platform.motionSpeed.toFixed(3)),
        swingAmplitude: Number(platform.swingAmplitude.toFixed(3)),
        swingSpeed: Number(platform.swingSpeed.toFixed(3)),
      })),
    });

  window.advanceTime = (ms = 16.67) => {
    gameplayState.manualStepMode = true;
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let index = 0; index < steps; index += 1) {
      updateFrame(1 / 60);
    }
    renderer.render(scene, camera);
  };

  window.setLevelForDebug = (levelNumber) => {
    const nextLevel = clamp(Math.round(levelNumber), 1, LEVEL_COUNT);
    buildLevel(nextLevel);
  };

  window.retryLevel = () => {
    buildLevel(1);
  };

  if (uiManager.escResumeBtn) {
    uiManager.escResumeBtn.addEventListener("click", () => {
      closeEscMenu();
    });
  }

  if (uiManager.escRestartBtn) {
    uiManager.escRestartBtn.addEventListener("click", () => {
      closeEscMenu();
      buildLevel(1);
    });
  }

  if (uiManager.escOptionsBtn) {
    uiManager.escOptionsBtn.addEventListener("click", () => {
      openOptions();
    });
  }

  if (uiManager.escMainMenuBtn) {
    uiManager.escMainMenuBtn.addEventListener("click", () => {
      closeEscMenu();
      buildLevel(1);
      gameplayState.isTitleScreen = true;
      uiManager.showTitleScreen();
    });
  }

  initOptionsUI();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("pointerdown", primeBackgroundMusic);
  });
}

init();
