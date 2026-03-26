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

const platforms = [];
const particles = [];
const keys = {};

const SKY_COLOR = 0xf3f7ff;
const FOG_COLOR = 0xf9fbff;
const LEVEL_COUNT = 50;
const LEVEL_SEED = 0x5f3759df;
const PLATFORM_HEIGHT = 0.5;
const PLAYER_SPAWN = { x: 0, y: 5, z: 0 };
const MAX_SAFE_LEVEL_DRAIN = 0.90;
const JUMP_GEL_COST = 0.045;
const WALK_GEL_COST = 0.018;
const WALK_STEP_DISTANCE = 2.0;
const GEL_CRITICAL_THRESHOLD = 0.28;
const GEL_GAME_OVER_THRESHOLD = 0.0;

const LEVEL_PATTERNS = ["glide", "pulse", "switchback", "crest"];
const LEVEL_COLORS = [
  0x70e1ff,
  0xff8a5b,
  0x77ff88,
  0xff5f9d,
  0x8b7dff,
  0xffd166,
];

const playerState = {
  gelMass: 1.0,
  isGameOver: false,
  lastGrounded: true,
  lastVelY: 0,
  particleTimer: 0,
  walkDistanceAccumulator: 0,
  spawnLandingGrace: true,
  jellyUniforms: {
    uVelocity: { value: new THREE.Vector3() },
    uImpact: { value: 0 },
    uTime: { value: 0 },
    uScale: { value: new THREE.Vector3(1, 1, 1) },
    uTilt: { value: 0 },
  },
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
  scene.fog = new THREE.Fog(FOG_COLOR, 18, 95);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 5, 12);
  camera.lookAt(0, 2, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(SKY_COLOR, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9e5ff, 1.15));

  const sun = new THREE.DirectionalLight(0xfff2d7, 1.4);
  sun.position.set(18, 32, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const rimLight = new THREE.PointLight(0x7dd3fc, 0.9, 30);
  rimLight.position.set(-10, 7, 12);
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
  keys[event.code] = true;
}

function onKeyUp(event) {
  keys[event.code] = false;
}

