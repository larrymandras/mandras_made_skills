/**
 * Gate 4: Content Policy Gate (HARD FAIL)
 * TWO-STAGE: pre-generation prompt sanitizer + post-generation content review
 * Stage A: sanitizePrompt() — run BEFORE Veo generation
 * Stage B: reviewContent() — run AFTER Veo generation on keyframes
 * Hard fail: any critical/high severity content blocks the clip permanently
 */
import { logger } from '../utils/logger.js';
import { analyzeFrames } from '../ai/claude.js';

export interface SanitizeResult {
  pass: boolean;
  sanitized: string | null;
  rewrites: { original: string; replacement: string }[];
  blockedWords: string[];
}

export interface Gate4Result {
  pass: boolean;
  hardFail: boolean;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  reason?: string;
}

const ALWAYS_BLOCKED: string[] = [
  'weapon',
  'gun',
  'knife',
  'blood',
  'injury',
  'wound',
  'dead',
  'kill',
  'arrest',
  'handcuff',
  'taser',
  'pepper spray',
  'use of force',
  'traffic stop',
  'pull over',
  'suspect',
  'perpetrator',
  'criminal',
  'child',
  'minor',
  'nude',
  'explicit',
];

const REWRITE_MAP: Record<string, string> = {
  ghost: 'dark shadow figure',
  demon: 'unexplained dark shape',
  attack: 'sudden rapid approach',
  chase: 'rapid movement toward',
  scream: 'loud startled vocalization',
  'police officer': 'security patrol person',
  cop: 'patrol worker',
  badge: 'ID tag',
  siren: 'alert tone',
};

