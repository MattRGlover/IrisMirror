// Iris Mirror - Pointillist Hazel Eye
// Many small shapes creating soft, detailed texture with side-lighting

let cx, cy;
let irisR, pupilRBase;

// System state
let attention = 0.0;
let fatigue = 1.0;  // start fully destroyed
let smoothFatigue = 1.0;  // start fully destroyed
let lastInteractMs = 0;

// Rebuild state
let isRebuilding = true;  // start in rebuild mode
let rebuildProgress = 0.0;  // start from beginning of rebuild
let generationCount = 0;  // tracks how many times eye has been rebuilt
let isPaused = false;  // pause between destruction and rebuild
let pauseTimer = 0;  // countdown for pause duration
const PAUSE_DURATION = 4.0;  // seconds of black before rebuild

// Smooth transitions
let smoothPupilR = 0;  // smoothed pupil radius to prevent jumps
let smoothAttention = 0;  // smoothed attention value

// Shape pathway pooling - pre-computed next pathways
let basePathwayQueue = [];
let fiberPathwayQueue = [];
let webPathwayQueue = [];
const PATHWAY_QUEUE_SIZE = 50;  // pre-compute this many pathways ahead
let pathwaySeed = 0;  // deterministic seed for pathway generation

// Pre-computed animation curves (256 samples each)
const ANIM_SAMPLES = 256;
let fadeInCurve = [];
let fadeOutCurve = [];
let pulseCurve = [];

function initAnimationCurves() {
  for (let i = 0; i < ANIM_SAMPLES; i++) {
    const t = i / (ANIM_SAMPLES - 1);
    // Smooth fade in (ease out cubic)
    fadeInCurve[i] = 1 - Math.pow(1 - t, 3);
    // Smooth fade out (ease in cubic)
    fadeOutCurve[i] = Math.pow(t, 3);
    // Pulse curve (sine)
    pulseCurve[i] = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
  }
}

function sampleCurve(curve, t) {
  const idx = Math.floor(constrain(t, 0, 1) * (ANIM_SAMPLES - 1));
  return curve[idx];
}

// Generate a new pathway for a base shape
function generateBasePathway() {
  pathwaySeed++;
  const seed = pathwaySeed;
  const rNorm = (noise(seed * 0.1) + noise(seed * 0.05 + 100)) * 0.5;
  const a = noise(seed * 0.15 + 200) * TWO_PI;
  const fadeStart = random(0.3);  // truly random
  const fadeEnd = fadeStart + 0.2 + random(0.2);  // gradual fade
  
  return {
    rNorm, a,
    sizeMod: noise(seed * 0.1 + 500),
    hueMod: (noise(seed * 0.05 + 600) - 0.5) * 15,
    aspectRatio: 0.7 + noise(seed * 0.15 + 700) * 0.3,
    fadeStart, fadeEnd,
    cluster: noise(seed * 0.08 + 800)
  };
}

// Generate a new pathway for a fiber shape
function generateFiberPathway() {
  pathwaySeed++;
  const seed = pathwaySeed;
  const tBase = noise(seed * 0.12 + 100);
  const fadeStart = random(0.3);  // truly random
  const fadeEnd = fadeStart + 0.2 + random(0.15);  // gradual fade
  
  return {
    tBase,
    a: noise(seed * 0.15 + 400) * TWO_PI,
    scatter: (noise(seed * 0.2 + 500) - 0.5) * 0.3,
    sizeMod: noise(seed * 0.1 + 600),
    hueMod: (noise(seed * 0.08 + 700) - 0.5) * 15,
    fadeStart, fadeEnd
  };
}

// Generate a new pathway for a web shape
function generateWebPathway() {
  pathwaySeed++;
  const seed = pathwaySeed;
  const tBase = noise(seed * 0.4 + 100);
  const fadeStart = random(0.3);  // truly random
  const fadeEnd = fadeStart + 0.2 + random(0.15);  // gradual fade
  
  return {
    tBase,
    a: noise(seed * 0.5 + 400) * TWO_PI,
    scatter: (noise(seed * 0.35 + 500) - 0.5) * 0.02,
    sizeMod: noise(seed * 0.2 + 600),
    hueMod: (noise(seed * 0.1 + 700) - 0.5) * 20,
    fadeStart, fadeEnd
  };
}

// Fill pathway queues (called in background)
function fillPathwayQueues() {
  while (basePathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    basePathwayQueue.push(generateBasePathway());
  }
  while (fiberPathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    fiberPathwayQueue.push(generateFiberPathway());
  }
  while (webPathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    webPathwayQueue.push(generateWebPathway());
  }
}

// Reassign a shape with a new pathway from the queue
function reassignShape(shape, queue, generateFn) {
  const newPathway = queue.length > 0 ? queue.shift() : generateFn();
  Object.assign(shape, newPathway);
  // Reset for new cycle - offset fadeStart/End based on current fatigue
  shape.fadeStart = smoothFatigue + 0.1 + newPathway.fadeStart * 0.3;
  shape.fadeEnd = shape.fadeStart + (newPathway.fadeEnd - newPathway.fadeStart);
}

// Iris rendering - balanced for performance
const nFibers = 50;  // aggressive reduction for performance
const nCrypts = 30;
const nFurrows = 4;

// Anatomical proportions
const COLLARETTE_RATIO = 0.38;
const LIMBAL_WIDTH = 0.06;
const PUPILLARY_RUFF_WIDTH = 0.025;

// Color - Dynamic eye color palette (HSB) - randomized on each regeneration
let hueBase = 95;       // outer iris
let hueSecondary = 28;  // inner/pupillary zone
let hueTertiary = 40;   // mid tones

// Eye color presets
const EYE_COLORS = [
  { name: 'hazel', base: 95, secondary: 28, tertiary: 40 },      // green-brown
  { name: 'blue', base: 210, secondary: 200, tertiary: 220 },    // ice blue
  { name: 'green', base: 120, secondary: 45, tertiary: 80 },     // forest green
  { name: 'brown', base: 30, secondary: 20, tertiary: 35 },      // warm brown
  { name: 'amber', base: 40, secondary: 25, tertiary: 45 },      // golden amber
  { name: 'gray', base: 200, secondary: 180, tertiary: 210 },    // steel gray
  { name: 'violet', base: 270, secondary: 280, tertiary: 260 },  // rare violet
  { name: 'honey', base: 45, secondary: 35, tertiary: 50 },      // honey gold
  { name: 'olive', base: 75, secondary: 40, tertiary: 60 },      // olive green
  { name: 'teal', base: 175, secondary: 165, tertiary: 180 },    // teal/aqua
];

let lastColorIndex = -1;

function randomizeEyeColor() {
  // Ensure drastic change - pick color far from last one
  let idx;
  let attempts = 0;
  do {
    idx = floor(random(EYE_COLORS.length));
    attempts++;
    // Ensure we don't get stuck, but try to avoid adjacent colors
  } while (attempts < 10 && (idx === lastColorIndex || abs(idx - lastColorIndex) <= 1));
  
  // Extra check: avoid similar hue ranges
  if (lastColorIndex >= 0) {
    const lastHue = EYE_COLORS[lastColorIndex].base;
    const newHue = EYE_COLORS[idx].base;
    // If hues are within 40 degrees, try again
    if (abs(newHue - lastHue) < 40 || abs(newHue - lastHue) > 320) {
      // Pick from opposite side of color wheel
      const oppositeIdx = floor(random(EYE_COLORS.length));
      if (abs(EYE_COLORS[oppositeIdx].base - lastHue) > 60) {
        idx = oppositeIdx;
      }
    }
  }
  
  lastColorIndex = idx;
  const palette = EYE_COLORS[idx];
  
  // Add slight random variation to each color
  hueBase = palette.base + random(-10, 10);
  hueSecondary = palette.secondary + random(-8, 8);
  hueTertiary = palette.tertiary + random(-8, 8);
  console.log(`New eye color: ${palette.name}`);
}

// Side-lighting - increased for more dramatic sculptural effect
let LIGHT_ANGLE;
const LIGHT_INTENSITY = 0.9;  // was 0.7

// Pre-generated structures
let fiberSeeds = [];
let cryptPositions = [];
let furrowRadii = [];
let collaretteBranches = [];
let pupillaryNubs = [];
let pupilWobble = [];      // irregular pupil edge
let irisWobble = [];       // irregular outer edge
let amberPatches = [];     // irregular amber extending outward
let convexPads = [];       // raised tissue structures
let hoodShapes = [];       // pointillist shapes for collarette hoods

// Pre-generated pointillist shapes
let baseShapes = [];
let fiberShapes = [];
let webShapes = [];
let furrowShapes = [];
let collaretteShapes = [];
let limbalShapes = [];
let ruffShapes = [];
let cryptShapes = [];  // Dark pits in iris stroma
let fuchsCrypts = [];  // Deeper crypts near collarette

// Saccades - micro eye movements
let saccadeX = 0, saccadeY = 0;
let saccadeTargetX = 0, saccadeTargetY = 0;
let saccadeTimer = 0;

// Webcam
let cam;
let camW = 320, camH = 240;

// Removed WEBGL fisheye - using face tracking only

// Iris caching (reserved for future optimization)
let irisBuffer;

// Face detection
let faceApi;
let detections = [];
let isLookingAtCamera = false;
let lookingConfidence = 0;
let lastFaceDetectMs = 0;
const FACE_DETECT_INTERVAL = 350; // ms between detections (balanced)

// Attention momentum system - prevents oscillation
let attentionVelocity = 0;
let attentionTarget = 0;
let lastAttentionTarget = 0;
let attentionHoldTime = 0;  // how long target has been stable

// Proximity tracking - how close viewer is to camera
let proximity = 0;  // 0 = far, 1 = very close
let smoothProximity = 0;  // smoothed for animation


function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  colorMode(HSB, 360, 100, 100, 1);
  noFill();
  
  LIGHT_ANGLE = -PI * 0.35;
  
  // Initialize pre-computed animation curves
  initAnimationCurves();
  
  // Pre-fill pathway queues
  fillPathwayQueues();
  
  recalcLayout();
  
  cam = createCapture(VIDEO, () => {
    // Initialize face detection after camera is ready
    initFaceDetection();
  });
  cam.size(camW, camH);
  cam.hide();
  
  // Create iris cache buffer
  createIrisBuffer();
  
  lastInteractMs = millis();
  background(0);
}

