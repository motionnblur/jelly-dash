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
let player, playerBody;
let platforms = [];
let coins = [];
let coinsCollected = 0;
let keys = {};

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
  scene.background = new THREE.Color(0x0a1020);
  scene.fog = new THREE.Fog(0x0a1020, 20, 100);

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
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Physics Platform
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  const body = world.createRigidBody(desc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
    .setFriction(0)
    .setRestitution(0);
  world.createCollider(colliderDesc, body);
}

/**
 * Creates the Player character
 */
function createPlayer() {
  // Mesh
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffdd00,
    roughness: 0.5,
    metalness: 0.8,
  });
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
  world.createCollider(colliderDesc, playerBody);
}

/**
 * Creates a collectible Coin
 */
function createCoin(x, y, z) {
  const geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
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
  scene.add(mesh);

  // We'll use distance-based collection for simplicity in this template,
  // but we store it in an array for the animate loop to check.
  coins.push({
    mesh: mesh,
    collected: false,
    position: { x, y, z },
  });
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

  // Return current position for camera follow
  return translation;
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

  // Step World (Fixed timestep)
  world.step();

  // Call Lua Update Hook
  luaRuntime.callFunction("onUpdate", delta);

  // Character Logic
  const pos = handleInput(delta);

  // Sync Mesh with Body
  player.position.copy(pos);

  // Coin Collection & Animation
  coins.forEach((coin, index) => {
    if (coin.collected) return;

    // Rotate
    coin.mesh.rotation.y += delta * 3;

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

      console.log(`Coin collected! Total: ${coinsCollected}`);
    }
  });

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