function createGround() {
  const backdrop = new THREE.Mesh(
    new THREE.BoxGeometry(220, 1.2, 18),
    new THREE.MeshStandardMaterial({
      color: 0xefede6,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  backdrop.position.set(34, -2.25, 0);
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  const geometry = new THREE.BoxGeometry(11, 2, 18);
  const material = new THREE.MeshStandardMaterial({
    color: 0xf9fbff,
    roughness: 0.42,
    metalness: 0.04,
  });
  const groundMesh = new THREE.Mesh(geometry, material);
  groundMesh.position.x = 0.5;
  groundMesh.position.y = -1;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0.5, -1, 0);
  const rigidBody = world.createRigidBody(groundDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(5.5, 1, 9)
    .setFriction(0)
    .setRestitution(0);
  world.createCollider(colliderDesc, rigidBody);
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
  mesh.castShadow = !options.isFinal;
  mesh.receiveShadow = true;

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
      new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.9 }),
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
    bobPhase: options.bobPhase ?? Math.random() * Math.PI * 2,
    motionAmplitude: options.motionAmplitude ?? 0,
    motionSpeed: options.motionSpeed ?? 0,
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
  player.castShadow = true;
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
}

function drainGel(amount) {
  if (playerState.isGameOver || levelState.isTransitioning || levelState.isGameComplete) {
    return;
  }

  playerState.gelMass = Math.max(0, playerState.gelMass - amount);
  uiManager.updateHealth(playerState.gelMass);

  if (playerState.gelMass <= GEL_GAME_OVER_THRESHOLD) {
    playerState.isGameOver = true;
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    uiManager.showGameOver();
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
    color === 0x44ff44 && options.drainGelTotal
      ? options.drainGelTotal
      : 0;

  if (drainAmount > 0) {
    drainGel(drainAmount);
  }

  const particleScale =
    color === 0x44ff44 ? Math.max(playerState.gelMass, 0.45) : 1.0;
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
  playerState.particleTimer = 0;
  playerState.walkDistanceAccumulator = 0;
  playerState.spawnLandingGrace = true;
  playerState.jellyUniforms.uVelocity.value.set(0, 0, 0);
  playerState.jellyUniforms.uImpact.value = 0;
  playerState.jellyUniforms.uTime.value = 0;
  playerState.jellyUniforms.uScale.value.set(1, 1, 1);
  playerState.jellyUniforms.uTilt.value = 0;
  playerState._lastColliderMass = null;

  if (playerBody) {
    playerBody.setTranslation(PLAYER_SPAWN, true);
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    syncPlayerCollider(true);
  }

  if (player) {
    player.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
  }

  camera.position.set(0, 5, 12);
  camera.lookAt(0, 2, 0);
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
  levelState.transitionTimer = 0.5;
  levelState.pendingLevel = nextLevel <= LEVEL_COUNT ? nextLevel : "complete";

  if (playerBody) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  if (levelState.finalPlatform) {
    const { x, y, z } = levelState.finalPlatform.mesh.position;
    spawnParticles(x, y + 0.35, z, 0xffd166, 16, 1.25);
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

  const ray = new RAPIER.Ray(
    { x: translation.x, y: translation.y - 0.4, z: translation.z },
    { x: 0, y: -1, z: 0 },
  );
  const hit = world.castRay(ray, 0.24, true, null, null, null, playerBody);
  const isGrounded = hit !== null;

  if (!levelState.isTransitioning && !levelState.isGameComplete) {
    if (keys["KeyA"] || keys["ArrowLeft"]) moveX -= gameConfig.playerSpeed;
    if (keys["KeyD"] || keys["ArrowRight"]) moveX += gameConfig.playerSpeed;

    if (keys.Space && isGrounded) {
      playerBody.setLinvel(
        { x: velocity.x, y: gameConfig.jumpImpulse, z: velocity.z },
        true,
      );
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

function updateCamera(targetPosition) {
  const targetCamX = targetPosition.x;
  const targetCamY = targetPosition.y + 4;

  camera.position.x += (targetCamX - camera.position.x) * 0.1;
  camera.position.y += (targetCamY - camera.position.y) * 0.1;
  camera.lookAt(camera.position.x, targetPosition.y, 0);
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
    particle.life -= delta * 1.5;
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
      ? Math.sin(playerState.jellyUniforms.uTime.value * 1.8 + platform.bobPhase) * 0.08
      : platform.motionAmplitude > 0
        ? Math.sin(playerState.jellyUniforms.uTime.value * platform.motionSpeed + platform.bobPhase) *
          platform.motionAmplitude
        : 0;

    const targetY = (isSteppedOn ? platform.originalY - sinkDepth : platform.originalY) + bobOffset;
    const alpha = isSteppedOn ? sinkSpeed : returnSpeed;

    platform.currentY += (targetY - platform.currentY) * alpha * Math.min(1, delta * 60);
    platform.body.setNextKinematicTranslation({
      x: platform.mesh.position.x,
      y: platform.currentY,
      z: platform.mesh.position.z,
    });
    platform.mesh.position.y = platform.currentY;
  }
}

function updateWalkDrain(delta, isGrounded, velocity) {
  if (!isGrounded || Math.abs(velocity.x) < 0.25 || levelState.isTransitioning) {
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
    (targetScaleY - playerState.jellyUniforms.uScale.value.y) * stiffness * delta;
  playerState.jellyUniforms.uScale.value.x +=
    (targetScaleXZ - playerState.jellyUniforms.uScale.value.x) * stiffness * delta;
  playerState.jellyUniforms.uScale.value.z = playerState.jellyUniforms.uScale.value.x;

  const targetTilt = velocity.x * -0.05;
  playerState.jellyUniforms.uTilt.value +=
    (targetTilt - playerState.jellyUniforms.uTilt.value) * 10.0 * delta;

  playerState.jellyUniforms.uVelocity.value.set(velocity.x, velocity.y, velocity.z);
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
  updateWalkDrain(delta, isGrounded, velocity);
  updatePlatforms(hit, delta);

  if (
    hit &&
    levelState.finalPlatform &&
    hit.collider.handle === levelState.finalPlatform.collider.handle
  ) {
    startLevelTransition();
  }

  if (translation.y < -10) {
    queueLevelRestart();
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
  const gapBase =
    lerp(3.85, 5.85, shapeProgress) -
    (isRespite ? 0.32 : 0) +
    earlyPressure * (isRespite ? 0.10 : 0.35);
  const gapVariance =
    lerp(0.22, 1.25, shapeProgress) * (isRespite ? 0.72 : 1) +
    earlyPressure * (isRespite ? 0.02 : 0.07);
  const riseMax =
    lerp(0.48, 1.55, shapeProgress) * (isRespite ? 0.8 : 1) +
    earlyPressure * (isRespite ? 0.06 : 0.20);
  const fallMax =
    lerp(0.18, 0.85, shapeProgress) * (isRespite ? 0.82 : 1) +
    earlyPressure * (isRespite ? 0.04 : 0.14);
  const minY = lerp(1.9, 3.45, shapeProgress) - (isRespite ? 0.18 : 0);
  const maxY =
    lerp(3.7, 7.8, shapeProgress) -
    (isRespite ? 0.12 : 0) +
    earlyPressure * (isRespite ? 0.08 : 0.28);
  const pattern = isRespite
    ? "plateau"
    : LEVEL_PATTERNS[Math.floor(rng() * LEVEL_PATTERNS.length)];
  const hasWavingPlatforms = level > 5;

  let gapScale = 1;
  let layout = [];
  let estimatedDrain = 1;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    layout = createLayoutCandidate({
      platformCount,
      platformDiameter,
      gapBase,
      gapVariance,
      riseMax,
      fallMax,
      minY,
      maxY,
      pattern,
      gapScale,
      progress: shapeProgress,
      rng,
      isRespite,
      earlyPressure,
      level,
      hasWavingPlatforms,
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
    gapBase,
    gapVariance,
    riseMax,
    fallMax,
    minY,
    maxY,
    pattern,
    gapScale,
    progress,
    rng,
    isRespite,
    earlyPressure,
    level,
    hasWavingPlatforms,
  } = config;

  const layout = [];
  let x = 4.6;
  let y = 1.9;

  for (let index = 0; index < platformCount; index += 1) {
    const gapNoise = (rng() * 2 - 1) * gapVariance;
    const gap = Math.max(3.45, (gapBase + gapNoise) * gapScale);
    x += index === 0 ? gap * 0.96 : gap;

    const diameter = clamp(
      platformDiameter + (rng() * 2 - 1) * 0.32 + (index % 3 === 0 ? 0.06 : 0),
      2.45,
      4.6,
    );

    y = computePlatformHeight({
      index,
      platformCount,
      y,
      minY,
      maxY,
      riseMax,
      fallMax,
      pattern,
      rng,
      earlyPressure,
    });

    layout.push({
      x,
      y,
      z: 0,
      w: diameter,
      h: PLATFORM_HEIGHT,
      d: diameter,
      color: LEVEL_COLORS[(index + Math.floor(progress * 6)) % LEVEL_COLORS.length],
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
    });
  }

  const finalGap = Math.max(
    3.7,
    (gapBase + 0.45 + rng() * gapVariance + earlyPressure * (isRespite ? 0.08 : 0.18)) *
      gapScale,
  );
  const finalY = clamp(
    y + (isRespite ? 0.06 : (rng() - 0.25) * Math.min(riseMax, 0.55)),
    minY,
    maxY,
  );
  const finalDiameter = clamp(platformDiameter + 0.22 + (isRespite ? 0.18 : 0), 3.0, 4.7);

  layout.push({
    x: x + finalGap,
    y: finalY,
    z: 0,
    w: finalDiameter,
    h: PLATFORM_HEIGHT,
    d: finalDiameter,
    color: 0xffd166,
    isFinal: true,
    bobPhase: ((level * 31 + platformCount * 17 + 11) % 360) * (Math.PI / 180),
    motionAmplitude: 0,
    motionSpeed: 0,
  });

  return layout;
}

function computePlatformHeight(config) {
  const {
    index,
    platformCount,
    y,
    minY,
    maxY,
    riseMax,
    fallMax,
    pattern,
    rng,
    earlyPressure,
  } = config;
  const ratio = platformCount <= 1 ? 1 : index / (platformCount - 1);
  let delta = 0;

  switch (pattern) {
    case "glide":
      delta = lerp(0.18, riseMax, ratio) * (0.45 + rng() * 0.35);
      if (index % 4 === 3) delta *= 0.55;
      break;
    case "pulse":
      delta =
        index % 3 === 1
          ? -fallMax * (0.45 + rng() * 0.25)
          : riseMax * (0.35 + rng() * 0.45);
      break;
    case "switchback":
      delta =
        index % 4 < 2
          ? riseMax * (0.45 + rng() * 0.4)
          : -fallMax * (0.4 + rng() * 0.3);
      break;
    case "crest":
      delta =
        ratio < 0.56
          ? riseMax * (0.42 + rng() * 0.38)
          : -fallMax * (0.18 + rng() * 0.18);
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

  return clamp(y + delta, minY, maxY);
}

function estimateLayoutDrain(layout) {
  let routeDistance = 0;
  let previousX = 0;

  for (const platform of layout) {
    routeDistance += platform.x - previousX;
    previousX = platform.x;
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
      },
      player: playerBody
        ? {
            x: Number(playerBody.translation().x.toFixed(2)),
            y: Number(playerBody.translation().y.toFixed(2)),
            vx: Number(playerBody.linvel().x.toFixed(2)),
            vy: Number(playerBody.linvel().y.toFixed(2)),
            gelMass: Number(playerState.gelMass.toFixed(3)),
          }
        : null,
      platforms: platforms.map((platform) => ({
        x: Number(platform.mesh.position.x.toFixed(2)),
        y: Number(platform.mesh.position.y.toFixed(2)),
        final: platform.isFinal,
        motionAmplitude: Number(platform.motionAmplitude.toFixed(3)),
        motionSpeed: Number(platform.motionSpeed.toFixed(3)),
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