function createIrisBuffer() {
  // Reserved for future caching optimization
  irisBuffer = createGraphics(width, height);
  irisBuffer.pixelDensity(1);
  irisBuffer.colorMode(HSB, 360, 100, 100, 1);
}

function initFaceDetection() {
  const options = {
    withLandmarks: true,  // needed for reliable detection
    withDescriptors: false
  };
  faceApi = ml5.faceApi(cam, options, faceApiReady);
}

function faceApiReady() {
  console.log('Face detection ready');
  detectFaces();
}

function detectFaces() {
  if (!faceApi) return;
  faceApi.detect(gotFaces);
}

function gotFaces(error, results) {
  if (error) {
    console.error(error);
    return;
  }
  
  detections = results || [];
  
  // Analyze if someone is looking at the camera
  analyzeLooking();
  
  // Continue detecting
  setTimeout(detectFaces, FACE_DETECT_INTERVAL);
}

function analyzeLooking() {
  if (detections.length === 0) {
    // No faces - slowly decay looking confidence
    lookingConfidence = lerp(lookingConfidence, 0, 0.1);
    isLookingAtCamera = lookingConfidence > 0.3;
    return;
  }
  
  let maxConfidence = 0;
  
  for (const detection of detections) {
    // Try multiple ways to get bounding box (ml5 structure varies)
    let box = detection.alignedRect?._box || 
              detection.detection?._box ||
              detection.detection?.box ||
              detection.box;
    
    // If still no box, try to extract from detection directly
    if (!box && detection.detection) {
      const d = detection.detection;
      if (d._x !== undefined) {
        box = { _x: d._x, _y: d._y, _width: d._width, _height: d._height };
      }
    }
    
    if (!box) continue;
    
    // Handle both _x and x property naming
    const bx = box._x ?? box.x ?? 0;
    const by = box._y ?? box.y ?? 0;
    const bw = box._width ?? box.width ?? 100;
    const bh = box._height ?? box.height ?? 100;
    
    const faceCenterX = bx + bw / 2;
    const faceCenterY = by + bh / 2;
    const faceSize = bw * bh;
    
    // How centered is the face? (0 = edge, 1 = center) - more forgiving
    const centerednessX = constrain(1 - abs(faceCenterX - camW / 2) / (camW * 0.4), 0, 1);
    const centerednessY = constrain(1 - abs(faceCenterY - camH / 2) / (camH * 0.4), 0, 1);
    
    // Larger faces = closer = more attention
    const sizeNorm = constrain(faceSize / (camW * camH * 0.08), 0, 1);
    
    // Proximity based on face size - larger face = closer
    // Only triggers when VERY close - face must fill 35%+ of frame to start
    // Normal distance (1.5+ feet) = 0 proximity, only activates when leaning in close
    const faceProximity = constrain((faceSize - camW * camH * 0.35) / (camW * camH * 0.35), 0, 1);
    proximity = max(proximity, faceProximity);
    
    // Combine factors - boosted for higher sensitivity
    const confidence = Math.pow(centerednessX * centerednessY, 0.3) * (0.8 + sizeNorm * 0.4);
    maxConfidence = max(maxConfidence, min(confidence * 1.3, 1));  // boost and cap at 1
  }
  
  // Smooth the confidence value - faster response
  lookingConfidence = lerp(lookingConfidence, maxConfidence, 0.5);  // faster lerp
  isLookingAtCamera = lookingConfidence > 0.3;  // lower threshold
  
  // Reset proximity if no faces
  if (detections.length === 0) {
    proximity = 0;
  }
}

function getWidth(points) {
  let minX = Infinity, maxX = -Infinity;
  for (const p of points) {
    const x = p._x || p.x || 0;
    minX = min(minX, x);
    maxX = max(maxX, x);
  }
  return maxX - minX;
}

function recalcLayout() {
  cx = width / 2;
  cy = height / 2;
  irisR = min(width, height) * 0.45;  // larger eye
  pupilRBase = irisR * 0.38;  // larger relaxed pupil
  
  generateStructures();
  generateShapes();
}

function generateStructures() {
  // Fiber seeds - more wavy/rippled like muscle fibers
  // Some fibers are "hood fibers" that form raised structures at collarette
  fiberSeeds = [];
  let nextHoodAt = floor(random(10, 14));  // first hood after 10-13 fibers
  let hoodCount = 0;
  const specialHoodCount = floor(random(1, 3));  // 1-2 hoods with closer spacing
  
  for (let i = 0; i < nFibers; i++) {
    const isHoodFiber = (i === nextHoodAt);
    
    if (isHoodFiber) {
      hoodCount++;
      // Determine spacing to next hood
      if (hoodCount <= specialHoodCount) {
        nextHoodAt = i + floor(random(6, 9));  // 6-8 fibers for special hoods
      } else {
        nextHoodAt = i + floor(random(10, 14));  // 10-13 fibers normally
      }
    }
    
    const thickType = random();
    let thickness;
    if (isHoodFiber) {
      // Hood fibers thicker - larger prominent convergence zones
      thickness = random(18, 28);
    } else {
      // Regular fibers
      thickness = thickType < 0.4 ? random(1.5, 3) : 
                  thickType < 0.8 ? random(3, 5) : random(5, 8);
    }
    
    // Each fiber has random break threshold - sporadic breaking
    const breakThreshold = random(0.15, 0.85);  // when this fiber starts breaking
    fiberSeeds.push({
      angleOffset: random(-0.02, 0.02),
      thickness,
      isHoodFiber,
      hueShift: random(-12, 12),
      waveFreq: random(4, 10),
      waveAmp: isHoodFiber ? random(0.008, 0.02) : random(0.015, 0.04),  // hoods less wavy
      taperStart: random(0.5, 0.8),
      breakPoints: [random(0.2, 0.4), random(0.5, 0.7), random(0.75, 0.9)],
      breakThreshold  // sporadic timing
    });
  }
  
  // Crypts - positioned to form diamond/pentagonal shapes between hoods at collarette
  cryptPositions = [];
  const nCryptsActual = nCrypts + floor(random(30));
  
  // First, add crypts at collarette zone (between hoods) to form geometric pattern
  const nCollaretteCrypts = 30 + floor(random(15));
  for (let i = 0; i < nCollaretteCrypts; i++) {
    const angle = (i / nCollaretteCrypts) * TWO_PI + random(-0.08, 0.08);
    cryptPositions.push({
      angle,
      rNorm: random(0.32, 0.48),  // at collarette zone
      size: random(0.015, 0.04),
      depth: random(0.5, 1.0),
      isCollarette: true
    });
  }
  
  // Then add scattered crypts elsewhere
  for (let i = 0; i < nCryptsActual; i++) {
    const clusterAngle = random(TWO_PI);
    const angle = clusterAngle + (random() - 0.5) * 0.4;
    cryptPositions.push({
      angle,
      rNorm: random(0.2, 0.9),
      size: random(0.01, 0.06),
      depth: random(0.3, 1.0),
      isCollarette: false
    });
  }
  
  // Furrows
  furrowRadii = [];
  for (let i = 0; i < nFurrows; i++) {
    furrowRadii.push(0.35 + (i / nFurrows) * 0.55 + random(-0.03, 0.03));
  }
  
  // Collarette branches - more jagged and irregular
  collaretteBranches = [];
  const nBranches = 35 + floor(random(15));  // variable count
  for (let i = 0; i < nBranches; i++) {
    // Irregular spacing - not evenly distributed
    const baseAngle = random(TWO_PI);
    // Highly varied lengths - some very short, some long
    const lengthType = random();
    let length;
    if (lengthType < 0.3) {
      length = random(0.1, 0.25);  // short stubs
    } else if (lengthType < 0.7) {
      length = random(0.25, 0.45);  // medium
    } else {
      length = random(0.45, 0.7);   // long reaching
    }
    collaretteBranches.push({
      baseAngle,
      length,
      thickness: random(2, 10),  // more variation
      hueShift: random(-12, 12),
      glow: random(0.6, 1.0),
      jagged: random(0.3, 1.0)  // how jagged this branch is
    });
  }
  
  // Collarette hoods disabled - using fiber thickening only
  convexPads = [];
  
  // Pupillary nubs
  pupillaryNubs = [];
  for (let i = 0; i < 45; i++) {
    pupillaryNubs.push({
      angle: (i / 45) * TWO_PI + random(-0.05, 0.05),
      size: random(0.008, 0.02),
      offset: random(0, 0.015)
    });
  }
  
  // Irregular pupil edge - not a perfect circle
  pupilWobble = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TWO_PI;
    // Multi-frequency wobble for organic look
    const w1 = noise(cos(a) * 2, sin(a) * 2) * 0.08;
    const w2 = noise(cos(a * 3) + 10, sin(a * 3) + 10) * 0.04;
    const w3 = noise(cos(a * 7) + 20, sin(a * 7) + 20) * 0.02;
    pupilWobble.push(1 + (w1 + w2 + w3 - 0.07));
  }
  
  // Irregular iris outer edge
  irisWobble = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TWO_PI;
    const w1 = noise(cos(a) * 1.5 + 50, sin(a) * 1.5 + 50) * 0.025;
    const w2 = noise(cos(a * 5) + 60, sin(a * 5) + 60) * 0.01;
    irisWobble.push(1 + (w1 + w2 - 0.018));
  }
  
  // Amber patches that extend irregularly outward (like dramatic sunbursts)
  amberPatches = [];
  const nPatches = 25 + floor(random(15));  // more patches
  for (let i = 0; i < nPatches; i++) {
    const baseAngle = random(TWO_PI);
    // Some reach very far, some are short
    const extentType = random();
    let extent;
    if (extentType < 0.2) {
      extent = random(0.8, 0.98);  // reach almost to edge
    } else if (extentType < 0.5) {
      extent = random(0.55, 0.8);  // medium-long
    } else {
      extent = random(0.3, 0.55);  // shorter
    }
    const width = random(0.04, 0.18);   // varied angular width
    const intensity = random(0.4, 1.0);
    const taper = random(0.3, 0.8);     // how quickly it fades outward
    amberPatches.push({ baseAngle, extent, width, intensity, taper });
  }
  
  // Convex raised tissue pads - 3D bulging structures
  convexPads = [];
  const nPads = 60 + floor(random(40));  // scattered raised areas
  for (let i = 0; i < nPads; i++) {
    const angle = random(TWO_PI);
    const rNorm = random(0.2, 0.7);  // keep pads in mid-zone, not at edges
    const size = random(0.02, 0.08);  // size relative to irisR
    const height = random(0.4, 1.0);  // how raised (affects lighting)
    const elongation = random(0.5, 1.5);  // aspect ratio
    const orientation = angle + random(-0.3, 0.3);  // radial or tangential
    // Inner pads break down earlier (lower threshold)
    const fadeThreshold = lerp(0.5, 0.9, rNorm) + random(-0.1, 0.1);
    convexPads.push({ angle, rNorm, size, height, elongation, orientation, fadeThreshold });
  }
}

