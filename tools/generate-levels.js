import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../assets/levels");

// --- Constants (mirrors world-config.json + player-config.json) ---
const LEVEL_COUNT = 50;
const LEVEL_SEED = 1597500383;
const MAX_SAFE_LEVEL_DRAIN = 0.9;
const LEVEL_PATTERNS = ["glide", "pulse", "switchback", "crest"];
const LEVEL_COLORS = [7401983, 16747099, 7864190, 16736157, 9143807, 16765798];
const PLATFORM_HEIGHT = 0.5;
const JUMP_GEL_COST = 0.04;
const WALK_GEL_COST = 0.018;
const WALK_STEP_DISTANCE = 2.0;

// --- Math helpers ---
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

function applyDifficultyCurve(rawProgress) {
  const cutoff = 4 / (LEVEL_COUNT - 1);
  if (rawProgress <= cutoff) {
    return rawProgress * (0.08 / cutoff);
  }
  const t = (rawProgress - cutoff) / (1 - cutoff);
  return 0.08 + Math.pow(t, 0.62) * 0.92;
}

function choosePlatformShape(rng) {
  const roll = rng();
  if (roll < 0.24) return "triangle";
  if (roll < 0.52) return "square";
  return "hex";
}

function buildLevelLabel(level, progress, isRespite) {
  if (isRespite) return "BREATHER ROUTE";
  if (level >= LEVEL_COUNT - 3) return "FINAL ASCENT";
  if (progress < 0.12) return "OPENING ARC";
  if (progress < 0.35) return "RISING RHYTHM";
  if (progress < 0.65) return "TIGHTER GAPS";
  return "PRECISION RUN";
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

function computePlatformSway(config) {
  const {
    index, platformCount, x, minX, maxX,
    swayRightMax, swayLeftMax, pattern, rng, earlyPressure,
  } = config;
  const ratio = platformCount <= 1 ? 1 : index / (platformCount - 1);
  let delta = 0;

  switch (pattern) {
    case "glide":
      delta = lerp(0.12, swayRightMax, ratio) * (0.45 + rng() * 0.35);
      if (index % 4 === 3) delta *= 0.55;
      break;
    case "pulse":
      delta = index % 3 === 1
        ? -swayLeftMax * (0.45 + rng() * 0.25)
        : swayRightMax * (0.35 + rng() * 0.45);
      break;
    case "switchback":
      delta = index % 4 < 2
        ? swayRightMax * (0.45 + rng() * 0.4)
        : -swayLeftMax * (0.4 + rng() * 0.3);
      break;
    case "crest":
      delta = ratio < 0.56
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

function createLayoutCandidate(config) {
  const {
    platformCount, platformDiameter, verticalGapBase, verticalGapVariance,
    minX, maxX, swayRightMax, swayLeftMax, pattern, gapScale, progress,
    rng, isRespite, earlyPressure, level, hasWavingPlatforms, hasSwingingPlatforms,
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
        ? (0.06 + rng() * 0.1 + sizeShrinkProgress * 0.16 + (index % 2 === 1 ? 0.05 : 0)) *
          (isRespite ? 0.72 : 1)
        : 0;
    const diameter = clamp(platformDiameter + diameterNoise - sizeShrink, 1.95, 4.6);

    x = computePlatformSway({
      index, platformCount, x, minX, maxX,
      swayRightMax, swayLeftMax, pattern, rng, earlyPressure,
    });

    const rawSwingAmp = 0.22 + rng() * 0.28 + Math.min(0.2, Math.max(0, level - 12) * 0.009);
    const rawSwingSpeed = 0.55 + rng() * 0.65;
    const hasSwing = hasSwingingPlatforms && !isRespite && index > 0 && index % 2 === 1;
    const isDestroyable =
      !isRespite &&
      index > 0 &&
      !hasSwing &&
      level >= 4 &&
      rng() < 0.2 + Math.min(0.12, progress * 0.12);

    layout.push({
      x,
      y,
      z: 0,
      w: diameter,
      h: PLATFORM_HEIGHT,
      d: diameter,
      color: LEVEL_COLORS[(index + Math.floor(progress * 6)) % LEVEL_COLORS.length],
      isFinal: false,
      shape: choosePlatformShape(rng),
      rotationY: rng() * Math.PI * 2,
      isDestroyable,
      hitsToBreak: isDestroyable ? 2 : 0,
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
    (verticalGapBase + 0.38 + rng() * verticalGapVariance + earlyPressure * (isRespite ? 0.06 : 0.16)) * gapScale,
  );
  const finalX = clamp(
    x + (isRespite ? 0.04 : (rng() - 0.25) * Math.min(swayRightMax, 0.55)),
    minX,
    maxX,
  );
  const finalDiameter = clamp(platformDiameter + 0.22 + (isRespite ? 0.18 : 0), 3.0, 4.7);

  layout.push({
    x: finalX,
    y: y + finalGap,
    z: 0,
    w: finalDiameter,
    h: PLATFORM_HEIGHT,
    d: finalDiameter,
    color: 0xffd166,
    isFinal: true,
    shape: "hex",
    rotationY: rng() * Math.PI * 2,
    isDestroyable: false,
    hitsToBreak: 0,
    bobPhase: ((level * 31 + platformCount * 17 + 11) % 360) * (Math.PI / 180),
    motionAmplitude: 0,
    motionSpeed: 0,
    swingAmplitude: 0,
    swingSpeed: 0,
  });

  return layout;
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
      3 + shapeProgress * 8.0 + rng() * 1.5 +
      (progress > 0.7 ? 0.8 : 0) +
      earlyPressure * (isRespite ? 0.35 : 0.95),
    ),
    3, 10,
  );
  const platformDiameter =
    lerp(4.2, 2.55, shapeProgress) + (isRespite ? 0.28 : 0) - earlyPressure * (isRespite ? 0.05 : 0.18);
  const verticalGapBase =
    lerp(2.45, 3.55, shapeProgress) - (isRespite ? 0.28 : 0) + earlyPressure * (isRespite ? 0.04 : 0.24);
  const verticalGapVariance =
    lerp(0.14, 0.58, shapeProgress) * (isRespite ? 0.76 : 1) + earlyPressure * (isRespite ? 0.02 : 0.05);
  const minX = lerp(-0.65, -2.15, shapeProgress) - (isRespite ? 0.18 : 0);
  const maxX = lerp(0.65, 2.15, shapeProgress) + (isRespite ? 0.18 : 0);
  const swayRightMax =
    lerp(0.22, 1.45, shapeProgress) * (isRespite ? 0.76 : 1) + earlyPressure * (isRespite ? 0.03 : 0.15);
  const swayLeftMax =
    lerp(0.18, 1.1, shapeProgress) * (isRespite ? 0.74 : 1) + earlyPressure * (isRespite ? 0.02 : 0.12);
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
      platformCount, platformDiameter, verticalGapBase, verticalGapVariance,
      minX, maxX, swayRightMax, swayLeftMax, pattern, gapScale,
      progress: shapeProgress, rng, isRespite, earlyPressure, level,
      hasWavingPlatforms, hasSwingingPlatforms,
    });
    estimatedDrain = estimateLayoutDrain(layout);
    if (estimatedDrain <= MAX_SAFE_LEVEL_DRAIN) break;
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

// --- Generate and write ---
mkdirSync(OUT_DIR, { recursive: true });

const profiles = buildLevelProfiles();
for (const profile of profiles) {
  const path = join(OUT_DIR, `level${profile.level}.json`);
  writeFileSync(path, JSON.stringify(profile, null, 2));
}

console.log(`Generated ${profiles.length} level files in assets/levels/`);
