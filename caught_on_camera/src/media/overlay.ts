/**
 * UI overlay compositing — burns authentic camera UI onto degraded video.
 *
 * Ring cam overlays mimic consumer doorbell cameras (HomeCam, DoorView, PorchGuard).
 * Body cam overlays mimic law enforcement / action camera HUD elements.
 * All output paths are returned. Callers are responsible for temp-file cleanup.
 */
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

// ── Config types ───────────────────────────────────────────────────────────────

export interface RingCamOverlayConfig {
  /** Location label shown in the overlay (e.g. "Front Door") */
  cameraName: string;
  /** Camera brand — controls which sub-template is selected */
  brand: 'HomeCam' | 'DoorView' | 'PorchGuard';
  /** Timestamp to display — formatted as locale-aware string on the frame */
  timestamp: Date;
  /** Absolute path to the PNG overlay template for this brand */
  templatePath: string;
}

export interface BodyCamOverlayConfig {
  /** Officer / unit identifier displayed in the HUD */
  unitId: string;
  /** Body cam sub-type — used for HUD layout selection */
  subType: string;
  /** Timestamp to display in military format */
  timestamp: Date;
  /** Absolute path to the PNG overlay template */
  templatePath: string;
  /** If true, render a GPS co-ordinate placeholder in the HUD */
  showGps?: boolean;
  /** If true, render a speed readout in the HUD */
  showSpeed?: boolean;
  /** Speed value in mph — only rendered when showSpeed is true */
  speedMph?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function runFfmpeg(args: string, label: string): void {
  logger.debug(`FFmpeg [${label}]`);
  try {
    execSync(`ffmpeg -y ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    throw new Error(`FFmpeg ${label} failed: ${e.stderr ? String(e.stderr) : String(err)}`);
  }
}

/** Format a Date as "MM/DD/YYYY HH:MM:SS" for ring-cam style overlay */
function formatRingTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a Date as "YYYYMMDD HH:MM:SS" military style for body-cam overlay */
function formatMilitaryTimestamp(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mn = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}${mm}${dd} ${hh}:${mn}:${ss}`;
}

/** Escape a string for use inside an FFmpeg drawtext text= expression */
function escapeDrawtext(s: string): string {
  return s.replace(/[\\:'[\]{}]/g, '\\$&');
}

// ── Ring Cam Overlay ───────────────────────────────────────────────────────────

/**
 * Composite a ring-camera HUD onto the video:
 * 1. Overlay the brand template PNG (transparent alpha channel assumed).
 * 2. Draw timestamp string in the top-left corner.
 * 3. Draw camera name beneath the timestamp.
 * 4. Draw a blinking red recording dot indicator via a red filled ellipse.
 */
export async function applyRingCamOverlay(
  inputPath: string,
  outputPath: string,
  config: RingCamOverlayConfig,
): Promise<void> {
  logger.info('Overlay: applying ring_cam HUD', {
    brand: config.brand,
    cameraName: config.cameraName,
    outputPath,
  });

  const ts = escapeDrawtext(formatRingTimestamp(config.timestamp));
  const camName = escapeDrawtext(config.cameraName);

  // TODO: vary font path per OS (macOS vs Linux); use a bundled monospace font
  // TODO: add per-brand colour theme (HomeCam=white, DoorView=amber, PorchGuard=green)
  const fontFile = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

  const drawtextTs =
    `drawtext=fontfile='${fontFile}':text='${ts}':fontsize=18:fontcolor=white:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=12:y=10`;

  const drawtextCam =
    `drawtext=fontfile='${fontFile}':text='${camName}':fontsize=14:fontcolor=white@0.85:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=12:y=34`;

  // Blinking red recording dot — drawbox can't do ellipses; use a small filled rectangle
  // For a genuine circle effect a PNG dot overlay is preferable but keep it simple here
  const recDot =
    `drawbox=x=iw-28:y=10:w=14:h=14:color=red@0.85:t=fill`;

  const recText =
    `drawtext=fontfile='${fontFile}':text='REC':fontsize=12:fontcolor=white:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=iw-50:y=28`;

  // Build filter_complex: overlay template first, then drawtext on top
  const filterComplex =
    `[0:v][1:v]overlay=0:0[base];` +
    `[base]${drawtextTs},${drawtextCam},${recDot},${recText}[out]`;

  runFfmpeg(
    `-i "${inputPath}" -i "${config.templatePath}" ` +
    `-filter_complex "${filterComplex}" ` +
    `-map "[out]" -map 0:a? -c:a copy -c:v libx264 -preset fast -crf 23 "${outputPath}"`,
    'applyRingCamOverlay',
  );
}

// ── Body Cam Overlay ───────────────────────────────────────────────────────────

/**
 * Composite a body-camera HUD onto the video:
 * 1. Overlay the sub-type template PNG.
 * 2. Draw military-format timestamp.
 * 3. Draw unit ID.
 * 4. Draw REC indicator.
 * 5. Optionally draw GPS co-ordinates and speed readout.
 */
export async function applyBodyCamOverlay(
  inputPath: string,
  outputPath: string,
  config: BodyCamOverlayConfig,
): Promise<void> {
  logger.info('Overlay: applying body_cam HUD', {
    subType: config.subType,
    unitId: config.unitId,
    outputPath,
  });

  const ts = escapeDrawtext(formatMilitaryTimestamp(config.timestamp));
  const unit = escapeDrawtext(config.unitId);

  // TODO: bundle a free monospace font in assets/ so this works without system fonts
  const fontFile = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

  const drawtextTs =
    `drawtext=fontfile='${fontFile}':text='${ts}':fontsize=16:fontcolor=white:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=10:y=8`;

  const drawtextUnit =
    `drawtext=fontfile='${fontFile}':text='UNIT\\: ${unit}':fontsize=14:fontcolor=white@0.9:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=10:y=30`;

  const recIndicator =
    `drawtext=fontfile='${fontFile}':text='● REC':fontsize=14:fontcolor=red:` +
    `shadowcolor=black:shadowx=1:shadowy=1:x=iw-80:y=8`;

  // Optional GPS overlay (placeholder co-ordinates for plausible realism)
  const gpsText = config.showGps
    ? `drawtext=fontfile='${fontFile}':text='GPS 38.8977° N 77.0365° W':fontsize=11:fontcolor=white@0.75:` +
      `shadowcolor=black:shadowx=1:shadowy=1:x=10:y=ih-28`
    : null;

  // Optional speed overlay
  const speedText =
    config.showSpeed && config.speedMph !== undefined
      ? `drawtext=fontfile='${fontFile}':text='${Math.round(config.speedMph)} MPH':fontsize=14:fontcolor=white:` +
        `shadowcolor=black:shadowx=1:shadowy=1:x=iw-90:y=ih-28`
      : null;

  // Build filter chain (all drawtext on a single [base] node for efficiency)
  const drawtextChain = [drawtextTs, drawtextUnit, recIndicator, gpsText, speedText]
    .filter(Boolean)
    .join(',');

  const filterComplex =
    `[0:v][1:v]overlay=0:0[base];[base]${drawtextChain}[out]`;

  runFfmpeg(
    `-i "${inputPath}" -i "${config.templatePath}" ` +
    `-filter_complex "${filterComplex}" ` +
    `-map "[out]" -map 0:a? -c:a copy -c:v libx264 -preset fast -crf 23 "${outputPath}"`,
    'applyBodyCamOverlay',
  );
}

// ── Disclosure Watermark ───────────────────────────────────────────────────────

/**
 * Burn an "AI GENERATED" disclosure label into the bottom-right corner.
 * Rendered at fontsize=11, white at 40% opacity, using a monospace font.
 * Required on every published clip for platform compliance.
 */
export async function burnDisclosure(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  logger.info('Overlay: burning AI disclosure watermark', { outputPath });

  // TODO: bundle DejaVuSansMono in assets/ for cross-platform reliability
  const fontFile = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

  const drawtext =
    `drawtext=fontfile='${fontFile}':text='AI GENERATED':fontsize=11:fontcolor=white@0.4:` +
    `shadowcolor=black@0.3:shadowx=1:shadowy=1:x=w-tw-10:y=h-th-10`;

  runFfmpeg(
    `-i "${inputPath}" -vf "${drawtext}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`,
    'burnDisclosure',
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch to the correct overlay function based on format.
 * Returns the output path on success.
 *
 * @param inputPath   Degraded video path (pre-overlay).
 * @param outputPath  Desired path for the overlaid clip.
 * @param format      'ring_cam' or 'body_cam'.
 * @param config      Format-specific overlay config object.
 */
export async function applyOverlay(
  inputPath: string,
  outputPath: string,
  format: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
): Promise<string> {
  if (format === 'ring_cam') {
    await applyRingCamOverlay(inputPath, outputPath, config as RingCamOverlayConfig);
  } else if (format === 'body_cam') {
    await applyBodyCamOverlay(inputPath, outputPath, config as BodyCamOverlayConfig);
  } else {
    throw new Error(`applyOverlay: unknown format "${format}"`);
  }
  return outputPath;
}
