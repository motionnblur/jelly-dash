# Agent Documentation: Gel Run 100-Level Campaign

This document is the implementation-level guide for AI agents and developers working on this project. It describes the current architecture, gameplay rules, level-generation math, and the constraints that matter when changing difficulty.

## Project Overview
This is a 3D vertical climbing platformer built with **Three.js** and **Rapier**. The player is a shrinking gel character that loses health while moving and jumping. Each level is a short airborne route of hexagonal platforms suspended in space, ending in a distinct final hex. Touching the final hex advances to the next level. The game contains a seeded **100-level campaign** with gradual difficulty growth and intermittent easier recovery levels.

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
  - Rapier world setup
  - player bridge / physics snapshotting
  - level generation
  - level progression
  - platform creation and animation
  - sound controller wiring
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
- The player uses a dynamic rigid body with rotations locked on all axes.
- Ground detection uses a small set of downward raycasts from the player base so edge contact still counts as grounded, plus a short coyote window so near-edge jumps do not fail instantly.
- The player collider is rebuilt when `gelMass` changes enough to keep collision size aligned with the visible body.
- There is no physical ground plane in the current campaign. The game starts in space with the player on a floating launch platform.

### 3. Player / Gel Rules
- Horizontal movement is direct X velocity assignment, now driven from `scripts/player/main.lua`.
- Jumping uses `jumpImpulse = 12`.
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

### 4. Drain Economy
- Jump drain is explicit and deterministic:
  - `JUMP_GEL_COST = 0.045` (4.5 HP per jump at 100-HP display scale)
- Walking drain is distance-based:
  - `WALK_GEL_COST = 0.018`
  - one walking drain event fires every `WALK_STEP_DISTANCE = 2.0` world units while grounded and moving
  - effective drain rate: `0.018 / 2.0 = 0.009` gel per world unit walked
- Hard landings now also chip gel based on impact speed, and that hurt event triggers `assets/sounds/impact-sound.mp3`.
- Rocket usage incurs a continuous systemic cost: `ROCKET_GEL_COST = 0.005` (0.5 HP per second while active).
- Level generation is tuned around a target maximum expected level drain:
  - `MAX_SAFE_LEVEL_DRAIN = 0.90`

This is the main balancing invariant. Drain is intentionally aggressive so health management is a real constraint at all stages. Expected per-phase drain at perfect play:
- Opening Arc (levels 1–9): ~28–35 HP
- Rising Rhythm (levels 10–21): ~50–62 HP
- Tighter Gaps (levels 22–35): ~68–78 HP
- Precision Run (levels 36–46): ~80–88 HP
- Final Ascent (levels 47–50): ~88–92 HP

Health is displayed as an integer from 100 to 0 (the internal `gelMass` remains 0.0–1.0 for physics/visual scaling). Critical warning triggers at ≤ 28 HP.

### 5. Platform Model
- All route platforms are kinematic hexagonal prisms.
- Platforms sink slightly while stepped on and lerp back when cleared.
- From level 6 onward, some non-final platforms also oscillate vertically in a deterministic loop.
- The final platform is visually distinct:
  - gold material
  - ring/beacon decoration
  - lighter sink amount
  - gentle bobbing motion
- If the grounded raycast hits the final platform, the next level is queued.

### 6. Level Flow
- The game contains `LEVEL_COUNT = 50`.
- Each level is generated from a seeded profile at startup.
- Entering the final hex starts a short transition, then builds the next level.
- Every new level resets:
  - `gelMass` to `1.0`
  - player transform and velocity
  - jelly animation state
  - particle state
- If the player falls below `y = -10`, a **RUN COLLAPSED** game-over screen appears.
- Level 50 completion shows a campaign-complete overlay.

## Level Generation System

### High-Level Intent
The generator is not purely random. It is a seeded, bounded difficulty system that tries to do four things at once:

1. increase route complexity over 100 levels
2. keep every generated route reachable with the current movement model
3. ensure the gel budget stays survivable
4. insert easier "breather" levels intermittently so the campaign rhythm does not become monotonically harder

### Seed Model
- Global campaign seed:
  - `LEVEL_SEED = 0x5f3759df`
- Per-level RNG:
  - `mulberry32((LEVEL_SEED ^ (level * 0x9e3779b9)) >>> 0)`

This means level generation is deterministic for a given code version. If an agent changes the math, the whole 100-level sequence can change even with the same seed.

### Difficulty Progress Scalar
Each level computes:

```js
progress = (level - 1) / (LEVEL_COUNT - 1)
```

That gives a normalized scalar from `0` to `1`.

This scalar drives most difficulty parameters through linear interpolation:
- platform count
- base gap size
- gap variance
- vertical rise allowance
- vertical fall allowance
- minimum route height
- maximum route height
- platform diameter

There is also an explicit **early-game pressure boost** layered on top of this.

For roughly the first 22% of the campaign:

```js
earlyPressure = max(0, 1 - progress / 0.22)
```

That scalar is used to make the opening levels harder than a plain linear curve would make them. The goal is to avoid a tutorial-like first 10 to 20 levels.

