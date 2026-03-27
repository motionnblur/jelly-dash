import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { luaRuntime } from "./LuaRuntime";
import { uiManager } from "../ui/UIManager";

const luaModules = import.meta.glob("../scripts/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
});

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

const platforms = [];
const particles = [];
const keys = {};

const SKY_COLOR = 0x060914;
const FOG_COLOR = 0x0b1020;
const LEVEL_COUNT = 50;
const LEVEL_SEED = 0x5f3759df;
const PLATFORM_HEIGHT = 0.5;
const PLAYER_SPAWN = { x: 0, y: 2.15, z: 0 };
const MAX_SAFE_LEVEL_DRAIN = 0.9;
const JUMP_GEL_COST = 0.04;
const WALK_GEL_COST = 0.018;
const WALK_STEP_DISTANCE = 2.0;
const GEL_CRITICAL_THRESHOLD = 0.28;
const GEL_GAME_OVER_THRESHOLD = 0.0;
const PLAYER_GROUND_RAY_OFFSETS = [-0.45, -0.22, 0, 0.22, 0.45];
const PLAYER_GROUND_RAY_START_Y = -0.4;
const PLAYER_GROUND_RAY_LENGTH = 0.6;
const PLAYER_GROUND_COYOTE_TIME = 0.14;
const JUMP_CAMERA_SHAKE_MAX = 1;
const JUMP_CAMERA_SHAKE_DECAY = 4.2;
const JUMP_CAMERA_SHAKE_OFFSET = 0.22;
const JUMP_CAMERA_SHAKE_ROLL = 0.018;

const ROCKET_THRUST = 1;
const ROCKET_DRAIN_RATE = 0.8; // per second
const ROCKET_REFILL_RATE = 0.05; // per second
const ROCKET_GEL_COST = 0.1; // extra gel drain per second of flight

const LEVEL_PATTERNS = ["glide", "pulse", "switchback", "crest"];
const LEVEL_COLORS = [
  0x70e1ff, 0xff8a5b, 0x77ff88, 0xff5f9d, 0x8b7dff, 0xffd166,
];

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
  rocketMeshes: [],
  rocketSpin: 0,
  rocketSpinBaseDirection: 1,
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
};

const jumpCameraState = {
  shake: 0,
  phase: 0,
};

const gameConfig = {
  playerSpeed: 8,
  jumpImpulse: 12,
  gravity: -19.6,
};

const existingCanvas = document.querySelector("canvas");
if (existingCanvas) {
  existingCanvas.remove();
}

async function init() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: gameConfig.gravity, z: 0 });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 12, 120);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 4.4, 14);
  camera.lookAt(0, 2.2, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(SKY_COLOR, 1);
  document.body.appendChild(renderer.domElement);

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
      spawnPlayer: (x, y, z) => {
        if (!player) createPlayer();
        playerBody.setTranslation({ x, y, z }, true);
      },
      setGravity: (y) => {
        gameConfig.gravity = y;
        world.gravity = { x: 0, y, z: 0 };
      },
      isKeyDown: (code) => !!keys[code],
      applyImpulse: (x, y, z) => {
        if (playerBody) playerBody.applyImpulse({ x, y, z }, true);
      },
      getVelocity: () => {
        if (!playerBody) return { x: 0, y: 0, z: 0 };
        const velocity = playerBody.linvel();
        return { x: velocity.x, y: velocity.y, z: velocity.z };
      },
    },
  });

  for (const path in luaModules) {
    const fileName = path.split("/").pop();
    await luaRuntime.mountFile(fileName, luaModules[path]);
  }

  await luaRuntime.run('require("init")');

  levelState.profiles = buildLevelProfiles();
  buildLevel(1);
  setupTestingHooks();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onWindowResize);

  uiManager.removeLoadingScreen();
  animate();
}