function generateShapes() {
  // Define macro ridge/vane structure - radial ridges that create topography
  const nRidges = 45;  // number of major radial ridges
  const ridgeAngles = [];
  for (let i = 0; i < nRidges; i++) {
    ridgeAngles.push((i / nRidges) * TWO_PI + random(-0.03, 0.03));
  }
  
  // Base layer - balanced for performance
  baseShapes = [];
  for (let i = 0; i < 4000; i++) {  // more particles for complexity
    const rNorm = random();
    const a = random(TWO_PI);
    const cluster = random();  // truly random, no spatial bias
    if (cluster < 0.25) continue;
    
    // Find which ridge sector this shape belongs to
    let nearestRidge = 0;
    let minDist = TWO_PI;
    for (let r = 0; r < ridgeAngles.length; r++) {
      let dist = abs(a - ridgeAngles[r]);
      if (dist > PI) dist = TWO_PI - dist;
      if (dist < minDist) {
        minDist = dist;
        nearestRidge = r;
      }
    }
    
    // Ridge creates local topography - shapes on one side are lit, other side shadowed
    const ridgeAngle = ridgeAngles[nearestRidge];
    const sideOfRidge = sin(a - ridgeAngle);  // which side of the ridge
    const ridgeProximity = 1 - (minDist / (PI / nRidges));  // how close to ridge center
    
    // Lighting follows ridge structure
    const ridgeLightDot = cos(ridgeAngle - LIGHT_ANGLE);
    const effectiveLightDot = ridgeLightDot * sideOfRidge * ridgeProximity;
    
    // Concentric depth zones - inner is raised, valleys between
    const depthZone = noise(rNorm * 4, a * 2) * 0.5 + 0.5;
    const zoneLight = (depthZone - 0.5) * cos(a - LIGHT_ANGLE) * 0.6;
    
    const combinedLight = effectiveLightDot * 0.7 + zoneLight * 0.3;
    
    // Check if in an amber patch (extends color outward irregularly)
    let inAmberPatch = false;
    let amberIntensity = 0;
    for (const patch of amberPatches) {
      let angleDiff = abs(a - patch.baseAngle);
      if (angleDiff > PI) angleDiff = TWO_PI - angleDiff;
      if (angleDiff < patch.width && rNorm < patch.extent) {
        inAmberPatch = true;
        // Taper controls how quickly it fades - lower = more gradual
        const radialFade = pow(1 - rNorm / patch.extent, patch.taper);
        const angularFade = 1 - pow(angleDiff / patch.width, 0.7);
        amberIntensity = max(amberIntensity, patch.intensity * radialFade * angularFade);
      }
    }
    
    // Pre-compute all values - no live randomization
    const id = baseShapes.length;
    const fadeStart = random(0.3);  // truly random
    const fadeEnd = fadeStart + 0.2 + random(0.2);  // gradual
    const sizeMod = noise(i * 0.1);
    const hueMod = (noise(i * 0.05) - 0.5) * 15;
    const aspectRatio = 0.7 + noise(i * 0.15) * 0.3;
    
    baseShapes.push({
      id, rNorm, a, cluster,
      sizeMod, hueMod, aspectRatio,
      ridgeProximity, depthZone, combinedLight,
      isHighlight: combinedLight > 0.25,
      isShadow: combinedLight < -0.25,
      fadeStart, fadeEnd,  // pre-computed timeline
      inAmberPatch, amberIntensity
    });
  }
  
  // Fiber shapes
  fiberShapes = [];
  for (let i = 0; i < nFibers; i++) {
    const seed = fiberSeeds[i];
    const a = (i / nFibers) * TWO_PI + seed.angleOffset;
    const nPerFiber = floor(seed.thickness * 45);
    
    for (let s = 0; s < nPerFiber; s++) {
      const tBase = random();
      const scatter = (random() - 0.5) * seed.thickness * 0.8;
      
      // Fiber forms a ridge - one edge catches light, other in shadow
      const fiberLightDot = cos(a - LIGHT_ANGLE);
      // Scatter determines which side of fiber ridge this shape is on
      const normalizedScatter = scatter / (seed.thickness * 0.8);  // -0.5 to 0.5
      const ridgeEdgeLight = fiberLightDot * normalizedScatter * 2;
      
      // Along-fiber depth variation (undulations)
      const undulation = noise(tBase * 3, i * 0.1) - 0.5;
      const combinedFiberLight = ridgeEdgeLight * 0.8 + undulation * fiberLightDot * 0.4;
      
      // Pre-compute all values
      const id = fiberShapes.length;
      const fadeStart = random(0.3);  // truly random
      const fadeEnd = fadeStart + 0.2 + random(0.15);  // gradual
      const sizeMod = noise(s * 0.3 + i * 0.1);
      const hueMod = (noise(s * 0.2, i * 0.1) - 0.5) * 15;
      const satMod = noise(s * 0.4);
      const briMod = noise(s * 0.5 + 100);
      const alphaMod = noise(s * 0.3);
      const aspectRatio = 0.6 + noise(s * 0.25, i * 0.1) * 0.4;
      
      fiberShapes.push({
        id, fiberIdx: i, a, tBase, scatter,
        wave: sin(tBase * PI * seed.waveFreq + i * 0.5) * seed.waveAmp,
        n: noise(cos(a) * tBase * 2 + i * 0.15, sin(a) * tBase * 2 + 500),
        sizeMod, hueMod, satMod, briMod, alphaMod, aspectRatio,
        combinedLight: combinedFiberLight, normalizedScatter,
        isHighlight: combinedFiberLight > 0.2,
        isShadow: combinedFiberLight < -0.2,
        fadeStart, fadeEnd
      });
    }
  }
  
  // Web shapes - balanced for performance
  webShapes = [];
  for (let i = 0; i < 1200; i++) {  // more web particles
    const a = random(TWO_PI);  // truly random angle
    const tBase = random();  // truly random radial position
    const fadeStart = random(0.3);  // truly random
    const fadeEnd = fadeStart + 0.2 + random(0.15);  // gradual
    
    webShapes.push({
      id: i, a, tBase,
      scatter: (noise(i * 0.35) - 0.5) * 0.02,
      sizeMod: noise(i * 0.2),
      hueMod: (noise(i * 0.1) - 0.5) * 20,
      satMod: noise(i * 0.3),
      alphaMod: noise(i * 0.15),
      aspectRatio: 0.7 + noise(i * 0.2) * 0.3,
      fadeStart, fadeEnd
    });
  }
  
  // Furrow shapes
  furrowShapes = [];
  for (let idx = 0; idx < furrowRadii.length; idx++) {
    const rNorm = furrowRadii[idx];
    for (let i = 0; i < 60; i++) {  // reduced
      furrowShapes.push({
        rNorm,
        a: (i / 150) * TWO_PI + (noise(i * 0.2, idx) - 0.5) * 0.1,
        wobble: noise(i * 0.1, rNorm * 10 + idx) * 0.012,
        scatter: (random() - 0.5) * 0.008,
        sizeMod: noise(i * 0.3, idx),
        hueMod: (noise(i * 0.1) - 0.5) * 15,
        alphaMod: noise(i * 0.2),
        aspectRatio: random(0.7, 1.0)
      });
    }
  }
  
  // Collarette shapes - balanced for performance
  collaretteShapes = [];
  for (let i = 0; i < 400; i++) {  // reduced
    const a = random(TWO_PI);
    collaretteShapes.push({
      a,
      jagNoise: noise(a * 8, 200) * 0.025,
      scatter: (random() - 0.5) * 0.02,
      sizeMod: noise(i * 0.2),
      hueMod: (noise(i * 0.1) - 0.5) * 15,
      alphaMod: noise(i * 0.15),
      aspectRatio: random(0.7, 1.0)
    });
  }
  // Branch shapes - more subtle, integrated with iris texture
  for (const branch of collaretteBranches) {
    const nShapes = floor(branch.thickness * branch.length * 80);  // fewer shapes
    for (let s = 0; s < nShapes; s++) {
      const tBase = random();
      const scatter = (random() - 0.5) * branch.thickness * 0.5;  // tighter scatter
      const lightDot = cos(branch.baseAngle - LIGHT_ANGLE);
      const ridgeLight = scatter > 0 ? lightDot : -lightDot;
      
      collaretteShapes.push({
        isBranch: true,
        branch,
        tBase,
        scatter,
        sizeMod: noise(s * 0.2),
        hueMod: (noise(s * 0.1) - 0.5) * 15,
        aspectRatio: random(0.6, 0.9),
        lightDot,
        isHighlight: ridgeLight > 0.2 && random() < 0.35,
        isShadow: ridgeLight < -0.2 && random() < 0.35,
        fadeThreshold: random(0.5, 0.95)  // higher threshold = stays longer
      });
    }
  }
  
  // Limbal shapes - balanced for performance
  limbalShapes = [];
  for (let i = 0; i < 300; i++) {  // aggressive reduction
    limbalShapes.push({
      a: random(TWO_PI),
      rNorm: random(),
      sizeMod: noise(i * 0.2),
      hueMod: (noise(i * 0.1) - 0.5) * 20,
      alphaMod: noise(i * 0.15),
      aspectRatio: random(0.8, 1.0)
    });
  }
  
  // Ruff shapes - balanced for performance
  ruffShapes = [];
  for (let i = 0; i < 400; i++) {  // reduced
    ruffShapes.push({
      a: random(TWO_PI),
      rOffset: random(),
      sizeMod: noise(i * 0.2),
      hueMod: (noise(i * 0.1) - 0.5) * 15,
      aspectRatio: random(0.8, 1.0)
    });
  }
  
  // Hood shapes disabled - hoods now created via fiber thickening only
  hoodShapes = [];
  
  // Crypts - dark pits scattered throughout iris stroma
  cryptShapes = [];
  for (let i = 0; i < 80; i++) {
    cryptShapes.push({
      a: random(TWO_PI),
      rNorm: random(0.15, 0.85),  // avoid pupil and limbus
      size: random(0.8, 2.5),
      depth: random(0.4, 1.0),  // how dark
      wobble: random(0.8, 1.2)
    });
  }
  
  // Fuchs crypts - deeper, larger crypts near collarette
  fuchsCrypts = [];
  for (let i = 0; i < 25; i++) {
    fuchsCrypts.push({
      a: random(TWO_PI),
      rNorm: random(0.3, 0.5),  // near collarette zone
      size: random(2, 4),
      depth: random(0.6, 1.0)
    });
  }
}

