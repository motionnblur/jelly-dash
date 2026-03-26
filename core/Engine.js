import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { luaRuntime } from "./LuaRuntime";
import { uiManager } from "../ui/UIManager";
// Automatically load all Lua files in the scripts folder
const luaModules = import.meta.glob("../scripts/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Main Engine Components
let scene, camera, renderer, world, clock;
let player, playerBody, playerCollider;
let platforms = [];
let coins = [];
let coinsCollected = 0;
let keys = {};
let particles = [];

const SKY_COLOR = 0xb9ddff;
const FOG_COLOR = 0xd6ecff;

let playerState = {
  lastVelX: 0,
  particleTimer: 0,
  lastGrounded: true,
  lastVelY: 0,
  gelMass: 1.0, 
  isGameOver: false,
  jellyUniforms: {
    uVelocity: { value: new THREE.Vector3() },
    uImpact: { value: 0 },
    uTime: { value: 0 },
    uScale: { value: new THREE.Vector3(1, 1, 1) },
    uTilt: { value: 0 },
  }
};

// Game Configuration (Exposed to Lua)
const gameConfig = {
  playerSpeed: 8,
  jumpImpulse: 12,
  gravity: -19.6,
};

// Helper: Clean up existing renderer if it exists (for HMR)
const existingCanvas = document.querySelector("canvas");
if (existingCanvas) {
  existingCanvas.remove();
}

async function init() {
  // 1. Initialize Physics Engine (Rapier)
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: gameConfig.gravity, z: 0 });

  // 2. Three.js Scene Setup (MUST happen before Lua runs world-creation code)
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

  // 3. Lighting (Premium Feel)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const sun = new THREE.DirectionalLight(0xffddaa, 1.2);
  sun.position.set(20, 40, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);

  const pointLight = new THREE.PointLight(0x00ccff, 1, 30);
  pointLight.position.set(0, 5, 10);
  scene.add(pointLight);

  // 4. Initialize Lua Scripting
  await luaRuntime.init({
    config: gameConfig,
    game: {
      createPlatform: (x, y, z, w, h, d, color) =>
        createPlatform(x, y, z, w, h, d, color),
      createGround: () => createGround(),
      spawnPlayer: (x, y, z) => {
        if (!player) createPlayer(); // Use 'player' mesh as existence check
        playerBody.setTranslation({ x, y, z }, true);
      },
      setGravity: (y) => {
        gameConfig.gravity = y;
        world.gravity = { x: 0, y: y, z: 0 };
      },
      isKeyDown: (code) => !!keys[code],
      applyImpulse: (x, y, z) => {
        if (playerBody) playerBody.applyImpulse({ x, y, z }, true);
      },
      getVelocity: () => {
        if (!playerBody) return { x: 0, y: 0, z: 0 };
        const v = playerBody.linvel();
        return { x: v.x, y: v.y, z: v.z }; // Plain object for Lua
      },
      createCoin: (x, y, z) => createCoin(x, y, z),
    },
  });

  // Mount all Lua scripts from the scripts directory
  for (const path in luaModules) {
    const fileName = path.split("/").pop(); // e.g., "init.lua"
    await luaRuntime.mountFile(fileName, luaModules[path]);
  }

  // 5. Run the entry point (init.lua)
  await luaRuntime.run('require("init")');

  // All world creation (Ground, Platforms, Player) is now handled by Lua
  // See scripts/init.lua

  // Event Listeners
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onWindowResize);

  // Remove Loading Screen (safely) via UIManager
  uiManager.removeLoadingScreen();

  // Start Loop
  animate();
}

function onKeyDown(e) {
  keys[e.code] = true;
}
function onKeyUp(e) {
  keys[e.code] = false;
}

/**
 * Creates a static ground
 */
function createGround() {
  const geometry = new THREE.BoxGeometry(200, 2, 20);
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.8,
    metalness: 0.2,
  });
  const groundMesh = new THREE.Mesh(geometry, material);
  groundMesh.position.y = -1;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Physics Ground
  const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0);
  const rigidBody = world.createRigidBody(groundDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(100, 1, 10)
    .setFriction(0)
    .setRestitution(0);
  world.createCollider(colliderDesc, rigidBody);
}

/**
 * Generic Platform Creator
 */