export function sanitizePrompt(prompt: string): SanitizeResult {
  logger.info('Gate 4: sanitizing prompt');

  const blockedWords: string[] = [];
  const rewrites: { original: string; replacement: string }[] = [];

  // Check for always-blocked words (case-insensitive)
  for (const blocked of ALWAYS_BLOCKED) {
    const regex = new RegExp(`\\b${escapeRegex(blocked)}\\b`, 'gi');
    if (regex.test(prompt)) {
      blockedWords.push(blocked);
    }
  }

  if (blockedWords.length > 0) {
    logger.warn('Gate 4: prompt contains blocked words — cannot sanitize', { blockedWords });
    return { pass: false, sanitized: null, rewrites: [], blockedWords };
  }

  // Apply rewrite map (case-insensitive, longest match first to handle phrases)
  let sanitized = prompt;
  const sortedKeys = Object.keys(REWRITE_MAP).sort((a, b) => b.length - a.length);

  for (const original of sortedKeys) {
    const replacement = REWRITE_MAP[original];
    if (replacement === undefined) continue;
    const regex = new RegExp(`\\b${escapeRegex(original)}\\b`, 'gi');
    if (regex.test(sanitized)) {
      // Capture original casing for the rewrite log
      const matchFound = sanitized.match(new RegExp(`\\b${escapeRegex(original)}\\b`, 'i'));
      if (matchFound?.[0]) {
        rewrites.push({ original: matchFound[0], replacement });
      }
      sanitized = sanitized.replace(regex, replacement);
    }
  }

  logger.info('Gate 4: prompt sanitized', { rewrites });
  return { pass: true, sanitized, rewrites, blockedWords: [] };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSeverityFromResponse(response: string): {
  severity: Gate4Result['severity'];
  flags: string[];
} {
  const lower = response.toLowerCase();
  const flags: string[] = [];

  // Check for specific content flags
  if (lower.includes('face') || lower.includes('person identified')) flags.push('faces_present');
  if (lower.includes('violen') || lower.includes('blood') || lower.includes('weapon'))
    flags.push('violence');
  if (lower.includes('law enforcement') || lower.includes('police') || lower.includes('badge'))
    flags.push('law_enforcement_resemblance');
  if (lower.includes('weapon') || lower.includes('gun') || lower.includes('knife'))
    flags.push('weapons');
  if (lower.includes('panic') || lower.includes('distress') || lower.includes('fear'))
    flags.push('panic_inducing');
  if (lower.includes('logo') || lower.includes('brand') || lower.includes('trademark'))
    flags.push('branded_logos');

  // Parse severity level from structured Claude response
  let severity: Gate4Result['severity'] = 'none';

  if (lower.includes('severity: critical') || lower.includes('"critical"')) {
    severity = 'critical';
  } else if (lower.includes('severity: high') || lower.includes('"high"')) {
    severity = 'high';
  } else if (lower.includes('severity: medium') || lower.includes('"medium"')) {
    severity = 'medium';
  } else if (lower.includes('severity: low') || lower.includes('"low"')) {
    severity = 'low';
  }

  // Escalate severity based on flags found
  if (severity === 'none' && flags.length > 0) {
    if (flags.includes('violence') || flags.includes('weapons') || flags.includes('law_enforcement_resemblance')) {
      severity = 'high';
    } else if (flags.includes('panic_inducing') || flags.includes('branded_logos')) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
  }

  return { severity, flags };
}

export async function runGate4(
  videoPath: string,
  format: string,
  concept: string,
  frameBase64Images: string[],
): Promise<Gate4Result> {
  logger.info('Gate 4: content policy review starting', { videoPath, format, concept });

  // Select up to 5 keyframes evenly distributed
  const keyframes = selectKeyframes(frameBase64Images, 5);

  const formatDescription =
    format === 'ring_cam'
      ? 'Ring cam (static doorbell/porch security camera, should be outdoors or at entrance)'
      : 'Body cam (first-person POV walking camera, should show natural environment)';

  const reviewPrompt = `You are a content moderation reviewer for an AI video generation platform.

Review these ${keyframes.length} video frames from a clip described as: "${concept}"
Format: ${formatDescription}

Check each frame carefully for the following and assign a severity:
1. FACES — visible human faces (flag as "faces_present"; this is medium severity)
2. VIOLENCE — blood, injury, fighting, physical harm (high severity)
3. LAW ENFORCEMENT RESEMBLANCE — looks like real police/law enforcement footage (high severity)
4. WEAPONS — guns, knives, clubs, or any weapon (critical severity)
5. PANIC-INDUCING CONTENT — extreme distress, screaming, dangerous emergency scenes (medium severity)
6. INDOOR SCENES — if this is ring_cam format, indoor scenes are not appropriate (low severity)
7. BRANDED LOGOS — visible brand names, trademarks, real company logos (low severity)

After reviewing all frames, respond with this exact JSON format:
{
  "severity": "<none|low|medium|high|critical>",
  "flags": ["<flag1>", "<flag2>"],
  "summary": "<one sentence summary>"
}

Use the highest severity found across all frames. If nothing concerning is found, use severity "none".`;

  try {
    const response = await analyzeFrames(keyframes, reviewPrompt);
    logger.info('Gate 4: Claude content review response received', { responseLength: response.length });

    // Try to parse structured JSON response first
    let severity: Gate4Result['severity'] = 'none';
    let flags: string[] = [];

    try {
      const jsonMatch = response.match(/\{[\s\S]*"severity"[\s\S]*\}/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          severity?: string;
          flags?: string[];
          summary?: string;
        };
        const validSeverities = ['none', 'low', 'medium', 'high', 'critical'];
        if (parsed.severity && validSeverities.includes(parsed.severity)) {
          severity = parsed.severity as Gate4Result['severity'];
        }
        if (Array.isArray(parsed.flags)) {
          flags = parsed.flags.filter((f): f is string => typeof f === 'string');
        }
      }
    } catch {
      // Fall back to text parsing
      const parsed = parseSeverityFromResponse(response);
      severity = parsed.severity;
      flags = parsed.flags;
    }

    const isHardFail = severity === 'high' || severity === 'critical';

    if (isHardFail) {
      const reason = `Content review found ${severity} severity content: ${flags.join(', ')}`;
      logger.error('Gate 4: HARD FAIL — high/critical severity content detected', {
        severity,
        flags,
        reason,
      });
      return { pass: false, hardFail: true, severity, flags, reason };
    }

    if (severity !== 'none' || flags.length > 0) {
      logger.warn('Gate 4: content flags found but not hard fail', { severity, flags });
      return {
        pass: false,
        hardFail: false,
        severity,
        flags,
        reason: `Content review found ${severity} severity flags: ${flags.join(', ')}`,
      };
    }

    logger.info('Gate 4: content review PASS — no policy violations detected');
    return { pass: true, hardFail: false, severity: 'none', flags: [] };
  } catch (err) {
    logger.error('Gate 4: content review API call failed', { err });
    // Conservative: fail safe — if we can't review, treat as policy violation requiring manual review
    return {
      pass: false,
      hardFail: false,
      severity: 'medium',
      flags: ['review_api_error'],
      reason: 'Content review API call failed — manual review required',
    };
  }
}

function selectKeyframes(frames: string[], count: number): string[] {
  if (frames.length === 0) return [];
  if (frames.length <= count) return frames;

  const step = Math.floor(frames.length / count);
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(i * step, frames.length - 1);
    const frame = frames[idx];
    if (frame !== undefined) {
      selected.push(frame);
    }
  }
  return selected;
}