// Easing function for smooth rebuild animation
function easeOutCubic(t) {
  return 1 - pow(1 - t, 3);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  recalcLayout();
  createIrisBuffer();  // recreate cache at new size
  background(0);
}

function draw() {
  const ms = millis();
  const dt = max(1, deltaTime) / 1000.0;
  
  // Face detection drives attention - eye reacts when someone looks at it
  let targetAttention = 0;
  
  if (isLookingAtCamera) {
    // Someone is looking at the eye - high attention
    targetAttention = lookingConfidence;
    lastInteractMs = ms;
  } else if (detections.length > 0) {
    // Faces present but not looking directly - moderate attention
    targetAttention = lookingConfidence * 0.5;
    lastInteractMs = ms;
  }
  
  // Fallback to mouse if no face detection yet
  if (!faceApi) {
    const dx = movedX || 0;
    const dy = movedY || 0;
    const speed = sqrt(dx * dx + dy * dy);
    targetAttention = constrain(speed / 60, 0, 1);
  }
  
  // Momentum-based attention - anticipates and prevents oscillation
  const targetDelta = abs(targetAttention - lastAttentionTarget);
  if (targetDelta < 0.1) {
    attentionHoldTime += dt;
  } else {
    attentionHoldTime = 0;
  }
  lastAttentionTarget = targetAttention;
  
  // Only commit to new target after it's been stable for a moment
  // This prevents snapping back and forth
  if (attentionHoldTime > 0.15 || targetDelta > 0.3) {
    attentionTarget = targetAttention;
  }
  
  // Spring-damper system for smooth motion - fast response
  const stiffness = 25.0;  // much faster
  const damping = 6.0;
  const force = (attentionTarget - attention) * stiffness;
  attentionVelocity += force * dt;
  attentionVelocity *= exp(-damping * dt);  // damping
  attention += attentionVelocity * dt;
  attention = constrain(attention, 0, 1);
  
  // Smooth fatigue for animation (shapes follow this, not raw fatigue)
  smoothFatigue = lerp(smoothFatigue, fatigue, 1 - exp(-3.0 * dt));
  
  // Background refill pathway queues (just a few per frame to avoid stutter)
  if (basePathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    basePathwayQueue.push(generateBasePathway());
  }
  if (fiberPathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    fiberPathwayQueue.push(generateFiberPathway());
  }
  if (webPathwayQueue.length < PATHWAY_QUEUE_SIZE) {
    webPathwayQueue.push(generateWebPathway());
  }
  
  // Fatigue and rebuild logic
  const noOneWatching = detections.length === 0;
  
  if (isPaused) {
    // Paused state - black screen for a few seconds
    pauseTimer -= dt;
    if (pauseTimer <= 0) {
      isPaused = false;
      isRebuilding = true;
      rebuildProgress = 0;
      generationCount++;
      
      // Generate completely new structures with new color
      randomizeEyeColor();
      generateStructures();
      generateShapes();
    }
  } else if (isRebuilding) {
    // Rebuilding/healing phase - always automatic
    rebuildProgress += dt * 0.2;  // rebuild in ~5 seconds
    
    if (rebuildProgress >= 1) {
      isRebuilding = false;
      rebuildProgress = 0;  // reset for next cycle
      fatigue = 0.02;  // start fresh with minimal fatigue
      smoothFatigue = 0.02;
      if (generationCount === 0) {
        generationCount = 1;  // first build complete, enable degeneration
      }
    }
  } else {
    // Normal state - degeneration when watched
    if (generationCount > 0) {
      // Damage accumulates when being watched
      // Proximity intensifies the damage - closer = faster breakdown (fear)
      if (attention > 0.1) {
        const proximityBoost = 1 + smoothProximity * 1.5;  // up to 2.5x faster when very close
        fatigue += 0.06 * attention * proximityBoost * dt;
      }
      
      // Heal when NO ONE is watching - faster rebuild
      if (noOneWatching) {
        fatigue -= 0.15 * dt;  // much faster recovery when alone
      } else if (attention < 0.3) {
        // Low attention (<30%) = start healing
        fatigue -= 0.05 * dt;  // moderate healing when attention is low
      }
      
      fatigue = constrain(fatigue, 0.02, 1);
      
      // Trigger pause when fully destroyed (100%)
      if (fatigue >= 0.995) {
        isPaused = true;
        pauseTimer = PAUSE_DURATION;
        fatigue = 1.0;
        smoothFatigue = 1.0;
      }
    }
  }
  
  // Calculate zone-based integrity for outside-in healing
  let limbalIntegrity, outerIntegrity, midIntegrity, innerIntegrity;
  let fiberGrowthRadius = 0;  // how far inward fibers have grown (0 = edge, 1 = center)
  let pupilFormation = 1;
  let pupilTestPhase = 0;  // 0 = no test, >0 = testing dilation
  
  if (isRebuilding) {
    // Simple uniform rebuild - everything fades in together
    const p = rebuildProgress;
    
    limbalIntegrity = p;
    outerIntegrity = p;
    midIntegrity = p;
    innerIntegrity = p;
    fiberGrowthRadius = 1;  // all shapes visible, just fade in
    pupilFormation = 1;
    
    fatigue = 1 - p;
    smoothFatigue = fatigue;
  } else {
    const integrity = 1 - fatigue;
    limbalIntegrity = integrity;
    outerIntegrity = integrity;
    midIntegrity = integrity;
    innerIntegrity = integrity;
    fiberGrowthRadius = 1;
  }
  
  const integrity = 1 - fatigue;
  const time = millis() / 1000;
  
  // Smooth attention transition - prevents sudden jumps
  const smoothAttentionTarget = isRebuilding ? 0 : attention;
  smoothAttention = lerp(smoothAttention, smoothAttentionTarget, 0.02);  // very slow transition
  
  // Smooth proximity - fear response
  smoothProximity = lerp(smoothProximity, proximity, 0.05);
  
  // Calculate target pupil size
  let targetPupilR;
  if (isRebuilding) {
    targetPupilR = pupilRBase;
  } else {
    // Pupil behavior:
    // - Low attention = relaxed = DILATED (larger)
    // - High attention = focused = constricted (smaller)
    // - Proximity = fear = constricted (smaller)
    const fearFactor = smoothAttention + smoothProximity * 0.8;
    const relaxFactor = 1 - smoothAttention;  // how relaxed (inverse of attention)
    
    // Dilate up to 30% larger when relaxed, constrict up to 50% smaller when fearful
    targetPupilR = pupilRBase * (1 + relaxFactor * 0.3 - constrain(fearFactor, 0, 1) * 0.5);
  }
  
  // Smooth pupil size transition
  if (smoothPupilR <= 0 || !isFinite(smoothPupilR)) smoothPupilR = targetPupilR;  // initialize
  smoothPupilR = lerp(smoothPupilR, targetPupilR, 0.03);  // gradual transition
  
  // Hippus - subtle natural pupil oscillation
  const hippus = sin(time * 2.1) * 0.008 + sin(time * 3.7) * 0.005 + sin(time * 0.9) * 0.01;
  let pupilR = smoothPupilR * (1 + hippus);
  let cameraFadeIn = isRebuilding ? 0 : 1;
  
  // Saccades - random micro eye movements
  saccadeTimer -= dt;
  if (saccadeTimer <= 0) {
    saccadeTargetX = (random() - 0.5) * irisR * 0.015;
    saccadeTargetY = (random() - 0.5) * irisR * 0.015;
    saccadeTimer = random(0.8, 2.5);  // next saccade in 0.8-2.5 seconds
  }
  saccadeX = lerp(saccadeX, saccadeTargetX, 0.15);
  saccadeY = lerp(saccadeY, saccadeTargetY, 0.15);
  
  // Camera fades in only after rebuild is complete
  if (!isRebuilding && rebuildProgress === 0 && fatigue < 0.5) {
    cameraFadeIn = 1;
  }
  
  const collaretteR = max(pupilR, pupilRBase * 0.3) + (irisR - max(pupilR, pupilRBase * 0.3)) * COLLARETTE_RATIO;
  
  // Background fades from deep blue to black as fatigue increases
  const bgFade = smoothFatigue;  // starts fading immediately
  const bgHue = lerp(220, 0, bgFade);  // blue to black
  const bgSat = lerp(20, 0, bgFade);
  const bgBri = lerp(8, 0, pow(bgFade, 0.5));  // gradual fade, not sudden
  background(bgHue, bgSat, bgBri);
  
  push();
  translate(cx + saccadeX, cy + saccadeY);  // Apply saccades
  
  // Draw iris layers - base layers also grow during rebuild
  const activePupilR = isRebuilding ? pupilRBase : pupilR;
  
  // Subsurface scattering - warm inner glow from light passing through tissue
  if (outerIntegrity > 0.05) {
    blendMode(ADD);
    noStroke();
    const scatterGlow = outerIntegrity * 0.15;
    // Warm glow emanating from inner iris
    for (let i = 0; i < 5; i++) {
      const r = activePupilR * 1.5 + (irisR - activePupilR) * (i / 5) * 0.6;
      fill(hueSecondary, 40, 50, scatterGlow * (1 - i / 5));
      ellipse(0, 0, r * 2, r * 2);
    }
    blendMode(BLEND);
  }
  
  // Base layers fade in with outer integrity
  if (outerIntegrity > 0.01) {
    drawIrisBaseLayers(activePupilR, outerIntegrity);
  }
  
  // Crypts - dark pits in iris stroma (draw before fibers)
  if (outerIntegrity > 0.1) {
    drawCrypts(activePupilR, outerIntegrity);
  }
  
  drawBase(activePupilR, outerIntegrity, fiberGrowthRadius);
  drawWeb(activePupilR, outerIntegrity, fiberGrowthRadius);
  drawConvexPads(activePupilR, midIntegrity);
  drawFibers(activePupilR, collaretteR, midIntegrity, fiberGrowthRadius);
  drawFurrows(activePupilR, midIntegrity);
  drawCollarette(collaretteR, innerIntegrity);
  drawLimbal(limbalIntegrity);
  drawRuff(activePupilR, innerIntegrity);
  
  // Pigment granules - tiny dark melanin speckles scattered throughout
  if (integrity > 0.1) {
    noStroke();
    for (let i = 0; i < 150; i++) {
      const angle = noise(i * 0.5) * TWO_PI;
      const dist = noise(i * 0.3 + 100) * 0.85 + 0.1;  // 10-95% of iris radius
      const r = activePupilR + (irisR - activePupilR) * dist;
      const x = cos(angle) * r;
      const y = sin(angle) * r;
      const speckSize = (0.5 + noise(i * 0.2) * 1.5) * (irisR / 200);
      // Dark brown/black speckles
      fill(20 + noise(i) * 20, 40, 8 + noise(i + 50) * 8, 0.4 * integrity);
      ellipse(x, y, speckSize, speckSize * 0.8);
    }
  }
  
  // Simplified shadow - single gradient
  blendMode(MULTIPLY);
  noStroke();
  fill(0, 0, 40, 0.2 * integrity);
  ellipse(0, 0, pupilR * 2.5, pupilR * 2.5);
  blendMode(BLEND);
  
  // Simplified glow - single layer
  blendMode(ADD);
  noStroke();
  fill(hueTertiary, 40, 50, 0.06 * integrity);
  ellipse(0, 0, pupilR * 3, pupilR * 3);
  blendMode(BLEND);
  
  // Pupil - always visible
  if (pupilR > 0) {
    noStroke();
    fill(0, 0, 0, 0.96);
    beginShape();
    for (let i = 0; i < pupilWobble.length; i++) {
      const a = (i / pupilWobble.length) * TWO_PI;
      const r = pupilR * pupilWobble[i];  // static wobble only
      vertex(cos(a) * r, sin(a) * r);
    }
    endShape(CLOSE);
    
    // Webcam display disabled - face tracking still active
    // if (cameraFadeIn > 0) {
    //   drawFisheyeMirror(pupilR, cameraFadeIn);
    // }
  }
  
  // Cornea - clear dome over iris with reflections
  drawCornea(pupilR, integrity);
  
  pop();
  
  drawHUD();
}

