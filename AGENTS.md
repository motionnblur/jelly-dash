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
- **Ground Detection**: Implemented via **Raycasting**. A ray is cast from slightly above the player's base downwards. The `playerBody` is explicitly excluded from this raycast.
- **Dynamic Collider**: The player's collider is a **Cuboid**. It is automatically recalculated and re-added to the `playerBody` whenever the `gelMass` changes significantly (>0.01 threshold) to ensure the hit-box matches the visual size.

### 2. Player Controller & Gel Mechanics
- **Movement**: Linear velocity application on the X-axis (`PLAYER_SPEED = 8`).
- **Jumping**: Uses `JUMP_IMPULSE = 12`. Supports variable jump heights by dampening Y-velocity on button release.
- **Gel Mass (Atrophy)**: The character has a `gelMass` (starts at 1.0). Spawning green particles (jumping, landing, trailing) subtracts small amounts from this mass.
- **Visual Scaling**: The character's mesh scale is calculated as a product of its **Dynamic Squash/Stretch** and its current **Gel Mass**.
- **Game Over**: If `gelMass` falls below **0.35**, the game simulation freezes, and the "Gel Depleted" UI appears.

### 3. Particle System
- **Scaling**: Particles spawned with the color `0x44ff44` (gel color) scale their radius based on the current `playerState.gelMass`.
- **Impact Scaling**: On landing, particle count and velocity scale dynamically based on the vertical velocity just before impact (impact velocity).
- **Fading**: Particles use a `life` value (1.0 to 0.0) to modulate material opacity before being disposed of and removed from the scene.

### 4. Camera System
- **Smoothing**: Uses linear interpolation (Lerp) on target X and Y axes.
- **Fixed Z**: Camera is positioned at `Z: 12` looking towards `Z: 0`.

### 5. Lua Scripting System
- **Runtime**: Initialized in `core/LuaRuntime.js` using `wasmoon`.
- **Interop**: JavaScript objects are exposed to Lua.
    - `config`: Table containing `playerSpeed`, `jumpImpulse`, and `gravity`.
    - `game`: Table containing functions like `createPlatform(x,y,z,w,h,d,color)`, `createGround()`, `spawnPlayer(x,y,z)`, `setGravity(y)`, `isKeyDown(code)`, `applyImpulse(x,y,z)`, and `getVelocity()`.
- **Hooks**: `onUpdate(delta)`: Optional global Lua function called every frame.

### 6. Weighted Platform System
- **Kinematic Physics**: Platforms use `kinematicPositionBased` rigid bodies to allow for manual displacement.
- **Sinking Mechanics**: Platforms sink (`0.6` units) when the player stands on them (detected via grounded raycast hits).
- **Leaf-like Return**: Platforms smoothly return to their original height using lerp once cleared.

## 📂 File Structure
- `index.html`: Base entry point with UI overlay, CSS styles, and **Game Over** screen.
- `main.js`: Minimal entry point that boots the core engine.
- `core/`: Core engine functionality.
    - `Engine.js`: Main logic for rendering, physics, gel mechanics, and game loop.
    - `LuaRuntime.js`: Wrapper for the Wasmoon Lua VM.
- `ui/`: UI components and styling.
    - `UIManager.js`: Handles coin updates, loading screen, and game-over transitions.
- `scripts/`: Directory for Lua game scripts (e.g., `init.lua`).
- `package.json`: Vite configuration and dependency management.

## 💡 Developer Notes for Agents
- **Adding Platforms**: Use `game.createPlatform(x, y, z, w, h, d, color)` in Lua.
- **Gel Scaling**: Any new particle emitter that should affect the player's mass should use the `0x44ff44` color in `spawnParticles`.
- **Collider Sync**: Don't manually resize the player body; update `playerState.gelMass` and let the collision synchronization handle the recalculation.

---
*Last Updated: March 2026 (Updated with Gel Mechanics)*