function createPlatform(x, y, z, w, h, d, color) {
  // 1. Mesh Creation (Hexagonal Prism)
  const radius = Math.max(w, d) / 2;
  const geometry = new THREE.CylinderGeometry(radius, radius, h, 6);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.3,
    metalness: 0.7,
    roughness: 0.2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  mesh.rotation.y = Math.PI / 6;

  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.5,
    }),
  );
  mesh.add(line);

  scene.add(mesh);

  // 2. Physics Platform (Kinematic for the "weight" effect)
  const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    x,
    y,
    z,
  );
  const body = world.createRigidBody(desc);

  const vertices = [];
  const offset = Math.PI / 6;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + offset;
    const vx = radius * Math.cos(angle);
    const vz = radius * Math.sin(angle);
    vertices.push(vx, -h / 2, vz);
    vertices.push(vx, h / 2, vz);
  }

  const colliderDesc = RAPIER.ColliderDesc.convexHull(
    new Float32Array(vertices),
  )
    .setFriction(0)
    .setRestitution(0);

  const collider = world.createCollider(colliderDesc, body);

  // Store for weighted behavior
  platforms.push({
    mesh,
    body,
    collider,
    originalY: y,
    currentY: y,
    isOccupied: false,
  });
}

/**
 * Creates the Player character
 */