In practice, `earlyPressure` does all of the following:
- increases platform count
- reduces platform diameter slightly
- increases base gap size
- increases gap variance slightly
- increases the final jump distance a little
- increases early vertical rise/fall allowance
- adds a small alternating vertical cadence kick so the opening routes climb and dip instead of reading as flat horizontal chains

Respite levels still receive a reduced version of this boost, but much smaller than normal levels.

### Respite Level Insertion
The game periodically inserts easier levels. These are not every Nth level exactly.

The logic:
- track `levelsSinceRespite`
- force a respite if there have been 8 non-respite levels in a row
- allow a respite after 4 levels with a probability:

```js
0.22 + level * 0.002
```

This creates:
- guaranteed spacing ceiling so the player never goes too long without relief
- enough randomness that the easier levels do not feel scheduled
- slightly more frequent respites than the 100-level version — the 50-level campaign is shorter, so pacing recovery windows matter more

When a level is marked as respite:
- its effective difficulty scalar is reduced:

```js
softenedProgress = max(0, progress - 0.08 - rng() * 0.03)
```

- platforms become slightly larger
- gaps become shorter
- gap variance shrinks
- height swings shrink
- the route pattern becomes `"plateau"` instead of one of the harder route families

### Route Size / Shape Parameters
For each level profile, the generator computes:

```js
platformCount = clamp(round(3 + softenedProgress * 8.0 + rng() * 1.5 + endgameBonus), 3, 10)
platformDiameter = lerp(4.2, 2.55, softenedProgress) + respiteBonus
verticalGapBase = lerp(2.45, 3.55, softenedProgress) - respiteReduction
verticalGapVariance = lerp(0.14, 0.58, softenedProgress) * respiteScale
minX = lerp(-0.65, -2.15, softenedProgress) - respiteOffset
maxX = lerp(0.65, 2.15, softenedProgress) + respiteOffset
swayRightMax = lerp(0.22, 1.45, softenedProgress) * respiteScale
swayLeftMax = lerp(0.18, 1.1, softenedProgress) * respiteScale
```

Interpretation:
- later levels use more platforms
- smaller non-final platforms begin appearing from level 3 onward, and the shrink amount scales up through the campaign
- respites get a softened version of the shrink so they still feel easier than adjacent routes
- later levels widen the vertical climb and increase the amount of lateral sway between platforms
- later levels place the route higher in the frame
- the first fifth of the campaign gets an extra difficulty bump from `earlyPressure`, so early routes are denser than a simple linear interpolation would produce

### Route Patterns
Non-respite levels choose one of these pattern families:
- `glide`
- `pulse`
- `switchback`
- `crest`

Respite levels use:
- `plateau`

These are not separate level templates. They are different vertical delta functions applied while building the chain.

#### `glide`
- mostly rising path
- smooth and readable
- occasional flatter step

#### `pulse`
- alternating rise / dip rhythm
- introduces cadence changes without large brutality spikes

#### `switchback`
- more aggressive alternation between upward and downward adjustments
- creates more timing changes

#### `crest`
- route rises through the early section, then softens or falls slightly late
- good for endgame silhouettes without forcing infinite climb

#### `plateau`
- almost flat
- small, gentle upward drift
- designed to recover pacing and preserve player confidence

### Platform Placement Math
Each route starts from:

```js
x = 0
y = -1.6
```

For each non-final platform:

1. sample vertical gap noise

```js
gapNoise = (rng() * 2 - 1) * verticalGapVariance
gap = max(2.25, (verticalGapBase + gapNoise) * gapScale)
```

2. advance y:
- first step uses `gap * 0.82`
- later steps use full `gap`

3. compute platform diameter with small random wobble, then apply a campaign-scaled shrink to non-final platforms from level 3 onward:

```js
diameter = clamp(platformDiameter + randomOffset - sizeShrink, 1.95, 4.6)
```

4. update `x` using the selected route pattern as lateral sway

5. append platform definition

The final platform is then added using:
- a slightly larger final vertical gap
- a mostly similar horizontal offset to the last route platform
- a slightly larger diameter, but not as generous as the first pass of the campaign generator
- fixed gold color and `isFinal = true`

For early levels, the final gap also receives a small extra push from `earlyPressure`, so the opening stages require more commitment instead of feeling like extended warm-up rooms.

### Survival Budget Math
The generator estimates whether a layout is safe before finalizing it.

The estimate is:

```js
routeDistance = sum(distance(platform[i], platform[i - 1]))
jumpCost = layout.length * JUMP_GEL_COST
walkCost = routeDistance * (WALK_GEL_COST / WALK_STEP_DISTANCE)
estimatedDrain = jumpCost + walkCost
```

Important nuance:
- `layout.length` includes the final platform, so the estimator assumes one jump per platform segment.
- this is intentionally conservative enough to keep routes survivable without simulating full player trajectories

If:

```js
estimatedDrain > MAX_SAFE_LEVEL_DRAIN
```

the generator reduces route spread:

```js
gapScale *= 0.92
```

and regenerates the layout, up to 6 attempts.

This is the main safety valve that keeps late-game routes from becoming mathematically impossible under the drain system.

### What Makes Later Levels Harder
Difficulty growth is mostly from four sources:
- more jumps
- more movement between jumps, both vertically and sideways
- smaller landing surfaces
- bigger and less predictable vertical climb changes
- a subset of non-final platforms also move vertically in looping motion from level 6 onward

The generator does **not** currently add moving hazards, enemies, or fake branch routes. Difficulty is still purely traversal and resource pressure.

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
  - loading overlay
  - game-over overlay
  - campaign-complete overlay
- `main.js`
  - entry point
- `core/Engine.js`
  - rendering, physics, input, gel logic, generator, progression, test hooks
- `core/LuaRuntime.js`
  - Wasmoon wrapper
- `ui/UIManager.js`
  - HUD updates and overlay visibility
- `ui/styles.css`
  - HUD / overlay styling
- `assets/sounds/rocket-sound.mp3`
  - rocket thrust audio cue used while Shift is active
- `assets/sounds/impact-sound.mp3`
  - hurt / landing impact audio cue used on damaging falls
- `scripts/sound/rocketSound.js`
  - rocket thrust audio controller
- `scripts/sound/impactSound.js`
  - landing impact audio controller
- `scripts/shared/world.lua`
  - base-world creation only
- `scripts/player/main.lua`
  - authoritative player loader for the player module folder
- `scripts/player/`
  - `movement.lua`: traversal, jump, landing, drain, and fail-state logic
  - `skills.lua`: rocket thrust, fuel, and spin logic
  - `cheat.lua`: terminal command handling
- `scripts/shared/config.lua`
  - mirrors movement / economy / detection / rocket config into Lua
- `configs/world-config.json`
  - centralized global parameters (gravity, colors, level generation)
- `configs/player-config.json`
  - centralized player parameters (movement, drain costs, rockets, camera)

## Developer Notes For Agents

### If You Want To Rebalance Difficulty
Change these first in `configs/player-config.json` (economy) or `configs/world-config.json` (generation):
- `gelEconomy.jumpCost`
- `gelEconomy.walkCost`
- `gelEconomy.walkStepDistance`
- `campaign.maxSafeLevelDrain`
- the `lerp(...)` endpoints in `generateLevelProfile()` in `core/Engine.js` are still logic-bound, but the base values are now in `world-config.json`.

Rule of thumb:
- if players die too often late, reduce `gapBase`, `gapVariance`, or `platformCount`
- if levels are too easy but feel structurally good, raise drain slightly before increasing geometry brutality
- if the campaign feels repetitive, change the route-pattern deltas before changing the whole difficulty curve

### If You Want To Make Respite Levels More Frequent
Adjust the respite insertion logic in `buildLevelProfiles()`:
- lower the minimum spacing from 3 (currently 4)
- lower the forced spacing from 7 (currently 8)
- raise the respite probability coefficient (currently `0.22 + level * 0.002`)

### If You Want Hand-Authored Milestone Levels
The cleanest approach is:
1. keep the generator for most levels
2. override specific indices like 10, 25, 50, 75, 100 with custom layouts
3. still run the same drain estimate against those layouts

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

### If You Change Player Scale Rules
- do not manually resize the rigid body elsewhere
- update `playerState.gelMass` and let the JS bridge rebuild the collider
- keep `scripts/player/main.lua`, the `scripts/player/` modules, and the `game.player.*` bridge methods in sync when adding new player-state fields

### If You Debug Progression
Look at:
- `buildLevelProfiles()`
- `generateLevelProfile()`
- `createLayoutCandidate()`
- `estimateLayoutDrain()`
- `startLevelTransition()`
- `queueLevelRestart()`
- `scripts/player/main.lua` for player-specific state transitions and drain timing

### UI Design (Green Glassmorphism)
- The UI follows a medical/scifi **green glassmorphism** aesthetic:
  - Frosted glass effects using `backdrop-filter: blur(28px)` and high saturation.
  - Semi-transparent `rgba(92, 255, 120, 0.15)` backgrounds with vibrant green `rgba(92, 255, 120, 0.25)` borders.
  - **Shadowless Design**: All `box-shadow` and `text-shadow` properties are removed for a clean, futuristic look.
  - Premium typography using the **Outfit** font with high-contrast weights (700-800) in green tones.
  - Interactive states:
    - **Health Warning**: Status panel pulses red and the HP value shakes when health is ≤ 28 HP.
    - **Rocket Fuel**: Panel glows and gains a sharper red border while rockets (Shift) are active.
    - **System Terminal**: A centered pop-up terminal for entering cheat codes.
    - **Respite Levels**: Route tags glow soft blue to indicate a recovery level.
    - **Complete State**: Gold-themed glass with reflective styling for the campaign clear screen.

---
*Last Updated: March 27, 2026 (Lua-owned player module folder, Cheat System, God Mode, Green Shadowless UI, 50-level campaign)*
