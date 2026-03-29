# Agent Documentation: Gel Run 50-Level Campaign

This document is the implementation-level guide for AI agents and developers working on this project. It describes the current architecture, gameplay rules, level-generation math, and the constraints that matter when changing difficulty.

## Project Overview
This is a 3D vertical climbing platformer built with **Three.js** and **Rapier**. The player is a shrinking gel character that loses health while moving and jumping. Each level is a short airborne route of hexagonal platforms suspended in space, ending in a distinct final hex. Touching the final hex advances to the next level. The game contains a **50-level campaign** with gradual difficulty growth and intermittent easier recovery levels.

## Tech Stack
- **Rendering**: [Three.js](https://threejs.org/)
- **Physics**: [@dimforge/rapier3d-compat](https://rapier.rs/)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Scripting**: [Wasmoon](https://github.com/ceifa/wasmoon)
- **Language**: JavaScript (ESM) + Lua

## Runtime Architecture

### 1. Engine Ownership
- `core/Engine.js` owns:
  - Three.js setup
  - renderer quality management (`configs/world-config.json.rendering.maxPixelRatio`)
  - Rapier world setup
  - player bridge / physics snapshotting
  - level generation
  - level progression
  - platform creation and animation
  - pooled particle reuse
  - sound controller wiring
  - dev-only lazy level-editor loading
  - deterministic test hooks
- `scripts/player/main.lua` owns the player controller:
  - loader for the `scripts/player/` module set
  - movement input
  - jump handling and coyote timing
  - rocket boost / fuel drain
  - gel drain and death checks
  - landing feedback
  - cheat command handling
- Lua no longer owns level layout. `scripts/shared/world.lua` still initializes the space backdrop, while `scripts/player/main.lua` now loads the runtime player behavior from `scripts/player/`.

### 2. Physics Model
- Rapier initializes asynchronously through `RAPIER.init()`.
- Gravity defaults to `-19.6`.
- **Variable timestep**: `updateFrame` receives the raw `clock.getDelta()` value capped at `1/30` s to guard against tab-switch spikes. `world.integrationParameters.dt` is set to this capped delta before every `world.step()` call, making physics frame-rate independent (correct at 30, 60, 120 Hz, etc.). The `advanceTime` test hook bypasses this by passing `1/60` directly.
- The player uses a dynamic rigid body with rotations locked on all axes.
- Ground detection uses a small set of downward raycasts from the player base so edge contact still counts as grounded, plus a short coyote window so near-edge jumps do not fail instantly.
- The player collider is rebuilt when `gelMass` changes enough to keep collision size aligned with the visible body.
- There is no physical ground plane in the current campaign. The game starts in space with the player on a floating launch platform.
- **X-axis view boundary**: `clampPlayerToViewX()` in `core/Engine.js` runs every frame after the physics step and Lua update. It computes the camera's visible half-width at the player's z depth (using `camera.fov`, `camera.aspect`, and `camera.position.z`) with a 0.5 world-unit inset margin, then snaps the player's x translation back into bounds and zeroes x velocity if they were moving further out. This prevents the player from leaving the camera's horizontal view.

### 3. Player / Gel Rules
- Horizontal movement is direct X velocity assignment, now driven from `scripts/player/main.lua`.
- Jumping uses `jumpImpulse = 12`.
- The player has a **double jump**: a second jump is available while airborne if the first jump (or coyote jump) has already been used. `state.doubleJumpUsed` tracks this and resets each time the player is grounded. Both jumps cost the same gel and produce the same sound/particles.
- Releasing jump early damps upward velocity for variable jump height.
- Landing after a fall triggers a short camera shake, and longer airtime produces stronger impact.
- `gelMass` starts each level at `1.0`.
- Health warning starts at `28 HP` (28%), but actual death happens only at `0`.
- **God Mode**: When `playerState.isGodMode` is true, the player is invincible and gel mass never depletes.
- When the player dies, the run freezes and a context-aware **GAME OVER** overlay appears.

### 4. Rocket Boost Mechanic (L-Shift)
- The player is equipped with red metallic rockets on both sides.
- Activating rockets (Shift) applies a continuous upward thrust: `ROCKET_THRUST = 0.42`.
- Rockets consume fuel from a dedicated meter: `ROCKET_DRAIN_RATE = 0.45` (refills at `0.22` when idle).
- Rocket meshes dynamically sync their X position to the player's current shader-driven scale (`uScale.xz`).
- Thruster visuals include a red glow and red exhaustion particles.
- `assets/sounds/rocket-sound.mp3` plays while rockets are active and is paused + rewound when thrust stops.
- Audio playback is owned by `scripts/sound/rocketSound.js`; `core/Engine.js` only forwards `playerState.isRocketActive` into the controller.
- `assets/sounds/bg-music.mp3` loops as low-volume background music and is started by `scripts/sound/bgMusic.js`.
- Background music loading is deferred until the first user interaction; the file is not requested during the initial boot render.
- Sound volumes are centralized in `configs/sound-config.json`.
- All sound controllers expose `setVolume(0.0–1.0)` and `setEnabled(bool)` for runtime control by the options menu.

### 4. Drain Economy
- Jump drain is explicit and deterministic:
  - `JUMP_GEL_COST = 0.045` (4.5 HP per jump at 100-HP display scale)
- Walking drain is distance-based:
  - `WALK_GEL_COST = 0.018`
  - one walking drain event fires every `WALK_STEP_DISTANCE = 2.0` world units while grounded and moving
  - effective drain rate: `0.018 / 2.0 = 0.009` gel per world unit walked
- Hard landings chip gel based on **relative** impact speed (player velocity minus the stood-on platform's vertical velocity), and that hurt event triggers `assets/sounds/impact-sound.mp3`. This ensures fast-bobbing platforms do not inflict false impact damage.
- Rocket usage incurs a continuous systemic cost: `ROCKET_GEL_COST = 0.005` (0.5 HP per second while active).
- Level generation is tuned around a target maximum expected level drain:
  - `MAX_SAFE_LEVEL_DRAIN = 0.90`

This is the main balancing invariant. Drain is intentionally aggressive so health management is a real constraint at all stages. Expected per-phase drain at perfect play:
- Opening Arc (levels 1–9): ~28–35 HP
- Rising Rhythm (levels 10–15): ~50–62 HP

Health is displayed as an integer from 100 to 0 (the internal `gelMass` remains 0.0–1.0 for physics/visual scaling). Critical warning triggers at ≤ 28 HP.

### 5. Platform Model
- All route platforms are kinematic hexagonal prisms.
- Platforms sink slightly while stepped on and lerp back when cleared.
- From level 6 onward, some non-final platforms also oscillate vertically in a deterministic loop.
- Some platforms also oscillate **horizontally** (`swingAmplitude`, `swingSpeed`). When the player is standing on a swinging platform, its X velocity is computed each frame (`deltaX / delta`) and added to the player's linvel so the player is carried along. This is handled in `updatePlatforms()` in `core/Engine.js`.
- Each platform tracks its vertical velocity (`platform.lastVelY`, computed as `deltaY / delta` each frame in `updatePlatforms`). This velocity is passed to Lua via `groundPlatformVelY` in the player snapshot so landing impact damage uses relative velocity rather than raw player velocity.
- The final platform is visually distinct:
  - gold material
  - ring/beacon decoration
  - lighter sink amount
  - gentle bobbing motion
- If the grounded raycast hits the final platform, the next level is queued.

### 6. Level Flow
- The game contains `LEVEL_COUNT = 15`.
- Each level is loaded from a static JSON file (`configs/levels/level1.json` … `configs/levels/level15.json`) at startup via `import.meta.glob`.
- Entering the final hex starts a short transition, then builds the next level.
- When the final hex is touched, a win sound plays and the player's horizontal velocity is immediately zeroed every frame until the next level loads (vertical velocity is left intact for gravity).
- Every new level resets:
  - `gelMass` to `1.0`
  - player transform and velocity
  - jelly animation state
  - particle state
- If the player falls below `y = -10`, a **RUN COLLAPSED** game-over screen appears.
- On any game-over (gel depleted, fall, or other cause), pressing RETRY (or Enter/Escape on the game-over screen) always restarts from **level 1**, not the current level.
- Level 15 completion shows a campaign-complete overlay.

### 7. Pause and Menu System
- **P key**: toggles a simple **GAME PAUSED** overlay. `updateFrame` is skipped while paused; the scene continues rendering so the overlay is visible. On unpause, the clock delta is discarded to prevent a physics spike.
- **ESC key**: opens the **ESC Menu** (RESTART / OPTIONS / RESUME). The game is paused while any menu overlay is open.
  - **RESTART**: closes the menu and restarts from level 1.
  - **OPTIONS**: slides into the Options panel (ESC menu hides, options panel shows). ESC inside options goes back to the ESC menu rather than toggling it in the background.
  - **RESUME**: closes the menu and unpauses.
- Menu state is tracked in `gameplayState`: `isPaused`, `isEscMenuOpen`, `isOptionsOpen`.
- `openEscMenu()`, `closeEscMenu()`, `openOptions()`, `closeOptions()` in `core/Engine.js` are the canonical functions for state transitions — use these, not direct `uiManager` calls.

### 8. Options Menu (Sound)
- Opened from the ESC menu OPTIONS button; BACK or ESC returns to the ESC menu.
- Runtime audio state lives in the `audioOptions` object in `core/Engine.js`:
  - `audioOptions.master` — global on/off bool
  - `audioOptions.bgMusic`, `.jump`, `.rocket`, `.impact`, `.win` — each has `{ enabled: bool, volume: 0.0–1.0 }`
- `applyAudioChannel(channel)` computes effective enabled (`master && channelEnabled`) and calls `setVolume` / `setEnabled` on the relevant controller.
- `applyAllAudio()` calls `applyAudioChannel` for all five channels.
- When master is off, all channel rows in the UI are dimmed and non-interactive via the `.master-off` CSS class on `.opt-body`.
- Initial slider values are seeded from `configs/sound-config.json`. Changes apply live and are not persisted across page reloads.

## Level Data System

### Overview
Levels are stored as static JSON files rather than being generated at runtime.

- **Location**: `configs/levels/level1.json` … `configs/levels/level15.json`
- **Loader**: `buildLevelProfilesFromFiles(levelJsonModules)` in `core/Engine.js` reads all 15 files eagerly via `import.meta.glob("../configs/levels/level*.json", { eager: true, import: "default" })` and builds the `levelState.profiles` array in level order.
- **Generator script**: `tools/generate-levels.js` is a one-off Node.js ESM script that was used to produce the initial level JSON files using the original seeded math. Run `node tools/generate-levels.js` again if the seed constants or generator math change (update `LEVEL_COUNT` in that script to 15 first).

### Level Profile Schema
Each JSON file contains one profile object:

```json
{
  "level": 1,
  "isRespite": false,
  "label": "OPENING ARC",
  "estimatedDrain": 0.38,
  "layout": [...]
}
```

Each entry in `layout` is a platform definition:

| Field | Type | Description |
|---|---|---|
| `x`, `y`, `z` | number | World position |
| `w`, `h`, `d` | number | Dimensions (w = d = diameter, h = 0.5) |
| `color` | number | Hex color integer |
| `isFinal` | bool | True for the goal platform |
| `shape` | string | `"hex"`, `"square"`, or `"triangle"` |
| `rotationY` | number | Rotation around Y axis in radians |
| `isDestroyable` | bool | Whether the platform breaks on hit |
| `hitsToBreak` | number | 0 for indestructible, 2 for breakable |
| `bobPhase` | number | Initial phase offset for vertical motion |
| `motionAmplitude` | number | Vertical wave amplitude (0 = no motion) |
| `motionSpeed` | number | Vertical wave frequency |
| `swingAmplitude` | number | Horizontal pendulum amplitude |
| `swingSpeed` | number | Horizontal pendulum frequency |

### Editing Levels
Use the in-game level editor (FAB button, bottom-right). When done, click **SAVE** to write `levelN.json` directly to `configs/levels/` on disk. After saving, a full page reload (F5) picks up the changes — no dev server restart needed.

### What Makes Later Levels Harder
Difficulty grows across the 50 levels via the stored layout data:
- more platforms per level
- smaller landing surfaces
- larger vertical gaps between platforms
- more lateral sway between platforms
- vertical wave motion on platforms (from level 6 onward)
- horizontal pendulum motion on alternating platforms (from level 3 onward)
- breakable platforms (from level 4 onward)

## Input Map

| Key | Action |
|-----|--------|
| A / Arrow Left | Move left |
| D / Arrow Right | Move right |
| Space | Jump (hold for higher jump) |
| Shift | Rocket boost |
| P | Toggle pause |
| ESC | Open/close ESC menu (or go back from Options) |
| F1 | Toggle developer cheat terminal |
| Q | **Editor**: toggle gizmo mode (move axes / rotate ring) |
| Delete | **Editor**: remove selected platform or pickup |
| Ctrl+D / Cmd+D | **Editor**: duplicate selected platform or pickup |
| Ctrl+Z / Cmd+Z | **Editor**: undo editor action |
| R | **Editor**: reset orbit camera |

> **Note:** When `gameplayState.isEditorOpen` is `true`, the main `onKeyDown` handler returns immediately after the `F1` check. P and ESC have no effect while the level editor is open; editor-specific shortcuts are handled by `onEditorKeyDown` in `editor/LevelEditor.js`.

## Cheat System (F1 Terminal)
The game includes a hidden system terminal for developers and advanced users.

- **Trigger**: `F1` toggles the terminal UI.
- **Animation**: The terminal pops in from the center of the screen with a scale/fade effect.
- **Commands**:
  - `godmode`: Toggles invincibility.
  - `rocketboy`: Toggles unlimited rocket fuel and health protection during flight.
- **Behavior**:
  - The terminal clears its history and input upon closing.
  - While the terminal is open, standard gameplay keybinds are disabled to prevent accidental movement.

## Deterministic Test Hooks
`core/Engine.js` exposes:

- `window.render_game_to_text()`
- `window.advanceTime(ms)`

Use these when validating layout generation or progression through Playwright or another browser automation loop.

`render_game_to_text()` returns:
- current mode
- coordinate system note
- current level index / total
- route label
- whether the level is a respite
- player position / velocity / gel mass
- rocket fuel / active boost state
- cheat flags for god mode and rocketboy
- camera shake state for landing feedback
- all current platform positions and final-flag state

## File Structure
- `index.html`
  - HUD shell
  - route minimap panel (`.minimap-panel`) with SVG stage (`#minimap-svg`)
  - loading overlay
  - game-over overlay
  - paused overlay (`#paused`)
  - ESC menu overlay (`#esc-menu`) — RESTART / OPTIONS / RESUME
  - options menu overlay (`#options-menu`) — master toggle, BG music, and per-FX controls
  - campaign-complete overlay
  - no editor markup in production HTML; dev-only editor DOM is injected at runtime
- `main.js`
  - entry point
- `core/Engine.js`
  - rendering, physics, input, gel logic, level loading, progression, test hooks
  - renderer caps internal DPR using `configs/world-config.json.rendering.maxPixelRatio`
  - pause state (`gameplayState.isPaused`, `isEscMenuOpen`, `isOptionsOpen`, `isEditorOpen`)
  - audio options state (`audioOptions`) and `applyAudioChannel` / `applyAllAudio`
  - menu helpers: `openEscMenu`, `closeEscMenu`, `openOptions`, `closeOptions`
  - options UI wiring: `initOptionsUI`
  - `ensureBackgroundMusicController()` defers background music controller creation until the first key / pointer interaction
  - `ensureDevEditorTrigger()` injects a tiny dev-only FAB when `import.meta.env.DEV` is true
  - `removeProductionEditorUI()` strips the editor DOM from production builds
  - `ensureLevelEditorReady()` lazy-loads `editor/LevelEditor.js` only in dev builds; the first FAB click imports the module and opens it
  - particles use pooled mesh instances with shared geometry rather than per-spawn create/dispose churn
  - `clampPlayerToViewX()` — called every frame after physics step and Lua update; constrains the player's x position to the camera's visible frustum with a 0.5 world-unit inset margin, zeroing x velocity on contact
  - `rebuildCurrentLevelPlatforms()` — clears and recreates all platforms from `levelState.currentProfile.layout` without resetting the player; used by the level editor
  - `levelEditorRef` — holds the return value of `initLevelEditor`; its `tick()` is called every frame when the editor is open to keep the orbital camera updated
  - `getPlayerSnapshot()` — returns the per-frame runtime snapshot consumed by Lua; includes `keys: { left, right, jump, boost }` (pre-computed booleans from the JS `keys` map), `pendingHealthRestore` / `pendingRocketFuel` (consumed and zeroed here), and `groundPlatformVelY` (vertical velocity of the stood-on platform, used for relative impact damage); Lua reads these fields directly from the snapshot instead of making separate bridge calls
- `editor/LevelEditor.js`
  - in-game level editor; development-only, lazy-loaded on the first `#editor-fab` click in dev, then initialized with live references to `scene`, `camera`, `renderer`, `platforms`, `levelState`, `gameplayState`, `clock`, `rebuildCurrentLevelPlatforms`, and `buildLevel`
  - `ensureEditorDOM()` injects the editor panel and stop-test button on demand; `index.html` no longer contains static editor markup
  - toggled open/closed by `#editor-fab`; sets `gameplayState.isEditorOpen` and `gameplayState.isPaused` when open
  - orbital camera controls while open: left-drag = orbit, right-drag = pan, scroll = zoom; original camera is restored on close
  - platform selection via Three.js `Raycaster` on canvas click; selected platform highlighted with cyan emissive override
  - live property editing: position, size, shape, rotation, color, vertical motion, horizontal swing, destroyable flags — each change pushes history then calls `rebuildCurrentLevelPlatforms()`
  - **Transform gizmo**: `buildGizmo(scene)` creates a `THREE.Group` with three colored axis arrows (X = red `0xff2222`, Y = green `0x22ff44`, Z = blue `0x2266ff`) plus a Y-axis rotation ring; all handles render with `depthTest: false` so they stay visible on top; `Q` toggles between translate and rotate modes; `scaleGizmo()` keeps the visual size constant by scaling against camera distance
    - hovering the active handle turns it yellow (`AXIS_HOVER = 0xffdd00`)
    - clicking and dragging an axis arrow moves the selected object along that axis using plane-intersection math (`makeDragPlane` builds a plane containing the axis with its normal facing the camera; `rayPlaneHit` intersects the mouse ray; the delta is projected onto the axis vector for 1D movement)
    - clicking and dragging the rotate ring rotates the selected object around Y (`makeRotatePlaneY` + angle-delta math); platform inspector `Rot °` updates live during drag
    - the mesh and Rapier body are updated live on every `mousemove` during a drag; `rebuild()` (which recreates the full physics collider) fires only on `mouseup`
    - history is pushed at `mousedown` (before drag starts) so a full drag undo is a single step
  - **Undo system**: `pushHistory()` deep-copies `levelState.currentProfile.layout` onto a capped stack (`MAX_HISTORY = 60`); `undo()` pops the stack, restores the layout in-place, calls `rebuildCurrentLevelPlatforms()` directly (bypassing `rebuild()` to avoid re-pushing), then refreshes the UI; history is cleared on level change and on editor close
    - `pushHistory()` is called before: every property input `change` event, every color `input` event, gizmo drag start (`mousedown`), Add, Delete, Duplicate
    - `rebuild()` itself does **not** push history — callers are responsible
    - **Ctrl/Cmd+Z** is handled by `onEditorKeyDown` (registered on `window` while the editor is open); skipped when form controls are focused so browser-native field undo still works
    - `#editor-undo-btn` also calls `undo()` for mouse-only workflows
  - level navigation (prev/next arrows) calls `buildLevel()` to switch levels while staying in editor mode; clears history
  - Add platform: inserts a `freshPlatformDef` before the final platform in the layout
  - Delete selected object: removes the selected platform or pickup (`Delete` key or `#editor-delete-btn`)
  - Duplicate selected object: clones the selected platform or pickup (`Ctrl/Cmd+D`) with a small position offset and selects the duplicate; duplicating the final platform forces the clone to non-final to preserve a single level goal
  - **SAVE button** (`#editor-export-btn`): POSTs the full profile object (`level`, `isRespite`, `label`, `estimatedDrain`, `layout`) to `/api/save-level`; before serializing, calls `flushPropertiesToDef()` to capture any uncommitted input values (typed but not yet blurred); on success shows `✓ SAVED`, on failure shows `✗ FAILED`
- `core/LuaRuntime.js`
  - Wasmoon wrapper
  - `callFunction(name, ...args)` caches Lua global function references in `_fnCache` after the first lookup — avoid calling `lua.global.get(name)` every frame for hot paths like `onUpdate`
- `ui/UIManager.js`
  - HUD updates and overlay visibility
  - minimap rendering (`resizeMinimap`, `updateMinimap`) from current route layout + live player position
  - minimap syncs SVG `viewBox` to measured panel size so route/player markers use the same coordinate space
  - minimap SVG regeneration is throttled; forced refreshes happen on resize, level load, and editor rebuilds
  - player marker is always readable: high-contrast pulse marker, edge clamp, and offscreen direction arrow when player is outside route bounds
  - `showPaused` / `hidePaused`
  - `showEscMenu` / `hideEscMenu`
  - `showOptions` / `hideOptions`
  - `setMasterOffDim(bool)` — toggles `.master-off` on `.opt-body`
  - capture-phase keydown listener: Enter/Escape triggers RETRY when game-over overlay is open; uses `stopImmediatePropagation` to block Engine's ESC handler
- `ui/styles.css`
  - HUD / overlay styling
  - ESC menu styles (`.esc-menu-content`, `.esc-nav`, `.esc-btn`)
  - options panel styles (`.options-panel`, `.opt-row`, `.opt-toggle`, `.opt-slider`)
  - level editor styles (`#editor-fab`, `.editor-panel`, `.ed-item`, `.ed-num`, `.ed-sel`, `.ed-color`, `.ed-chk`, `.ed-lbl--x/y/z` axis-coloured labels, `.ed-action-btn--undo`, etc.)
- `assets/sounds/rocket-sound.mp3`
  - rocket thrust audio cue used while Shift is active
- `assets/sounds/impact-sound.mp3`
  - hurt / landing impact audio cue used on damaging falls
- `assets/sounds/bg-music.mp3`
  - looping background music at low volume
- `assets/sounds/win-sound.mp3`
  - played once when the player touches the final hex and triggers a level transition
- `scripts/sound/bgMusic.js`
  - background music controller (`play`, `destroy`, `setVolume`, `setEnabled`); uses `preload = "none"` so the track is fetched only after an interaction-triggered play attempt
- `scripts/sound/rocketSound.js`
  - rocket thrust audio controller (`sync`, `destroy`, `setVolume`, `setEnabled`)
- `scripts/sound/impactSound.js`
  - landing impact audio controller (`play`, `setVolume`, `setEnabled`)
- `scripts/sound/jumpSound.js`
  - jump audio controller (`play`, `setVolume`, `setEnabled`)
- `scripts/sound/winSound.js`
  - level-complete audio controller (`play`, `setVolume`, `setEnabled`)
- `scripts/shared/world.lua`
  - base-world creation only
- `scripts/player/main.lua`
  - authoritative player loader for the player module folder
  - `_applyBuf` — module-level pre-allocated table (with nested `velocity`, `jelly.velocity`, `jelly.scale` tables) reused every frame by `applyState()`; fields are mutated in-place to avoid per-frame Lua table allocation
- `scripts/player/`
  - `movement.lua`: traversal, jump, landing, drain, and fail-state logic; reads input from `runtime.keys` (pre-computed in snapshot) and pickup restores from `runtime.pendingHealthRestore`; uses `math.random()` natively — no JS bridge calls for these
  - `skills.lua`: rocket thrust, fuel, and spin logic; reads input from `runtime.keys` and pickup fuel from `runtime.pendingRocketFuel`; uses `math.random()` natively
  - `cheat.lua`: terminal command handling
- `scripts/shared/config.lua`
  - mirrors movement / economy / detection / rocket config into Lua
- `configs/world-config.json`
  - centralized global parameters (gravity, colors, level generation, `rendering.maxPixelRatio`)
- `configs/player-config.json`
  - centralized player parameters (movement, drain costs, rockets, camera)
- `configs/sound-config.json`
  - centralized sound volumes (keys: `backgroundMusic`, `rocket`, `jump`, `impact`, `win`)
- `configs/levels/level1.json` … `configs/levels/level15.json`
  - static level data; each file is one profile object loaded eagerly at startup
- `tools/generate-levels.js`
  - one-off Node.js ESM script that regenerates all 50 JSON files using the original seeded generator math; run with `node tools/generate-levels.js`
- `vite.config.js`
  - defines the `levelSaverPlugin` Vite dev plugin; adds a `POST /api/save-level` middleware that writes the POSTed profile JSON to `configs/levels/levelN.json` and invalidates the corresponding module in Vite's module graph so the next F5 serves fresh data; also sets `server.watch.ignored` for `configs/levels/**` to prevent HMR page reloads when level files change

## Developer Notes For Agents

### If You Want To Rebalance Difficulty
- Edit individual level JSON files in `configs/levels/` using the in-game level editor and click **SAVE**
- To rebalance gel drain economy, change `configs/player-config.json`: `gelEconomy.jumpCost`, `gelEconomy.walkCost`, `gelEconomy.walkStepDistance`
- To regenerate all levels from scratch with different seeded parameters, edit `tools/generate-levels.js` constants and run `node tools/generate-levels.js`

### If You Want To Hand-Author a Level
1. Open the in-game level editor (FAB button)
2. Navigate to the desired level
3. Edit platforms/pickups using the gizmo and property panel (`Q` toggles move/rotate, `Delete` removes selection, `Ctrl/Cmd+D` duplicates selection)
4. Click **SAVE** — writes the profile directly to `configs/levels/levelN.json` on disk
5. Press F5 to reload the game; changes are live

### If You Want To Make Respite Levels More Frequent
Edit `tools/generate-levels.js`:
- lower the minimum spacing from 3 (currently 4)
- lower the forced spacing from 7 (currently 8)
- raise the respite probability coefficient (currently `0.22 + level * 0.002`)
- run `node tools/generate-levels.js` to regenerate

### If You Add New Gel-Draining Effects
- Prefer explicit drain through `drainGel(amount)` or `spawnParticles(..., { drainGelTotal })`
- Do not hide health costs in unrelated visual-only effects unless the mechanic is meant to be systemic
- Remember that new drains (like Rocket usage) can invalidate the current level-budget math.

### If You Want To Tune Rockets
Adjust these in `configs/player-config.json`:
- `rockets.thrust`: Upward force intensity.
- `rockets.drainRate`: How fast the fuel meter empties.
- `rockets.refillRate`: How fast the fuel meter recovers.
- `gelEconomy.rocketGelCost`: The health penalty for using rockets.

### If You Want To Tune Camera X Tracking
Adjust these in `configs/player-config.json`:
- `camera.xFollowFactor`: How strongly the camera follows the player's X movement.
- `camera.xFollowClamp`: Absolute left/right clamp for camera X tracking and X look target.
- `camera.lookAtXFactor`: How strongly the camera look target follows the player's X movement before clamping.

### If You Change Player Scale Rules
- do not manually resize the rigid body elsewhere
- update `playerState.gelMass` and let the JS bridge rebuild the collider
- keep `scripts/player/main.lua`, the `scripts/player/` modules, and the `game.player.*` bridge methods in sync when adding new player-state fields

### Lua / JS Bridge Performance Rules
The Lua integration is optimized to minimize JS↔WASM boundary crossings per frame. Follow these rules when modifying or extending the Lua player scripts:
- **Do not add new `game.*` calls inside `Movement.update` or `Skills.update`** unless strictly necessary. Each call crosses the JS↔WASM boundary at 60 fps.
- **Input reads must come from `runtime.keys`**, not `game.isKeyDown(code)`. Key state is pre-computed once per frame in `getPlayerSnapshot()` in `core/Engine.js` as `{ left, right, jump, boost }`. If you need a new input, add it there and read it from the snapshot.
- **Pickup / one-shot values must be bundled into the snapshot**. Do not add new `game.player.consumePending*()` bridge methods. Instead, add the value to `getPlayerSnapshot()`, zero it out there, and read it from `runtime.*` in Lua.
- **Do not use `game.random()`** — use Lua's `math.random()` directly.
- **Do not allocate new Lua tables inside `applyState()`** — update `_applyBuf` fields in-place. If you add a new field to the apply payload, add it to `_applyBuf` at declaration time in `main.lua`.
- **`LuaRuntime.callFunction` caches function references** — if you add a new globally-exposed Lua function called from JS, it will be cached automatically after the first call. Do not call `lua.global.get()` manually for hot paths.

### If You Debug Progression
Look at:
- `buildLevelProfilesFromFiles()` in `core/Engine.js` — level loading
- `configs/levels/levelN.json` — the actual level data
- `startLevelTransition()`
- `queueLevelRestart()`
- `scripts/player/main.lua` for player-specific state transitions and drain timing

### If You Add a New Sound Effect
1. Create `assets/sounds/<name>.mp3`.
2. Create `scripts/sound/<name>Sound.js` following the pattern of `impactSound.js` — export a `create<Name>SoundController(soundConfig)` that returns `{ play, setVolume, setEnabled }`.
3. Add a `"<name>": { "volume": 0.75 }` entry to `configs/sound-config.json`.
4. Import and instantiate the controller in `core/Engine.js` alongside the others.
5. Add a channel entry to `audioOptions` in `core/Engine.js`.
6. Add a row to the `#options-menu` in `index.html` and bind it in `initOptionsUI`.

### If You Add a New Menu Overlay
- Follow the existing overlay pattern: `position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 1000;` with the frosted-glass backdrop.
- Add `show<Name>` / `hide<Name>` methods to `UIManager`.
- Manage the open/close state in `gameplayState` so the ESC key handler can make correct routing decisions.

### UI Design (Green Glassmorphism)
- The UI follows a medical/scifi **green glassmorphism** aesthetic:
  - Frosted glass effects using `backdrop-filter: blur(28px)` and high saturation.
  - Semi-transparent backgrounds with vibrant green `rgba(92, 255, 120, 0.25)` borders.
  - **Shadowless Design**: All `box-shadow` and `text-shadow` properties are removed for a clean, futuristic look.
  - Premium typography using the **Outfit** font with high-contrast weights (700-800) in green tones.
- **Portrait Layout**: The game renders in a **9:16 portrait canvas** (`getPortraitSize()` in `core/Engine.js` caps width at `height × 9/16`). The canvas is centered in the browser window via a flex body. `#game-wrap` is a `position: relative` container sized by JS; the canvas and `#overlay` live inside it. All other overlays remain `position: fixed` and cover the full viewport.
  - Renderer quality is capped by `configs/world-config.json.rendering.maxPixelRatio` rather than blindly matching the full browser DPR; this is the main low-spec / high-DPI safeguard.
- **HUD Layout**:
  - **Stat panel** (`#stat-panel`): a compact 72 px-wide glass panel at top-left containing two side-by-side vertical bar columns. Each column (`.vbar-col`) has an icon at the top (`⬡` for GEL, `▲` for Rocket), a tall narrow pill track (`.vbar-track`, 10 px wide, min 80 px tall) whose fill (`.vbar-fill`) grows from the bottom via `height %`, and a value + unit label at the bottom. `UIManager` sets `style.height` (not `style.width`) on `#health-fill` and `#rocket-fill`.
  - **Route panel** (`.level-panel`): glass panel positioned `position: absolute; bottom: 8px; left: 8px` inside `#game-wrap`. Shows current level and route tag.
  - **Minimap panel** (`.minimap-panel`): glass panel positioned at bottom-right of `#game-wrap` showing the current route graph and live player marker. Route nodes remain route-relative while player marker stays visible via edge clamping and draws a direction pointer when the player is outside mapped bounds.
- Interactive states:
  - **Health Warning**: `#health-value` shakes and `.health-panel .stat-icon` turns red when health is ≤ 28 HP.
  - **Rocket Active**: `.stat-icon--boost` brightens while rockets are active; `.rocket-panel.is-empty` dims when fuel is zero.
- **Game-over keyboard shortcuts**: When the game-over overlay is visible, pressing **Enter** or **Escape** triggers the RETRY button. This listener is registered in the **capture phase** (`addEventListener("keydown", …, true)`) and calls `e.stopImmediatePropagation()` so the Engine's ESC-menu handler never fires at the same time.
  - **System Terminal**: A centered pop-up terminal for entering cheat codes.
  - **Respite Levels**: Route tags glow soft blue to indicate a recovery level.
  - **Complete State**: Gold-themed glass with reflective styling for the campaign clear screen.
  - **Paused / ESC Menu / Options**: Frosted green-glass overlays with `consolePop` entrance animation.

---
*Last Updated: March 30, 2026 (campaign trimmed to 15 levels, title screen buttons use semi-transparent glassmorphism style with no backdrop-filter, ESC menu OPTIONS/MAIN MENU buttons match RESTART style, opening options from title screen keeps title screen visible as backdrop, game-over always restarts from level 1, variable-timestep physics fix, x-axis view boundary clamp, portrait 9:16 layout, platform lateral carry, double jump, compact icon-based HUD, vertical HP/rocket bars, route panel at bottom-left, minimap panel with always-visible player marker + offscreen direction arrow, camera X follow with configurable clamp, game-over Enter/Escape retry shortcut, development-only in-game level editor with orbital camera, move/rotate transform gizmo toggle on Q, Delete + Ctrl/Cmd+D editor shortcuts, live property editing, Ctrl/Cmd+Z undo, JSON-file-based level system, level editor SAVE button with direct disk write and Vite module cache invalidation, low-spec optimizations: capped render DPR, pooled particle meshes, throttled minimap SVG rebuilds, deferred background music loading, production editor stripping, Lua/JS bridge performance optimizations: key snapshot in getPlayerSnapshot, pending pickup values bundled into snapshot, LuaRuntime function reference cache, pre-allocated applyState buffer, in-place vector mutation, math.random() in Lua, relative-velocity landing impact fix for bobbing platforms)*
