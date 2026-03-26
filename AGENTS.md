# Agent Documentation: 3D Side Scroller Template

This document provides a technical overview of the project for AI agents and developers. It outlines the architecture, key systems, and design patterns used in this 3D Side Scroller template.

## 🚀 Project Overview
A performance-oriented 3D side-scrolling platformer template built with **Three.js** and **Rapier**. It features physics-based movement, variable jump heights, and smooth camera transitions.

## 🛠 Tech Stack
- **Rendering**: [Three.js](https://threejs.org/) (WebGL)
- **Physics**: [@dimforge/rapier3d-compat](https://rapier.rs/) (WASM-based 3D physics)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Scripting**: [Wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4 in WASM)
- **Language**: JavaScript (ESM) + Lua

## 🏗 Key Systems

### 1. Physics Engine (Rapier)
- **Initialization**: Async initialization via `RAPIER.init()` in `core/Engine.js`.
- **World**: 3D world with gravity set to `-19.6` (customized for snappy platforming).
- **Player Body**: Dynamic rigid body with locked rotations (`enabledRotations(false, false, false)`).
- **Ground Detection**: Implemented via **Raycasting**. A ray is cast from slightly above the player's base downwards. The `playerBody` is explicitly excluded from this raycast to prevent self-collision bugs.

### 2. Player Controller (Mario-style)
- **Movement**: Linear velocity application on the X-axis (`PLAYER_SPEED = 8`).
- **Jumping**:
    - Uses `JUMP_IMPULSE = 12`.
    - **Variable Jump Height**: If the "Space" key is released while the player is ascending, the upward velocity is dampened (`velocity.y * 0.9`), allowing for short hops vs. full jumps.
- **2.5D Constraint**: Movement is strictly on the X-Y plane. The Z-axis is fixed to `0` in physics velocity logic to maintain the side-scrolling alignment.

### 3. Camera System
- **Smoothing**: Uses linear interpolation (Lerp) to follow the player on both X and Y axes.
- **Fixed Z**: Camera is positioned at `Z: 12` looking towards `Z: 0`.

### 4. Lua Scripting System
- **Runtime**: Initialized in `core/LuaRuntime.js` using `wasmoon`.
- **Interop**: JavaScript objects are exposed to Lua.
    - `config`: Table containing `playerSpeed`, `jumpImpulse`, and `gravity`.
    - `game`: Table containing functions like `createPlatform(x,y,z,w,h,d,color)`, `createGround()`, `spawnPlayer(x,y,z)`, `setGravity(y)`, `isKeyDown(code)`, `applyImpulse(x,y,z)`, and `getVelocity()`.
- **Hooks**: 
    - `onUpdate(delta)`: Optional global Lua function called every frame from the JS animate loop.
- **Workflow**: Scripts reside in the `scripts/` directory and are imported as raw text by Vite to be executed at runtime.

### 5. Hot Module Replacement (HMR)
- Custom HMR support is implemented in `core/Engine.js` using `import.meta.hot`.
- **Cleanup**: On module reload, the previous `canvas` is removed, the `requestAnimationFrame` loop is cancelled, and window event listeners are detached to prevent memory leaks and duplicate renders.

## 📂 File Structure
- `index.html`: Base entry point with UI overlay and CSS styles.
- `main.js`: Minimal entry point that boots the core engine.
- `core/`: Core engine functionality.
    - `Engine.js`: Main logic for rendering, physics, and game loop.
    - `LuaRuntime.js`: Wrapper for the Wasmoon Lua VM.
- `scripts/`: Directory for Lua game scripts (e.g., `init.lua`).
- `package.json`: Vite configuration and dependency management.
- `README.md`: User-facing instructions.

## 💡 Developer Notes for Agents
- **Adding Platforms**: Use the `game.createPlatform(x, y, z, w, h, d, color)` in Lua. It handles both Three.js mesh creation and Rapier static body creation.
- **Model Integration**: To replace the box player, import a GLTF model and sync its position with `playerBody.translation()` in the `animate` loop in `core/Engine.js`.
- **Ground Raycast**: If you change the player scale, remember to adjust the ray start offset and length in `handleInput()` (currently hardcoded for a `1x1x1` box).

---
*Last Updated: March 2026*