function onKeyDown(event) {
  if (event.code === "F1") {
    event.preventDefault();
    uiManager.toggleConsole();
    return;
  }

  // Ignore game input if typing in an input field
  if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
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

function createPlatform(x, y, z, w, h, d, color, options = {}) {
  const radius = Math.max(w, d) / 2;
  const geometry = new THREE.CylinderGeometry(radius, radius, h, 6);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: options.isFinal ? 0xffd166 : color,
    emissiveIntensity: options.isFinal ? 0.55 : 0.24,
    metalness: options.isFinal ? 0.62 : 0.35,
    roughness: options.isFinal ? 0.18 : 0.26,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.PI / 6;

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
  const offset = Math.PI / 6;
  for (let index = 0; index < 6; index += 1) {
    const angle = (index * Math.PI) / 3 + offset;
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
    definition: options.definition ?? null,
  };

  platforms.push(platform);
  if (platform.isFinal) {
    levelState.finalPlatform = platform;
  }

  return platform;
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
    .enabledRotations(false, false, false);

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

function triggerGameOver(cause) {
  if (playerState.isGameOver) return;
  playerState.isGameOver = true;
  if (playerBody) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  
  if (cause === "fall") {
    uiManager.showGameOver("RUN COLLAPSED", "The gel dissolved in the void.");
  } else {
    uiManager.showGameOver("GEL DEPLETED", "You lost too much of yourself to go on.");
  }
}

function drainGel(amount) {
  if (
    playerState.isGameOver ||
    levelState.isTransitioning ||
    levelState.isGameComplete
  ) {
    return;
  }

  playerState.gelMass = Math.max(0, playerState.gelMass - amount);
  uiManager.updateHealth(playerState.gelMass);

  if (playerState.gelMass <= GEL_GAME_OVER_THRESHOLD) {
    triggerGameOver("depleted");
  }
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
  }

  const particleScale =
    (color === 0x44ff44 ? Math.max(playerState.gelMass, 0.45) : 1.0) * (options.sizeScale ?? 1.0);
  const particleSize = 0.08 * particleScale;

  for (let index = 0; index < count; index += 1) {
    const geometry = new THREE.SphereGeometry(particleSize, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.45,
      transparent: true,
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.set(x, y, z);

    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 5.5 * speedScale,
      Math.random() * 6.5 * speedScale,
      (Math.random() - 0.5) * 2.5 * speedScale,
    );

    scene.add(particle);
    particles.push({
      mesh: particle,
      velocity,
      life: 1.0,
      lifeDecay: options.lifeDecay ?? 1.5,
    });
  }
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
    const halfSize = 0.5 * currentMass;
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
    scene.remove(particle.mesh);
    particle.mesh.geometry.dispose();
    particle.mesh.material.dispose();
  }
  particles.length = 0;
}

function resetPlayerForLevel() {
  playerState.gelMass = 1.0;
  playerState.isGameOver = false;
  playerState.lastGrounded = true;
  playerState.lastVelY = 0;
  playerState.airborneTime = 0;
  playerState.lastLandingAirTime = 0;
  playerState.lastLandingImpactSpeed = 0;
  playerState.particleTimer = 0;
  playerState.walkDistanceAccumulator = 0;
  playerState.groundedCoyoteTimer = 0;
  playerState.spawnLandingGrace = true;
  playerState.jellyUniforms.uVelocity.value.set(0, 0, 0);
  playerState.jellyUniforms.uImpact.value = 0;
  playerState.jellyUniforms.uTime.value = 0;
  playerState.jellyUniforms.uScale.value.set(1, 1, 1);
  playerState.jellyUniforms.uTilt.value = 0;
  playerState._lastColliderMass = null;
  jumpCameraState.phase = 0;
  playerState.rocketLevel = 1.0;
  playerState.isRocketActive = false;
  playerState.rocketSpin = 0;

  if (playerBody) {
    playerBody.setTranslation(PLAYER_SPAWN, true);
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    syncPlayerCollider(true);
  }

  if (player) {
    player.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
  }

  camera.position.set(0, 4.4, 14);
  camera.lookAt(0, 2.2, 0);
  uiManager.hideGameOver();
  uiManager.hideGameComplete();
  uiManager.updateHealth(playerState.gelMass);
}