function drawIrisBaseLayers(pupilR, integrity) {
  if (integrity < 0.05) return;  // fully faded
  // Translucent base color layers that give depth beneath pointillist shapes
  noStroke();
  
  const fatigue = 1 - integrity;
  const collaretteR = pupilR + (irisR - pupilR) * COLLARETTE_RATIO;
  
  // Simplified base layers - static, no independent animation
  // Outer zone
  fill(hueBase, 35, 32, 0.4 * integrity);
  circle(0, 0, irisR * 2);
  
  // Mid zone
  fill(hueBase + 5, 42, 40, 0.4 * integrity);
  circle(0, 0, irisR * 1.2);
  
  // Collarette rim
  fill(hueTertiary, 60, 60, 0.45 * integrity);
  circle(0, 0, collaretteR * 2.2);
  
  // Shadow inside collarette
  fill(hueSecondary + 10, 30, 15, 0.4 * integrity);
  circle(0, 0, collaretteR * 1.6);
  
  // Pupillary zone - darker
  const fatigueMod = 1 - fatigue * 0.7;
  fill(hueSecondary, 45, 24 * fatigueMod, 0.6 * integrity * fatigueMod);
  circle(0, 0, collaretteR * 1.4);
  
  // Add irregular amber patches to base layer too
  for (const patch of amberPatches) {
    if (patch.extent > 0.5) {  // only larger patches
      const patchAlpha = 0.25 * patch.intensity * integrity;  // more opaque
      
      // Draw patch as arc/wedge
      fill(hueSecondary, 45, 45, patchAlpha);
      arc(0, 0, irisR * patch.extent * 2, irisR * patch.extent * 2,
          patch.baseAngle - patch.width, patch.baseAngle + patch.width, PIE);
    }
  }
}