function createPlayer() {
  // Mesh
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x44ff44,
    roughness: 0.2,
    metalness: 0.8,
  });

  // Inject Custom Jelly Shader Logic
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
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      
      // 1. Squash and Stretch (Centered at bottom)
      transformed.y += 0.5; // Move to pivot
      transformed.y *= uScale.y;
      transformed.xz *= uScale.xz;
      transformed.y -= 0.5 * uScale.y; // Move back

      // 2. Horizontal Shearing (Tilt) based on height
      // Bottom is fixed (0.0), top is most tilted (1.0)
      float h = (transformed.y + 0.5 * uScale.y) / uScale.y; 
      transformed.x += h * uTilt;

      // 3. Procedural Jiggle (Sine wave based on movement)
      float jiggle = sin(uTime * 15.0 + transformed.y * 2.0) * length(uVelocity.xz) * 0.01;
      transformed.x += jiggle * h;
      `
    );
  };
  player = new THREE.Mesh(geometry, material);
  player.position.set(0, 1, 0);
  player.castShadow = true;
  scene.add(player);

  // Rigid Body
  const playerDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 5, 0)
    .setCanSleep(false)
    .enabledRotations(false, false, false); // Rotation locked for typical platformers

  playerBody = world.createRigidBody(playerDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
    .setFriction(0)
    .setRestitution(0);
  playerCollider = world.createCollider(colliderDesc, playerBody);
}

/**
 * Creates a collectible Coin
 */
function createCoin(x, y, z) {
  const geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 6);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffdd00,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0xffaa00,
    emissiveIntensity: 0.5,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;

  // Add wireframe for premium look
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
    }),
  );
  mesh.add(line);

  scene.add(mesh);

  // We'll use distance-based collection for simplicity in this template,
  // but we store it in an array for the animate loop to check.
  coins.push({
    mesh: mesh,
    collected: false,
    position: { x, y, z },
  });
}

/**
 * Creates visual particles at a position
 */
function spawnParticles(x, y, z, color, count = 8, speedScale = 1.0) {
  // Gel Loss Mechanic: Green particles represent lost mass
  if (color === 0x44ff44) {
    const lossPerParticle = 0.003; 
    playerState.gelMass -= (count * lossPerParticle);

    // Death Check
    if (playerState.gelMass < 0.35 && !playerState.isGameOver) {
      playerState.isGameOver = true;
      uiManager.showGameOver();
      // Freeze the player physics
      if (playerBody) {
        playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    
    // Safety cap for visuals
    playerState.gelMass = Math.max(0.3, playerState.gelMass);
  }

  // Calculate size based on current mass (if it's a player gel particle)
  const particleSize = 0.1 * (color === 0x44ff44 ? playerState.gelMass : 1.0);

  for (let i = 0; i < count; i++) {
    const geometry = new THREE.SphereGeometry(particleSize, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.set(x, y, z);

    // Random velocity
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 6 * speedScale,
      Math.random() * 8 * speedScale, // Burst upwards
      (Math.random() - 0.5) * 4 * speedScale,
    );

    scene.add(particle);
    particles.push({
      mesh: particle,
      velocity: velocity,
      life: 1.0, // Seconds
    });
  }
}

function handleInput(delta) {
  const velocity = playerBody.linvel();
  const translation = playerBody.translation();
  let moveX = 0;

  // 1. Raycast Ground Detection (ensure we don't hit the player itself)
  // Cube height is 1, so the base is at -0.5. Scale ray down from slightly above base.
  const ray = new RAPIER.Ray(
    { x: translation.x, y: translation.y - 0.4, z: translation.z },
    { x: 0, y: -1, z: 0 },
  );

  // castRay(ray, maxToi, solid, groups, filter_predicate, filter_collider, filter_rigid_body)
  // We pass 'playerBody' as the last argument to EXCLUDE IT from the raycast results.
  const hit = world.castRay(ray, 0.2, true, null, null, null, playerBody);
  const isGrounded = hit !== null;

  // Movement logic
  if (keys["KeyA"] || keys["ArrowLeft"]) moveX -= gameConfig.playerSpeed;
  if (keys["KeyD"] || keys["ArrowRight"]) moveX += gameConfig.playerSpeed;

  // 2. Jumping System
  // Initial Jump
  if (keys["Space"] && isGrounded) {
    playerBody.setLinvel(
      { x: velocity.x, y: gameConfig.jumpImpulse, z: velocity.z },
      true,
    );
    // Jump Splash
    spawnParticles(translation.x, translation.y - 0.4, translation.z, 0x44ff44, 8);
  }

  // 3. Variable Jump Height (Mario-style)
  // If we release space while moving upward, we cut the upward velocity
  if (!keys["Space"] && velocity.y > 0) {
    playerBody.setLinvel(
      { x: velocity.x, y: velocity.y * 0.9, z: velocity.z },
      true,
    );
  }

  // Apply movement while preserving gravity's effect on Y
  playerBody.setLinvel({ x: moveX, y: playerBody.linvel().y, z: 0 }, true);

  // Return current state for animation and camera
  return { translation, hit };
}

function updateCamera(targetPos) {
  // Smoother camera follow on X-axis and Y-axis (side scrolling)
  const targetCamX = targetPos.x;
  const targetCamY = targetPos.y + 4;

  camera.position.x += (targetCamX - camera.position.x) * 0.1;
  camera.position.y += (targetCamY - camera.position.y) * 0.1;
  camera.lookAt(camera.position.x, targetPos.y, 0);
}

let animationId;
function animate() {
  animationId = requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // If game is over, pause most logic
  if (playerState.isGameOver) {
    // Still update particles for a fading effect
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= delta * 1.5;
      p.mesh.material.opacity = p.life;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
    renderer.render(scene, camera);
    return; 
  }

  // Step World (Fixed timestep)
  world.step();

  // Call Lua Update Hook
  luaRuntime.callFunction("onUpdate", delta);

  // Character Logic
  const { translation: pos, hit } = handleInput(delta);
  const isGrounded = hit !== null;

  // --- NEW: Shader-Based Jelly Physics & Collider Scaling ---
  const vel = playerBody.linvel();
  playerState.jellyUniforms.uTime.value += delta;
  
  // 1. Detect Impact (Landing)
  if (isGrounded && !playerState.lastGrounded) {
    const impactSpeed = Math.abs(playerState.lastVelY || 0);
    playerState.jellyUniforms.uImpact.value = impactSpeed;
    
    // Calculate count and speed scale based on impact velocity (fall height)
    // NORMAL jump impact is ~12. We scale from there.
    const baseCount = 6;
    const additionalCount = Math.floor(impactSpeed * 1.5);
    const particleCount = Math.min(baseCount + additionalCount, 40); // Cap to avoid perf hit
    const speedScale = 0.4 + (impactSpeed / 10);

    spawnParticles(
      pos.x, 
      pos.y - 0.5 * playerState.jellyUniforms.uScale.value.y, // Bottom of the player
      pos.z, 
      0x44ff44, 
      particleCount, 
      speedScale
    );
  }
  playerState.lastGrounded = isGrounded;
  playerState.lastVelY = vel.y;

  // 2. Update Collider to match current gel mass (biological size)
  // We recreate it for accuracy in Rapier WASM, but only if it changed significantly
  const currentMass = playerState.gelMass;
  if (playerCollider && (!playerState._lastColliderMass || Math.abs(playerState._lastColliderMass - currentMass) > 0.01)) {
    world.removeCollider(playerCollider, false);
    const halfSize = 0.5 * currentMass;
    const desc = RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
      .setFriction(0)
      .setRestitution(0);
    playerCollider = world.createCollider(desc, playerBody);
    playerState._lastColliderMass = currentMass;
  }

  // 3. Calculate Squash and Stretch Targets
  let targetScaleY = 1.0;
  let targetScaleXZ = 1.0;
  
  if (!isGrounded) {
    const stretch = Math.abs(vel.y) * 0.025;
    targetScaleY = 1.0 + stretch;
    targetScaleXZ = 1.0 - stretch * 0.5;
  } else {
    const speedFactor = Math.abs(vel.x) * 0.02;
    targetScaleXZ = 1.0 + speedFactor;
    targetScaleY = 1.0 - speedFactor * 0.2;
  }

  // Multiply by current gel mass (biological size)
  targetScaleY *= playerState.gelMass;
  targetScaleXZ *= playerState.gelMass;

  // Smooth the scale in JS (it's O(1) so it's fine) and pass to Shader
  const stiffness = 15.0; // Shader makes it feel faster, so lower stiffness
  playerState.jellyUniforms.uScale.value.y += (targetScaleY - playerState.jellyUniforms.uScale.value.y) * stiffness * delta;
  playerState.jellyUniforms.uScale.value.x += (targetScaleXZ - playerState.jellyUniforms.uScale.value.x) * stiffness * delta;
  playerState.jellyUniforms.uScale.value.z = playerState.jellyUniforms.uScale.value.x;

  // 3. Calculate Tilt (Lag)
  const targetTilt = vel.x * -0.05;
  playerState.jellyUniforms.uTilt.value += (targetTilt - playerState.jellyUniforms.uTilt.value) * 10.0 * delta;

  // 4. Update Uniform Velocity
  playerState.jellyUniforms.uVelocity.value.set(vel.x, vel.y, vel.z);

  // Sync Position
  player.position.copy(pos);

  // --- Gel Drag Particles ---
  if (isGrounded && Math.abs(vel.x) > 0.5) {
    playerState.particleTimer += delta * Math.abs(vel.x);
    if (playerState.particleTimer > 1.5) {
      const soleY = pos.y - 0.5 * playerState.jellyUniforms.uScale.value.y;
      spawnParticles(
        pos.x + (Math.random() - 0.5) * 0.5, 
        soleY, 
        pos.z + (Math.random() - 0.5) * 0.5, 
        0x44ff44,
        5
      );
      playerState.particleTimer = 0;
    }
  }

  // Platform Weight Logic
  platforms.forEach((p) => {
    // Check if this specific platform is being stepped on
    const isSteppedOn = hit && hit.collider.handle === p.collider.handle;

    // Config for leaf-like behavior
    const sinkDepth = 0.6;
    const sinkSpeed = 0.1;
    const returnSpeed = 0.03;

    const targetY = isSteppedOn ? p.originalY - sinkDepth : p.originalY;
    const alpha = isSteppedOn ? sinkSpeed : returnSpeed;

    // Smooth transition (Lerp)
    p.currentY += (targetY - p.currentY) * alpha;

    // Update Physics Body
    p.body.setNextKinematicTranslation({
      x: p.mesh.position.x,
      y: p.currentY,
      z: p.mesh.position.z,
    });

    // Update Mesh
    p.mesh.position.y = p.currentY;
  });

  // Coin Collection & Animation
  coins.forEach((coin, index) => {
    if (coin.collected) return;

    // Rotate
    coin.mesh.rotation.z += delta * 3;

    // Simple distance check for collection
    const dx = pos.x - coin.position.x;
    const dy = pos.y - coin.position.y;
    const dz = pos.z - coin.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 1.0) {
      coin.collected = true;
      scene.remove(coin.mesh);
      coinsCollected++;

      // Update UI via UIManager
      uiManager.updateCoinCount(coinsCollected);

      // Spawn Particles
      spawnParticles(
        coin.position.x,
        coin.position.y,
        coin.position.z,
        0xffdd00,
      );

      console.log(`Coin collected! Total: ${coinsCollected}`);
    }
  });

  // Update Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= delta * 1.5;

    // Apply gravity to particles
    p.velocity.y += gameConfig.gravity * delta;
    p.mesh.position.addScaledVector(p.velocity, delta);
    p.mesh.material.opacity = p.life;

    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }

  // Sync Camera
  updateCamera(pos);

  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Support Vite Hot Module Replacement
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onWindowResize);
  });
}

init();