function buildLevel(levelNumber) {
  const profile = levelState.profiles[levelNumber - 1];
  if (!profile) {
    return;
  }

  clearPlatforms();
  clearParticles();

  levelState.currentLevel = levelNumber;
  levelState.currentProfile = profile;
  levelState.isTransitioning = false;
  levelState.transitionTimer = 0;
  levelState.pendingLevel = null;
  levelState.isGameComplete = false;

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
      },
    );
  }

  resetPlayerForLevel();
  uiManager.updateLevel(
    profile.level,
    LEVEL_COUNT,
    profile.isRespite,
    profile.label,
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

function handleInput() {
  const velocity = playerBody.linvel();
  const translation = playerBody.translation();
  let moveX = 0;
  const hit = sampleGroundHit(translation);
  const isGrounded = hit !== null;
  playerState.groundedCoyoteTimer = isGrounded
    ? PLAYER_GROUND_COYOTE_TIME
    : Math.max(0, playerState.groundedCoyoteTimer - 1 / 60);
  const canJump = isGrounded || playerState.groundedCoyoteTimer > 0;

  if (!levelState.isTransitioning && !levelState.isGameComplete) {
    if (keys["KeyA"] || keys["ArrowLeft"]) moveX -= gameConfig.playerSpeed;
    if (keys["KeyD"] || keys["ArrowRight"]) moveX += gameConfig.playerSpeed;

    if (keys.Space && canJump) {
      playerBody.setLinvel(
        { x: velocity.x, y: gameConfig.jumpImpulse, z: velocity.z },
        true,
      );
      playerState.groundedCoyoteTimer = 0;
      spawnParticles(
        translation.x,
        translation.y - 0.4,
        translation.z,
        0x44ff44,
        8,
        1.0,
        { drainGelTotal: JUMP_GEL_COST },
      );
    }
  }

  if (!keys.Space && velocity.y > 0) {
    playerBody.setLinvel(
      { x: velocity.x, y: velocity.y * 0.9, z: velocity.z },
      true,
    );
  }

  playerBody.setLinvel({ x: moveX, y: playerBody.linvel().y, z: 0 }, true);
  return { translation, hit, isGrounded };
}

function sampleGroundHit(translation) {
  for (const xOffset of PLAYER_GROUND_RAY_OFFSETS) {
    const ray = new RAPIER.Ray(
      {
        x: translation.x + xOffset,
        y: translation.y + PLAYER_GROUND_RAY_START_Y,
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

function updateRocketPhysics(delta) {
  if (playerState.isGameOver || levelState.isTransitioning) {
    playerState.isRocketActive = false;
    return;
  }

  const isShiftPressed = keys["ShiftLeft"] || keys["ShiftRight"];
  const hasFuel = playerState.rocketLevel > 0;
  const translation = playerBody.translation();

  if (isShiftPressed && hasFuel) {
    if (!playerState.isRocketActive) {
      // Pick a random spin direction on ignition
      playerState.rocketSpinBaseDirection = Math.random() < 0.5 ? 1 : -1;
    }
    playerState.isRocketActive = true;
    playerState.rocketLevel = Math.max(
      0,
      playerState.rocketLevel - ROCKET_DRAIN_RATE * delta,
    );

    // Apply thrust
    const currentVel = playerBody.linvel();
    playerBody.setLinvel(
      {
        x: currentVel.x,
        y: currentVel.y + ROCKET_THRUST,
        z: currentVel.z,
      },
      true,
    );

    // Drain extra gel for being a rocket
    drainGel(ROCKET_GEL_COST * delta);

    // Thruster effects
    playerState.thrusterGlows.forEach((glow) => {
      glow.scale.set(1, 1 + Math.random() * 0.5, 1);
    });

    if (Math.random() < 0.3) {
      spawnParticles(
        translation.x + (Math.random() - 0.5) * 1.2,
        translation.y - 0.5,
        translation.z,
        0xff4433,
        4,
        0.5,
        { sizeScale: 2.0 },
      );
    }
  } else {
    playerState.isRocketActive = false;

    // ONLY refill if Shift is NOT being held.
    // This prevents "stutter-flight" where the player hovers at 0 fuel by consuming the tiny refill amount every frame.
    if (!isShiftPressed) {
      playerState.rocketLevel = Math.min(
        1.0,
        playerState.rocketLevel + ROCKET_REFILL_RATE * delta,
      );
    }

    playerState.thrusterGlows.forEach((glow) => {
      glow.scale.set(0, 0, 0);
    });
  }

  uiManager.updateRocket(playerState.rocketLevel, playerState.isRocketActive);

  // Sync rocket positions to player scale
  const scaleXZ = playerState.jellyUniforms.uScale.value.x;
  if (playerState.rocketMeshes[0])
    playerState.rocketMeshes[0].position.x = -0.5 * scaleXZ - 0.1;
  if (playerState.rocketMeshes[1])
    playerState.rocketMeshes[1].position.x = 0.5 * scaleXZ + 0.1;

  // Manual spinning logic
  if (playerState.isRocketActive) {
    const horizontalMove =
      (keys["KeyD"] || keys["ArrowRight"] ? 1 : 0) -
      (keys["KeyA"] || keys["ArrowLeft"] ? 1 : 0);
    
    // Constant base spin + extra spin when moving sideways
    const spinSpeed = 10.0 + Math.abs(horizontalMove) * 12.0;
    const spinDirection = horizontalMove !== 0 ? -horizontalMove : playerState.rocketSpinBaseDirection;
    
    playerState.rocketSpin += delta * spinSpeed * spinDirection;
  } else {
    // Smoothly return rotation to zero when not boosting
    playerState.rocketSpin *= Math.max(0, 1 - delta * 6.0);
  }

  player.rotation.y = playerState.rocketSpin;
  player.rotation.z = 0;
}

function updateCamera(targetPosition) {
  const targetCamX = targetPosition.x * 0.15;
  const targetCamY = targetPosition.y + 4.8;

  camera.position.x += (targetCamX - camera.position.x) * 0.1;
  camera.position.y += (targetCamY - camera.position.y) * 0.1;
  camera.lookAt(targetPosition.x * 0.12, targetPosition.y + 1.2, 0);

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
      scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      particle.mesh.material.dispose();
      particles.splice(index, 1);
    }
  }
}

function updatePlatforms(hit, delta) {
  for (const platform of platforms) {
    const isSteppedOn = hit && hit.collider.handle === platform.collider.handle;
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

    platform.currentY +=
      (targetY - platform.currentY) * alpha * Math.min(1, delta * 60);

    const swingOffset =
      platform.swingAmplitude > 0
        ? Math.cos(
            playerState.jellyUniforms.uTime.value * platform.swingSpeed +
              platform.bobPhase,
          ) * platform.swingAmplitude
        : 0;
    platform.currentX = platform.originalX + swingOffset;

    platform.body.setNextKinematicTranslation({
      x: platform.currentX,
      y: platform.currentY,
      z: platform.mesh.position.z,
    });
    platform.mesh.position.x = platform.currentX;
    platform.mesh.position.y = platform.currentY;
  }
}

function updateWalkDrain(delta, isGrounded, velocity) {
  if (
    !isGrounded ||
    Math.abs(velocity.x) < 0.25 ||
    levelState.isTransitioning
  ) {
    return;
  }

  playerState.walkDistanceAccumulator += Math.abs(velocity.x) * delta;
  if (playerState.walkDistanceAccumulator < WALK_STEP_DISTANCE) {
    return;
  }

  playerState.walkDistanceAccumulator -= WALK_STEP_DISTANCE;
  const translation = playerBody.translation();
  spawnParticles(
    translation.x + (Math.random() - 0.5) * 0.35,
    translation.y - 0.48,
    translation.z,
    0x44ff44,
    4,
    0.75,
    { drainGelTotal: WALK_GEL_COST },
  );
}

function updateJelly(delta, isGrounded) {
  const velocity = playerBody.linvel();
  playerState.jellyUniforms.uTime.value += delta;

  if (isGrounded && !playerState.lastGrounded) {
    const impactSpeed = Math.abs(playerState.lastVelY || 0);
    playerState.jellyUniforms.uImpact.value = impactSpeed;
    playerState.lastLandingAirTime = playerState.airborneTime;
    playerState.lastLandingImpactSpeed = impactSpeed;
    triggerLandingCameraEffect(playerState.airborneTime, impactSpeed);

    if (playerState.spawnLandingGrace) {
      playerState.spawnLandingGrace = false;
    } else {
      const particleCount = Math.min(6 + Math.floor(impactSpeed), 18);
      const speedScale = 0.3 + impactSpeed / 12;
      const pos = playerBody.translation();
      spawnParticles(
        pos.x,
        pos.y - 0.5 * playerState.jellyUniforms.uScale.value.y,
        pos.z,
        0x44ff44,
        particleCount,
        speedScale,
      );
    }
  }

  if (isGrounded) {
    playerState.airborneTime = 0;
  } else {
    playerState.airborneTime += delta;
  }

  playerState.lastGrounded = isGrounded;
  playerState.lastVelY = velocity.y;

  let targetScaleY = 1.0;
  let targetScaleXZ = 1.0;

  if (!isGrounded) {
    const stretch = Math.abs(velocity.y) * 0.025;
    targetScaleY = 1.0 + stretch;
    targetScaleXZ = 1.0 - stretch * 0.5;
  } else {
    const speedFactor = Math.abs(velocity.x) * 0.02;
    targetScaleXZ = 1.0 + speedFactor;
    targetScaleY = 1.0 - speedFactor * 0.2;
  }

  targetScaleY *= playerState.gelMass;
  targetScaleXZ *= playerState.gelMass;

  const stiffness = 15.0;
  playerState.jellyUniforms.uScale.value.y +=
    (targetScaleY - playerState.jellyUniforms.uScale.value.y) *
    stiffness *
    delta;
  playerState.jellyUniforms.uScale.value.x +=
    (targetScaleXZ - playerState.jellyUniforms.uScale.value.x) *
    stiffness *
    delta;
  playerState.jellyUniforms.uScale.value.z =
    playerState.jellyUniforms.uScale.value.x;

  const targetTilt = velocity.x * -0.05;
  playerState.jellyUniforms.uTilt.value +=
    (targetTilt - playerState.jellyUniforms.uTilt.value) * 10.0 * delta;

  playerState.jellyUniforms.uVelocity.value.set(
    velocity.x,
    velocity.y,
    velocity.z,
  );
}

function updateFrame(delta) {
  updateParticles(delta);

  if (playerState.isGameOver || levelState.isGameComplete) {
    return;
  }

  updateTransition(delta);
  if (playerState.isGameOver || levelState.isGameComplete) {
    return;
  }

  world.step();
  luaRuntime.callFunction("onUpdate", delta);

  const { translation, hit, isGrounded } = handleInput();
  const velocity = playerBody.linvel();

  syncPlayerCollider();
  updateJelly(delta, isGrounded);
  updateLandingCameraEffect(delta);
  updateWalkDrain(delta, isGrounded, velocity);
  updatePlatforms(hit, delta);
  updateRocketPhysics(delta);

  if (
    hit &&
    levelState.finalPlatform &&
    hit.collider.handle === levelState.finalPlatform.collider.handle
  ) {
    startLevelTransition();
  }

  if (translation.y < -10) {
    triggerGameOver("fall");
  }

  player.position.copy(translation);
  updateCamera(translation);
}

function animate() {
  animationId = requestAnimationFrame(animate);

  if (!gameplayState.manualStepMode) {
    updateFrame(clock.getDelta());
  }

  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

// Levels 1-5 are a flat intro zone mapped to the first 8% of the difficulty range.
// After level 5, the curve accelerates via a power function so mid-game difficulty
// arrives much earlier than a linear ramp would produce.
function applyDifficultyCurve(rawProgress) {
  const cutoff = 4 / (LEVEL_COUNT - 1); // raw progress at end of level 5
  if (rawProgress <= cutoff) {
    return rawProgress * (0.08 / cutoff);
  }
  const t = (rawProgress - cutoff) / (1 - cutoff);
  return 0.08 + Math.pow(t, 0.62) * 0.92;
}

function buildLevelProfiles() {
  const rng = mulberry32(LEVEL_SEED);
  const profiles = [];
  let levelsSinceRespite = 9;

  for (let level = 1; level <= LEVEL_COUNT; level += 1) {
    let isRespite = false;

    if (level > 3 && level < LEVEL_COUNT) {
      const mustInsert = levelsSinceRespite >= 8;
      const canInsert = levelsSinceRespite >= 4;
      if (mustInsert || (canInsert && rng() < 0.22 + level * 0.002)) {
        isRespite = true;
        levelsSinceRespite = 0;
      } else {
        levelsSinceRespite += 1;
      }
    } else {
      levelsSinceRespite += 1;
    }

    profiles.push(generateLevelProfile(level, isRespite));
  }

  return profiles;
}

function generateLevelProfile(level, isRespite) {
  const rng = mulberry32((LEVEL_SEED ^ (level * 0x9e3779b9)) >>> 0);
  const rawProgress = (level - 1) / (LEVEL_COUNT - 1);
  const progress = applyDifficultyCurve(rawProgress);
  const softenedProgress = isRespite
    ? Math.max(0, progress - 0.08 - rng() * 0.03)
    : progress;
  const earlyPressure = Math.max(0, 1 - rawProgress / 0.22);
  const earlyCurveBoost = earlyPressure * (isRespite ? 0.03 : 0.085);
  const shapeProgress = clamp(softenedProgress + earlyCurveBoost, 0, 1);
  const platformCount = clamp(
    Math.round(
      3 +
        shapeProgress * 8.0 +
        rng() * 1.5 +
        (progress > 0.7 ? 0.8 : 0) +
        earlyPressure * (isRespite ? 0.35 : 0.95),
    ),
    3,
    10,
  );
  const platformDiameter =
    lerp(4.2, 2.55, shapeProgress) +
    (isRespite ? 0.28 : 0) -
    earlyPressure * (isRespite ? 0.05 : 0.18);
  const verticalGapBase =
    lerp(2.45, 3.55, shapeProgress) -
    (isRespite ? 0.28 : 0) +
    earlyPressure * (isRespite ? 0.04 : 0.24);
  const verticalGapVariance =
    lerp(0.14, 0.58, shapeProgress) * (isRespite ? 0.76 : 1) +
    earlyPressure * (isRespite ? 0.02 : 0.05);
  const minX = lerp(-0.65, -2.15, shapeProgress) - (isRespite ? 0.18 : 0);
  const maxX = lerp(0.65, 2.15, shapeProgress) + (isRespite ? 0.18 : 0);
  const swayRightMax =
    lerp(0.22, 1.45, shapeProgress) * (isRespite ? 0.76 : 1) +
    earlyPressure * (isRespite ? 0.03 : 0.15);
  const swayLeftMax =
    lerp(0.18, 1.1, shapeProgress) * (isRespite ? 0.74 : 1) +
    earlyPressure * (isRespite ? 0.02 : 0.12);
  const pattern = isRespite
    ? "plateau"
    : LEVEL_PATTERNS[Math.floor(rng() * LEVEL_PATTERNS.length)];
  const hasWavingPlatforms = level > 5;
  const hasSwingingPlatforms = level >= 3;

  let gapScale = 1;
  let layout = [];
  let estimatedDrain = 1;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    layout = createLayoutCandidate({
      platformCount,
      platformDiameter,
      verticalGapBase,
      verticalGapVariance,
      minX,
      maxX,
      swayRightMax,
      swayLeftMax,
      pattern,
      gapScale,
      progress: shapeProgress,
      rng,
      isRespite,
      earlyPressure,
      level,
      hasWavingPlatforms,
      hasSwingingPlatforms,
    });
    estimatedDrain = estimateLayoutDrain(layout);
    if (estimatedDrain <= MAX_SAFE_LEVEL_DRAIN) {
      break;
    }
    gapScale *= 0.92;
  }

  return {
    level,
    isRespite,
    label: buildLevelLabel(level, softenedProgress, isRespite),
    estimatedDrain,
    layout,
  };
}

function createLayoutCandidate(config) {
  const {
    platformCount,
    platformDiameter,
    verticalGapBase,
    verticalGapVariance,
    minX,
    maxX,
    swayRightMax,
    swayLeftMax,
    pattern,
    gapScale,
    progress,
    rng,
    isRespite,
    earlyPressure,
    level,
    hasWavingPlatforms,
    hasSwingingPlatforms,
  } = config;

  const layout = [];
  let x = 0;
  let y = -1.6;

  for (let index = 0; index < platformCount; index += 1) {
    const gapNoise = (rng() * 2 - 1) * verticalGapVariance;
    const gap = Math.max(2.25, (verticalGapBase + gapNoise) * gapScale);
    y += index === 0 ? gap * 0.82 : gap;

    const diameterNoise = (rng() * 2 - 1) * 0.32 + (index % 3 === 0 ? 0.06 : 0);
    const sizeShrinkProgress = clamp((level - 3) / 9, 0, 1);
    const sizeShrink =
      level >= 3 && index > 0
        ? (0.06 +
            rng() * 0.1 +
            sizeShrinkProgress * 0.16 +
            (index % 2 === 1 ? 0.05 : 0)) *
          (isRespite ? 0.72 : 1)
        : 0;
    const diameter = clamp(
      platformDiameter + diameterNoise - sizeShrink,
      1.95,
      4.6,
    );

    x = computePlatformSway({
      index,
      platformCount,
      x,
      minX,
      maxX,
      swayRightMax,
      swayLeftMax,
      pattern,
      rng,
      earlyPressure,
    });

    const rawSwingAmp =
      0.22 + rng() * 0.28 + Math.min(0.2, Math.max(0, level - 12) * 0.009);
    const rawSwingSpeed = 0.55 + rng() * 0.65;
    const hasSwing =
      hasSwingingPlatforms && !isRespite && index > 0 && index % 2 === 1;

    layout.push({
      x,
      y,
      z: 0,
      w: diameter,
      h: PLATFORM_HEIGHT,
      d: diameter,
      color:
        LEVEL_COLORS[(index + Math.floor(progress * 6)) % LEVEL_COLORS.length],
      isFinal: false,
      bobPhase: ((level * 31 + index * 17) % 360) * (Math.PI / 180),
      motionAmplitude:
        hasWavingPlatforms && !isRespite && index > 0
          ? 0.18 + rng() * 0.16 + Math.min(0.08, Math.max(0, level - 6) * 0.004)
          : 0,
      motionSpeed:
        hasWavingPlatforms && !isRespite && index > 0
          ? 1.7 + rng() * 0.9 + Math.min(0.45, Math.max(0, level - 6) * 0.02)
          : 0,
      swingAmplitude: hasSwing ? rawSwingAmp : 0,
      swingSpeed: hasSwing ? rawSwingSpeed : 0,
    });
  }

  const finalGap = Math.max(
    2.45,
    (verticalGapBase +
      0.38 +
      rng() * verticalGapVariance +
      earlyPressure * (isRespite ? 0.06 : 0.16)) *
      gapScale,
  );
  const finalX = clamp(
    x + (isRespite ? 0.04 : (rng() - 0.25) * Math.min(swayRightMax, 0.55)),
    minX,
    maxX,
  );
  const finalDiameter = clamp(
    platformDiameter + 0.22 + (isRespite ? 0.18 : 0),
    3.0,
    4.7,
  );

  layout.push({
    x: finalX,
    y: y + finalGap,
    z: 0,
    w: finalDiameter,
    h: PLATFORM_HEIGHT,
    d: finalDiameter,
    color: 0xffd166,
    isFinal: true,
    bobPhase: ((level * 31 + platformCount * 17 + 11) % 360) * (Math.PI / 180),
    motionAmplitude: 0,
    motionSpeed: 0,
    swingAmplitude: 0,
    swingSpeed: 0,
  });

  return layout;
}

function computePlatformSway(config) {
  const {
    index,
    platformCount,
    x,
    minX,
    maxX,
    swayRightMax,
    swayLeftMax,
    pattern,
    rng,
    earlyPressure,
  } = config;
  const ratio = platformCount <= 1 ? 1 : index / (platformCount - 1);
  let delta = 0;

  switch (pattern) {
    case "glide":
      delta = lerp(0.12, swayRightMax, ratio) * (0.45 + rng() * 0.35);
      if (index % 4 === 3) delta *= 0.55;
      break;
    case "pulse":
      delta =
        index % 3 === 1
          ? -swayLeftMax * (0.45 + rng() * 0.25)
          : swayRightMax * (0.35 + rng() * 0.45);
      break;
    case "switchback":
      delta =
        index % 4 < 2
          ? swayRightMax * (0.45 + rng() * 0.4)
          : -swayLeftMax * (0.4 + rng() * 0.3);
      break;
    case "crest":
      delta =
        ratio < 0.56
          ? swayRightMax * (0.42 + rng() * 0.38)
          : -swayLeftMax * (0.18 + rng() * 0.18);
      break;
    case "plateau":
      delta = index % 3 === 2 ? 0.14 + rng() * 0.18 : 0.04 + rng() * 0.08;
      break;
    default:
      delta = 0.12 + rng() * 0.12;
      break;
  }

  if (earlyPressure > 0) {
    const cadenceKick = index % 2 === 0 ? 1 : -0.45;
    delta += cadenceKick * earlyPressure * 0.14;
  }

  return clamp(x + delta, minX, maxX);
}

function estimateLayoutDrain(layout) {
  let routeDistance = 0;
  let previousX = 0;
  let previousY = 0;

  for (const platform of layout) {
    routeDistance += Math.hypot(platform.x - previousX, platform.y - previousY);
    previousX = platform.x;
    previousY = platform.y;
  }

  const jumpCost = layout.length * JUMP_GEL_COST;
  const walkCost = routeDistance * (WALK_GEL_COST / WALK_STEP_DISTANCE);
  return jumpCost + walkCost;
}

function buildLevelLabel(level, progress, isRespite) {
  if (isRespite) return "BREATHER ROUTE";
  if (level >= LEVEL_COUNT - 3) return "FINAL ASCENT";
  if (progress < 0.12) return "OPENING ARC";
  if (progress < 0.35) return "RISING RHYTHM";
  if (progress < 0.65) return "TIGHTER GAPS";
  return "PRECISION RUN";
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
          }
        : null,
      platforms: platforms.map((platform) => ({
        x: Number(platform.mesh.position.x.toFixed(2)),
        y: Number(platform.mesh.position.y.toFixed(2)),
        final: platform.isFinal,
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
    buildLevel(levelState.currentLevel);
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onWindowResize);
  });
}

init();