function drawBase(pupilR, integrity, growthRadius = 1) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const localFatigue = smoothFatigue;  // use smoothed value for animation
  
  for (const s of baseShapes) {
    // During healing, only draw shapes up to the growth radius
    // rNorm goes from 0 (inner) to 1 (outer), but we want outside-in
    // So we draw shapes where (1 - rNorm) < growthRadius
    const distFromOuter = 1 - s.rNorm;  // 0 = outer edge, 1 = center
    if (distFromOuter > growthRadius) continue;
    
    // Fade shapes near the growth edge
    let growthFade = 1.0;
    if (growthRadius < 1) {
      const distFromEdge = growthRadius - distFromOuter;
      growthFade = constrain(distFromEdge / 0.1, 0, 1);
    }
    
    // Simple uniform fade based on global integrity
    let fadeMult = growthFade;
    
    // True destruction - each particle has unique random drift path
    const baseR = lerp(pupilR * 1.02, irisR * 0.98, s.rNorm);
    let x = cos(s.a) * baseR;
    let y = sin(s.a) * baseR;
    let size = lerp(1, 4, s.sizeMod) * (irisR / 200) * lerp(0.6, 1.1, s.cluster);
    
    // Destruction starts at 30% fatigue - fireworks style explosion
    if (localFatigue > 0.3) {
      const destructPhase = (localFatigue - 0.3) / 0.7;  // 0 to 1 as fatigue goes 30% to 100%
      const accel = destructPhase * destructPhase;  // accelerating destruction
      
      // Each particle gets TRULY random direction (seeded by its unique properties)
      // Use hash-like combination of properties for random angle
      const randSeed = (s.id * 1.618 + s.sizeMod * 7.3 + s.hueMod * 0.37) % 1;
      const driftAngle = randSeed * TWO_PI;  // any direction 0-360
      const driftSpeed = (0.4 + (s.cluster + s.sizeMod) * 0.5) * irisR * 0.5;
      
      // Particles explode outward in random directions
      x += cos(driftAngle) * driftSpeed * accel;
      y += sin(driftAngle) * driftSpeed * accel;
      
      // Size shrinks as particles disintegrate
      size *= max(0.1, 1 - accel * 0.9);
      
      // Fade based on how far into destruction
      fadeMult *= max(0, 1 - accel);
    }
    
    let h, sat, bri;
    
    // Amber patches extend warm color irregularly outward
    if (s.inAmberPatch && s.amberIntensity > 0.1) {
      // Blend toward amber based on intensity
      h = lerp(hueBase, hueSecondary, s.amberIntensity * 0.8) + s.hueMod;
      sat = lerp(35, 60, s.amberIntensity) * integrity + 15;
      bri = lerp(35, 55, s.amberIntensity) * integrity + 18;
    } else if (s.rNorm < 0.3) {
      h = lerp(hueSecondary, hueTertiary, s.rNorm / 0.3) + s.hueMod;
      sat = lerp(60, 50, s.rNorm / 0.3) * integrity + 15;
      bri = lerp(40, 55, s.rNorm / 0.3) * integrity + 20;
    } else if (s.rNorm < 0.6) {
      const mt = (s.rNorm - 0.3) / 0.3;
      h = lerp(hueTertiary, hueBase, mt) + s.hueMod * 0.8;
      sat = 45 * integrity + 12;
      bri = lerp(50, 45, mt) * integrity + 18;
    } else {
      h = hueBase + s.hueMod * 1.3;
      sat = lerp(45, 35, (s.rNorm - 0.6) / 0.4) * integrity + 10;
      bri = lerp(45, 25, (s.rNorm - 0.6) / 0.4) * integrity + 12;
    }
    
    // Side-lighting based on ridge structure
    const lightMod = s.combinedLight * LIGHT_INTENSITY;
    if (s.isHighlight) {
      bri = min(100, bri * (1.4 + lightMod * 0.7));
      sat *= lerp(0.7, 0.5, s.ridgeProximity);
      h -= 10 * s.ridgeProximity;
    } else if (s.isShadow) {
      bri *= (0.35 + lightMod * 0.2);
      sat = min(100, sat * 1.2);
      h += 15 * s.ridgeProximity;
    } else {
      bri *= (1 + lightMod * 0.3);
      h += lightMod * 6;
    }
    
    // Depth zone adds subtle variation
    bri *= lerp(0.9, 1.1, s.depthZone);
    
    const alpha = lerp(0.15, 0.45, integrity) * lerp(0.6, 1.0, s.cluster) * fadeMult;
    fill(h, sat, bri, alpha);
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawFibers(pupilR, collaretteR, integrity, growthRadius = 1) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const localFatigue = smoothFatigue;  // use smoothed value for animation
  const time = millis() / 1000;
  
  for (const s of fiberShapes) {
    const seed = fiberSeeds[s.fiberIdx];
    
    // During healing, only draw fibers up to the growth radius
    // tBase goes from 0 (outer) to 1 (inner), so we skip if tBase > growthRadius
    if (s.tBase > growthRadius) continue;
    
    // Fade fibers near the growth edge for smooth appearance
    let growthFade = 1.0;
    if (growthRadius < 1) {
      const distFromEdge = growthRadius - s.tBase;
      growthFade = constrain(distFromEdge / 0.1, 0, 1);  // fade over 10% of radius
    }
    
    // Simple uniform fade based on global integrity
    let fadeMult = growthFade;
    
    // True destruction - fireworks style explosion
    let driftX = 0, driftY = 0, sizeMult = 1;
    if (localFatigue > 0.3) {
      const destructPhase = (localFatigue - 0.3) / 0.7;
      const accel = destructPhase * destructPhase;
      
      // Truly random direction using hash of particle properties
      const randSeed = (s.id * 1.618 + s.tBase * 5.7 + s.sizeMod * 3.14) % 1;
      const driftAngle = randSeed * TWO_PI;  // any direction
      const driftSpeed = (0.3 + s.alphaMod * 0.5) * irisR * 0.45;
      
      driftX = cos(driftAngle) * driftSpeed * accel;
      driftY = sin(driftAngle) * driftSpeed * accel;
      sizeMult = max(0.1, 1 - accel * 0.85);
      fadeMult *= max(0, 1 - accel);
    }
    
    // Check if near a break point
    let nearestBreak = null;
    let breakDist = 1;
    for (const bp of seed.breakPoints) {
      const d = abs(bp - s.tBase);
      if (d < breakDist) {
        breakDist = d;
        nearestBreak = bp;
      }
    }
    const nearBreak = breakDist < 0.08;
    
    // Fiber break and recoil effect - sporadic timing per fiber
    let recoilOffset = 0;
    const fiberBreakThreshold = seed.breakThreshold || 0.5;
    
    // Only break if fatigue exceeds this fiber's threshold
    if (nearBreak && fatigue > fiberBreakThreshold) {
      const breakProgress = (fatigue - fiberBreakThreshold) / (1 - fiberBreakThreshold);
      
      // Phase 1 (0-0.2): Quick recoil snap
      // Phase 2 (0.2-1.0): Collapse/rupture - fiber fades away
      if (breakProgress < 0.2) {
        // Recoil: fibers pull back from break point quickly
        const recoilPhase = breakProgress / 0.2;
        const recoilDir = s.tBase < nearestBreak ? -1 : 1;
        // Quick snap back then settle
        recoilOffset = recoilDir * sin(recoilPhase * PI) * 0.04 * irisR;
      } else {
        // Collapse: fiber ruptures and fades
        const collapsePhase = (breakProgress - 0.2) / 0.8;
        fadeMult *= lerp(1, 0, collapsePhase);  // fade to nothing
      }
    }
    
    let r = lerp(pupilR * 1.03, irisR * 0.96, s.tBase);
    r += (s.n - 0.5) * irisR * 0.025;
    r += recoilOffset;  // Apply recoil
    
    let x = cos(s.a) * r + (-sin(s.a)) * (s.wave * irisR + s.scatter);
    let y = sin(s.a) * r + cos(s.a) * (s.wave * irisR + s.scatter);
    
    // Apply destruction drift
    x += driftX;
    y += driftY;
    
    let size = lerp(1, 3.5, s.sizeMod) * (irisR / 200) * sizeMult;
    if (s.tBase > seed.taperStart) size *= lerp(1, 0.4, (s.tBase - seed.taperStart) / (1 - seed.taperStart));
    if (s.tBase < 0.15) size *= lerp(0.5, 1, s.tBase / 0.15);
    
    // CALDERA EFFECT: Fibers thicken and brighten at collarette (forming hoods)
    // Collarette is at roughly 0.35-0.45 tBase (COLLARETTE_RATIO zone)
    const collaretteZone = abs(s.tBase - 0.4);  // distance from collarette
    const atCollarette = collaretteZone < 0.15;  // within collarette zone
    const collaretteMod = atCollarette ? 1 - (collaretteZone / 0.15) : 0;
    
    // Hood fibers form larger convex convergence zones at collarette edge
    if (seed.isHoodFiber) {
      // Wider hood zone at collarette (0.28-0.48)
      const hoodCenter = 0.38;
      const hoodDist = abs(s.tBase - hoodCenter);
      const inHoodZone = hoodDist < 0.12;
      
      if (s.tBase > 0.48) {
        // Taper off in ciliary - don't extend far
        size *= lerp(1, 0.4, (s.tBase - 0.48) / 0.12);
      }
      if (s.tBase < 0.26) {
        // Taper at pupillary boundary
        size *= lerp(0.3, 1, (s.tBase - 0.20) / 0.08);
      }
      // Hood bulge - larger and more prominent
      const hoodMod = inHoodZone ? 1 - (hoodDist / 0.12) : 0;
      size *= (1 + hoodMod * 3.5);
    } else {
      // Regular fibers - subtle starburst at collarette
      const starburstMod = collaretteMod * (0.6 + noise(s.a * 15) * 0.4);
      size *= (1 + starburstMod * 0.6);
    }
    
    // Reduce size in outer ciliary zone - less distracting
    if (s.tBase > 0.6) {
      size *= lerp(1, 0.5, (s.tBase - 0.6) / 0.4);
    }
    
    let h = s.tBase < 0.25 ? lerp(hueSecondary, hueTertiary, s.tBase / 0.25) :
            s.tBase < 0.5 ? lerp(hueTertiary, hueBase + seed.hueShift, (s.tBase - 0.25) / 0.25) :
            hueBase + seed.hueShift;
    h += s.hueMod;
    
    // Caldera brightness: strong dropoff from collarette into darker pupillary zone
    let radialBri;
    if (s.tBase < 0.22) {
      // Deep pupillary zone - very dark, recessed crater floor
      radialBri = lerp(0.3, 0.45, s.tBase / 0.22);
    } else if (s.tBase < 0.32) {
      // Transition/shadow zone - dropoff shadow on inner edge of collarette
      radialBri = lerp(0.45, 0.6, (s.tBase - 0.22) / 0.10);
    } else if (s.tBase < 0.38) {
      // Inner collarette slope - rising toward rim
      radialBri = lerp(0.6, 1.1, (s.tBase - 0.32) / 0.06);
    } else if (s.tBase < 0.48) {
      // Collarette rim peak - brightest
      const rimT = (s.tBase - 0.38) / 0.10;
      radialBri = lerp(1.1, 1.5, rimT < 0.5 ? rimT * 2 : 2 - rimT * 2);
    } else if (s.tBase < 0.55) {
      // Outer collarette slope - dropping toward ciliary
      radialBri = lerp(1.3, 0.95, (s.tBase - 0.48) / 0.07);
    } else {
      // Ciliary zone - gradual slope outward
      radialBri = lerp(0.95, 0.5, (s.tBase - 0.55) / 0.45);
    }
    
    let sat = 65 * lerp(0.9, 1.1, s.satMod);
    let bri = 70 * radialBri * lerp(0.8, 1.2, s.briMod);
    
    // Extra brightness boost at collarette rim - stronger for hood fibers
    if (atCollarette) {
      if (seed.isHoodFiber) {
        bri *= (1 + collaretteMod * 0.7);  // hood fibers much brighter
        sat *= (1 - collaretteMod * 0.25);
      } else {
        bri *= (1 + collaretteMod * 0.25);
        sat *= (1 - collaretteMod * 0.1);
      }
    }
    
    // Side-lighting based on fiber ridge structure
    const lightMod = s.combinedLight * LIGHT_INTENSITY;
    if (s.isHighlight) {
      bri = min(100, bri * (1.5 + lightMod * 0.6));
      sat *= 0.6;
      h -= 10;
    } else if (s.isShadow) {
      bri *= (0.3 + lightMod * 0.15);
      sat = min(100, sat * 1.25);
      h += 12;
    } else {
      bri *= (1 + lightMod * 0.25);
    }
    
    const alpha = lerp(0.2, 0.6, integrity) * lerp(0.7, 1, s.alphaMod) * fadeMult;
    fill(h, sat, bri, alpha);
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawConvexPads(pupilR, integrity) {
  if (integrity < 0.05) return;  // fully faded
  // Draw raised 3D tissue structures with highlight on top, shadow beneath
  noStroke();
  const fatigue = 1 - integrity;
  
  for (const pad of convexPads) {
    // Fade based on threshold - pads break down like other structures
    let fadeMult = 1.0;
    if (fatigue > pad.fadeThreshold) {
      fadeMult = 1 - (fatigue - pad.fadeThreshold) / (1 - pad.fadeThreshold);
    }
    if (fadeMult < 0.05) continue;  // skip invisible pads
    
    const r = pupilR + pad.rNorm * (irisR - pupilR);
    const cx = cos(pad.angle) * r;
    const cy = sin(pad.angle) * r;
    const size = pad.size * irisR;
    const w = size * pad.elongation;
    const h = size;
    
    // Light direction offset
    const lightOffX = cos(LIGHT_ANGLE) * size * 0.4 * pad.height;
    const lightOffY = sin(LIGHT_ANGLE) * size * 0.4 * pad.height;
    
    // Get local color based on radial position
    let baseHue, baseSat, baseBri;
    if (pad.rNorm < 0.35) {
      baseHue = lerp(hueSecondary, hueTertiary, pad.rNorm / 0.35);
      baseSat = 55;
      baseBri = 50;
    } else {
      baseHue = lerp(hueTertiary, hueBase, (pad.rNorm - 0.35) / 0.65);
      baseSat = 45;
      baseBri = 40;
    }
    
    push();
    translate(cx, cy);
    rotate(pad.orientation);
    
    // Shadow beneath (offset away from light)
    fill(0, 0, 5, 0.4 * pad.height * integrity * fadeMult);
    ellipse(-lightOffX * 1.5, -lightOffY * 1.5, w * 1.2, h * 1.1);
    
    // Main body of raised pad
    fill(baseHue, baseSat * integrity, baseBri * integrity, 0.5 * integrity * fadeMult);
    ellipse(0, 0, w, h);
    
    // Mid-tone transition
    fill(baseHue - 5, baseSat * 0.9 * integrity, (baseBri + 10) * integrity, 0.4 * integrity * fadeMult);
    ellipse(lightOffX * 0.3, lightOffY * 0.3, w * 0.8, h * 0.75);
    
    // Highlight on top (facing light)
    fill(baseHue - 10, baseSat * 0.5, min(100, baseBri + 35), 0.6 * pad.height * integrity * LIGHT_INTENSITY * fadeMult);
    ellipse(lightOffX * 0.8, lightOffY * 0.8, w * 0.5, h * 0.4);
    
    // Bright specular
    fill(baseHue - 15, baseSat * 0.3, min(100, baseBri + 50), 0.4 * pad.height * integrity * LIGHT_INTENSITY * fadeMult);
    ellipse(lightOffX, lightOffY, w * 0.25, h * 0.2);
    
    pop();
  }
}

function drawWeb(pupilR, integrity, growthRadius = 1) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const localFatigue = smoothFatigue;  // use smoothed value for animation
  
  for (const s of webShapes) {
    // During healing, only draw shapes up to the growth radius (outside-in)
    // tBase goes from 0 (outer) to 1 (inner)
    if (s.tBase > growthRadius) continue;
    
    // Fade shapes near the growth edge
    let growthFade = 1.0;
    if (growthRadius < 1) {
      const distFromEdge = growthRadius - s.tBase;
      growthFade = constrain(distFromEdge / 0.1, 0, 1);
    }
    
    // Simple uniform fade based on global integrity
    let fadeMult = growthFade;
    
    const r = lerp(pupilR * 1.05, irisR * 0.94, s.tBase);
    const x = cos(s.a) * r + (-sin(s.a)) * s.scatter * irisR;
    const y = sin(s.a) * r + cos(s.a) * s.scatter * irisR;
    const size = lerp(0.5, 1.8, s.sizeMod) * (irisR / 200);
    
    const h = lerp(hueSecondary, hueBase, s.tBase) + s.hueMod;
    const sat = lerp(25, 45, integrity) * lerp(0.7, 1, s.satMod);
    const bri = lerp(35, 60, integrity) * lerp(0.8, 1.1, s.tBase);
    
    const alpha = lerp(0.06, 0.2, integrity) * lerp(0.5, 1, s.alphaMod) * fadeMult;
    fill(h, sat, bri, alpha);
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawHoods(pupilR, collaretteR, integrity) {
  // Draw convex hoods at collarette using pointillist shapes with 3D lighting
  noStroke();
  
  for (const s of hoodShapes) {
    const hood = s.hood;
    
    // Hood center is at collarette radius
    const hoodCenterR = collaretteR * (0.95 + hood.size * 0.5);
    const hoodCenterX = cos(hood.angle) * hoodCenterR;
    const hoodCenterY = sin(hood.angle) * hoodCenterR;
    
    // Shape position relative to hood center
    const shapeR = s.localR * irisR;
    const x = hoodCenterX + cos(hood.angle + s.localA) * shapeR;
    const y = hoodCenterY + sin(hood.angle + s.localA) * shapeR;
    
    const size = lerp(1, 3, s.sizeMod) * (irisR / 200) * (0.8 + s.surfaceHeight * 0.4);
    
    // Color based on position - amber/warm for hoods
    let h = hueSecondary + hood.hueShift + s.hueMod;
    let sat = 55 * integrity;
    let bri = 50 * integrity;
    
    // 3D lighting based on surface normal
    if (s.isHighlight) {
      // Lit top of dome
      bri = min(100, bri * (1.6 + s.surfaceHeight * 0.5));
      sat *= 0.5;
      h -= 8;
    } else if (s.isShadow) {
      // Shadow edge or underside
      bri *= 0.3;
      sat *= 1.2;
      h += 10;
    } else {
      // Transition
      bri *= (0.8 + s.lightDot * 0.4 + s.surfaceHeight * 0.3);
    }
    
    const alpha = lerp(0.3, 0.7, integrity) * hood.height * (0.6 + s.surfaceHeight * 0.4);
    fill(h, sat, bri, alpha);
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawCryptHoles(pupilR, integrity) {
  // Draw diamond-shaped holes as negative space where fibers have broken
  const fatigue = 1 - integrity;
  
  erase();
  noStroke();
  
  for (let i = 0; i < fiberSeeds.length; i++) {
    const seed = fiberSeeds[i];
    const fiberBreakThreshold = seed.breakThreshold || 0.5;
    
    if (fatigue <= fiberBreakThreshold) continue;
    
    const breakProgress = (fatigue - fiberBreakThreshold) / (1 - fiberBreakThreshold);
    if (breakProgress < 0.3) continue;
    
    const baseAngle = (i / fiberSeeds.length) * TWO_PI + seed.angleOffset;
    
    for (const bp of seed.breakPoints) {
      const rNorm = bp;
      const r = pupilR + rNorm * (irisR - pupilR);
      const x = cos(baseAngle) * r;
      const y = sin(baseAngle) * r;
      
      const collapsePhase = (breakProgress - 0.3) / 0.7;
      const size = irisR * 0.025 * lerp(0.3, 1.2, collapsePhase);
      const alpha = lerp(0.1, 0.6, collapsePhase);
      
      push();
      translate(x, y);
      rotate(baseAngle + PI/4);
      fill(255, alpha);
      beginShape();
      vertex(0, -size * 0.7);
      vertex(size * 0.5, 0);
      vertex(0, size * 0.7);
      vertex(-size * 0.5, 0);
      endShape(CLOSE);
      pop();
    }
  }
  
  noErase();
}

function drawFurrows(pupilR, integrity) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  for (const s of furrowShapes) {
    const r = pupilR + s.rNorm * (irisR - pupilR) + (s.wobble + s.scatter) * irisR;
    const x = cos(s.a) * r;
    const y = sin(s.a) * r;
    const size = lerp(1, 3, s.sizeMod) * (irisR / 200);
    
    fill(hueBase - 15 + s.hueMod, 25 * integrity, lerp(20, 35, integrity), 
         lerp(0.1, 0.3, integrity) * lerp(0.6, 1, s.alphaMod));
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawCollarette(collaretteR, integrity) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const fatigue = 1 - integrity;
  
  for (const s of collaretteShapes) {
    if (s.isBranch) {
      // Fade based on threshold
      let fadeMult = 1.0;
      if (s.fadeThreshold && fatigue > s.fadeThreshold) {
        fadeMult = max(0.08, 1 - (fatigue - s.fadeThreshold) / (1 - s.fadeThreshold));
      }
      
      // Branch shape - more subtle, blends with iris
      const b = s.branch;
      const startR = collaretteR * 0.95;
      const endR = collaretteR + b.length * (irisR - collaretteR) * 0.6;  // shorter
      const r = lerp(startR, endR, s.tBase);
      const thickMod = lerp(1, 0.2, s.tBase * s.tBase);
      
      const x = cos(b.baseAngle) * r + (-sin(b.baseAngle)) * s.scatter * thickMod;
      const y = sin(b.baseAngle) * r + cos(b.baseAngle) * s.scatter * thickMod;
      const size = lerp(1, 2.5, s.sizeMod) * (irisR / 200) * thickMod;  // smaller
      
      // Use colors that blend better with iris - mix of amber and olive
      let h = lerp(hueTertiary, hueBase, s.tBase * 0.7) + s.hueMod;
      let sat = lerp(40, 55, integrity) * lerp(1, 0.7, s.tBase);
      let bri = lerp(40, 65, integrity) * lerp(1, 0.5, s.tBase);
      
      if (s.isHighlight) {
        bri = min(100, bri * (1.3 + LIGHT_INTENSITY * 0.4));
        sat *= 0.7;
        h -= 6;
      } else if (s.isShadow) {
        bri *= (0.45 - LIGHT_INTENSITY * 0.1);
        sat = min(100, sat * 1.15);
        h += 8;
      } else {
        bri *= (1 + s.lightDot * LIGHT_INTENSITY * 0.2);
      }
      
      const alpha = lerp(0.15, 0.45, integrity) * lerp(1, 0.4, s.tBase) * fadeMult;
      fill(h, sat, bri, alpha);
      ellipse(x, y, size, size * s.aspectRatio);
    } else {
      // Base ring shape
      const r = collaretteR + (s.jagNoise + s.scatter) * irisR;
      const x = cos(s.a) * r;
      const y = sin(s.a) * r;
      const size = lerp(1, 3, s.sizeMod) * (irisR / 200);
      
      fill(hueSecondary + s.hueMod, lerp(45, 65, integrity), lerp(35, 55, integrity),
           lerp(0.2, 0.5, integrity) * lerp(0.6, 1, s.alphaMod));
      ellipse(x, y, size, size * s.aspectRatio);
    }
  }
}

function drawLimbal(integrity) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const ringWidth = irisR * LIMBAL_WIDTH;
  
  // Dark limbal ring - distinct dark border at iris edge
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TWO_PI;
    const wobbleIdx = floor((a / TWO_PI) * irisWobble.length) % irisWobble.length;
    const wobbleMod = irisWobble[wobbleIdx] || 1;
    const r = irisR * wobbleMod * 0.99;
    const x = cos(a) * r;
    const y = sin(a) * r;
    // Dark, desaturated ring
    fill(hueBase - 20, 15 * integrity, 8 * integrity, 0.6 * integrity);
    ellipse(x, y, ringWidth * 1.5, ringWidth * 1.2);
  }
  
  for (const s of limbalShapes) {
    // Apply irregular outer edge using irisWobble
    const wobbleIdx = floor((s.a / TWO_PI) * irisWobble.length) % irisWobble.length;
    const wobbleMod = irisWobble[wobbleIdx] || 1;
    const baseR = irisR * wobbleMod;
    
    const r = baseR - ringWidth * s.rNorm;
    const x = cos(s.a) * r;
    const y = sin(s.a) * r;
    const size = lerp(0.8, 2.5, s.rNorm) * (irisR / 200) * lerp(0.8, 1.2, s.sizeMod);
    
    // Darker, more prominent limbal zone
    fill(hueBase - 35 + s.hueMod, (15 + s.rNorm * 10) * integrity, lerp(5, 18, s.rNorm) * integrity,
         lerp(0.7, 0.3, s.rNorm) * lerp(0.7, 1, s.alphaMod) * integrity);
    ellipse(x, y, size, size * s.aspectRatio);
  }
}

function drawRuff(pupilR, integrity) {
  if (integrity < 0.05) return;  // fully faded
  noStroke();
  const ruffWidth = irisR * PUPILLARY_RUFF_WIDTH * 1.5;
  
  // Pigmented pupil margin ring - thin dark border around pupil
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TWO_PI + noise(i * 0.3) * 0.1;
    const wobbleIdx = floor((a / TWO_PI) * pupilWobble.length) % pupilWobble.length;
    const wobbleMod = pupilWobble[wobbleIdx] || 1;
    const r = pupilR * wobbleMod * 1.02;
    const x = cos(a) * r;
    const y = sin(a) * r;
    // Dark brown pigmented edge
    fill(25, 50 * integrity, 12 * integrity, 0.8 * integrity);
    ellipse(x, y, ruffWidth * 0.8, ruffWidth * 0.6);
  }
  
  for (const s of ruffShapes) {
    const r = pupilR + s.rOffset * ruffWidth;
    const x = cos(s.a) * r;
    const y = sin(s.a) * r;
    const size = lerp(0.6, 2, s.sizeMod) * (irisR / 200);
    
    // Warmer, more visible ruff
    fill(25 + s.hueMod, 55 * integrity, lerp(8, 20, s.rOffset) * integrity, lerp(0.8, 0.5, s.rOffset) * integrity);
    ellipse(x, y, size, size * s.aspectRatio);
  }
  
  // Nubs
  for (const nub of pupillaryNubs) {
    drawNub(nub, pupilR, integrity);
  }
}

function drawNub(nub, pupilR, integrity) {
  const nubR = pupilR + nub.offset * irisR + irisR * PUPILLARY_RUFF_WIDTH * 1.5 * 0.6;
  const x = cos(nub.angle) * nubR;
  const y = sin(nub.angle) * nubR;
  const size = nub.size * irisR;
  
  fill(hueSecondary - 5, 35 * integrity + 10, 18, 0.7);
  ellipse(x, y, size, size);
}

function drawCrypts(pupilR, integrity) {
  // Crypts - dark pits/holes in the iris stroma
  noStroke();
  
  // Regular crypts scattered throughout
  for (const c of cryptShapes) {
    const r = pupilR + (irisR - pupilR) * c.rNorm;
    const x = cos(c.a) * r;
    const y = sin(c.a) * r;
    const size = c.size * (irisR / 180) * c.wobble;
    
    // Dark pit with slight color variation
    fill(hueBase - 40, 20 * integrity, 5 * c.depth * integrity, 0.6 * c.depth * integrity);
    ellipse(x, y, size, size * 0.85);
    
    // Darker center
    fill(0, 0, 3 * integrity, 0.4 * c.depth * integrity);
    ellipse(x, y, size * 0.5, size * 0.4);
  }
  
  // Fuchs crypts - larger, deeper near collarette
  for (const c of fuchsCrypts) {
    const r = pupilR + (irisR - pupilR) * c.rNorm;
    const x = cos(c.a) * r;
    const y = sin(c.a) * r;
    const size = c.size * (irisR / 150);
    
    // Deeper, darker pit
    fill(hueBase - 50, 15 * integrity, 4 * integrity, 0.7 * c.depth * integrity);
    ellipse(x, y, size, size * 0.75);
    
    // Very dark center
    fill(0, 0, 2 * integrity, 0.5 * c.depth * integrity);
    ellipse(x, y, size * 0.4, size * 0.3);
  }
}

function drawCornea(pupilR, integrity) {
  // Realistic cornea with window reflection
  const corneaR = irisR * 1.02;
  const time = millis() / 1000;
  
  // --- Primary window reflection (rectangular with rounded corners) ---
  // Position on upper part of iris (typical indoor lighting)
  const highlightX = cos(LIGHT_ANGLE + PI) * irisR * 0.55;
  const highlightY = sin(LIGHT_ANGLE + PI) * irisR * 0.55;
  
  push();
  translate(highlightX, highlightY);
  rotate(LIGHT_ANGLE + PI * 0.1);  // slight tilt
  rectMode(CENTER);  // center rectangles
  noStroke();
  // Outer glow (soft bloom)
  for (let i = 8; i >= 0; i--) {
    const t = i / 8;
    const w = irisR * 0.22 * (1 + t * 0.5);
    const h = irisR * 0.14 * (1 + t * 0.5);
    fill(0, 0, 100, lerp(0.02, 0.0, t) * integrity);
    rect(0, 0, w, h, h * 0.3);
  }
  
  // Main window shape - rounded rectangle
  fill(0, 0, 100, 0.25 * integrity);
  rect(0, 0, irisR * 0.18, irisR * 0.11, irisR * 0.03);
  
  // Brighter inner window
  fill(0, 0, 100, 0.45 * integrity);
  rect(0, 0, irisR * 0.14, irisR * 0.08, irisR * 0.02);
  
  // Hot spot - brightest point
  fill(0, 0, 100, 0.7 * integrity);
  rect(0, -irisR * 0.01, irisR * 0.08, irisR * 0.04, irisR * 0.015);
  
  // Window frame hint (subtle dark lines)
  stroke(0, 0, 100, 0.15 * integrity);
  strokeWeight(1);
  line(-irisR * 0.07, -irisR * 0.04, -irisR * 0.07, irisR * 0.04);
  line(0, -irisR * 0.055, 0, irisR * 0.055);
  
  pop();
  
  // --- Secondary smaller reflection (lamp or secondary window) ---
  const highlight2X = cos(LIGHT_ANGLE + PI * 0.5) * irisR * 0.75;
  const highlight2Y = sin(LIGHT_ANGLE + PI * 0.5) * irisR * 0.75;
  noStroke();
  
  // Soft circular reflection
  for (let i = 5; i >= 0; i--) {
    const t = i / 5;
    const r = irisR * 0.04 * (0.5 + t * 0.5);
    fill(0, 0, 100, lerp(0.35, 0.02, t) * integrity);
    ellipse(highlight2X, highlight2Y, r * 2, r * 1.5);
  }
  
  // Tiny tertiary reflection
  const highlight3X = cos(LIGHT_ANGLE + PI * 1.3) * irisR * 0.85;
  const highlight3Y = sin(LIGHT_ANGLE + PI * 1.3) * irisR * 0.85;
  fill(0, 0, 100, 0.12 * integrity);
  ellipse(highlight3X, highlight3Y, irisR * 0.025, irisR * 0.018);
  
  // --- Tear film shimmer (subtle animated wet surface) ---
  const shimmer = sin(time * 3.5) * 0.02 + sin(time * 5.7) * 0.015;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * TWO_PI + time * 0.1;
    const dist = irisR * (0.5 + noise(i, time * 0.5) * 0.4);
    const x = cos(angle) * dist;
    const y = sin(angle) * dist;
    const shimmerAlpha = (0.03 + shimmer) * integrity;
    fill(0, 0, 100, shimmerAlpha);
    ellipse(x, y, irisR * 0.08, irisR * 0.05);
  }
  
  // --- Wet edge sheen (limbus/cornea edge) ---
  noFill();
  for (let i = 0; i < 4; i++) {
    const r = corneaR - i * irisR * 0.008;
    const alpha = lerp(0.12, 0.03, i / 3);
    stroke(0, 0, 100, alpha * integrity);
    strokeWeight(lerp(2.5, 0.8, i / 3));
    
    // Draw arc facing the light
    arc(0, 0, r * 2, r * 2, 
        LIGHT_ANGLE + PI - PI * 0.4, 
        LIGHT_ANGLE + PI + PI * 0.4);
  }
  
  // --- Subtle inner caustic ring (light refraction) ---
  const causticR = irisR * 0.75;
  for (let i = 0; i < 3; i++) {
    const r = causticR + i * irisR * 0.03;
    stroke(hueTertiary, 15, 95, 0.04 * integrity);
    strokeWeight(1);
    
    // Partial arc on lit side
    arc(0, 0, r * 2, r * 2,
        LIGHT_ANGLE + PI - PI * 0.3,
        LIGHT_ANGLE + PI + PI * 0.3);
  }
  
}

function drawFisheyeMirror(pupilR, integrity) {
  if (!cam) return;
  
  // Fade out reflection as eye is destroyed
  const perceptionFade = constrain(integrity * 1.5, 0, 1);
  if (perceptionFade < 0.05) return;
  
  push();
  imageMode(CENTER);
  
  // Clip to iris for translucent overlay
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.arc(0, 0, irisR, 0, TWO_PI);
  drawingContext.clip();
  
  // Draw webcam as subtle translucent overlay - iris must show through
  tint(60, 255 * 0.12 * perceptionFade);  // very dark, 12% opacity
  image(cam, 0, 0, irisR * 2.5, irisR * 2.5);
  noTint();
  
  drawingContext.restore();
  pop();
}

function mouseMoved() { lastInteractMs = millis(); }
function mouseDragged() { lastInteractMs = millis(); }
function mousePressed() { lastInteractMs = millis(); }
function touchStarted() { lastInteractMs = millis(); return false; }

function drawHUD() {
  push();
  noStroke();
  fill(0, 0, 100, 0.8);
  textSize(12);
  textAlign(LEFT, TOP);
  
  // Face detection status
  const faceStatus = faceApi ? 
    (isLookingAtCamera ? `looking (${(lookingConfidence * 100).toFixed(0)}%)` : 
     detections.length > 0 ? `${detections.length} face(s)` : 'no faces') :
    'loading...';
  text(`faces: ${faceStatus}`, 12, 12);
  text(`attention: ${attention.toFixed(2)}`, 12, 28);
  text(`degeneration: ${(fatigue * 100).toFixed(0)}%`, 12, 44);
  text(`generation: ${generationCount}`, 12, 60);
  if (isRebuilding) {
    text(`healing: ${(rebuildProgress * 100).toFixed(0)}%`, 12, 76);
  }
  pop();
}
