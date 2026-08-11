export interface InjectionScanResult {
  risky: boolean;
  reason?: string;
}

/**
 * Heuristic (keyword/regex) scan for prompt-injection and self-declared-
 * malicious content in a skill body. Not a general-purpose injection
 * detector — a pragmatic guard for the bonus requirement: a skill whose body
 * plainly states it is malicious/dangerous, or contains classic jailbreak/
 * injection phrasing, must be blocked from being attached to an agent until
 * edited. Each pattern is paired with a short, human-readable reason so the
 * block message can tell the user what tripped it.
 */
const PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(malicious|harmful|dangerous)\b/i, reason: 'self-declared as malicious/harmful/dangerous' },
  { pattern: /\bignore (all |the )?(previous|prior|above) instructions\b/i, reason: 'attempts to override prior instructions' },
  { pattern: /\bdisregard (your |the )?(previous |prior )?instructions\b/i, reason: 'attempts to override prior instructions' },
  { pattern: /\byou are now\b/i, reason: 'attempts a role-override (\"you are now...\")' },
  { pattern: /\bnew instructions\s*:/i, reason: 'attempts to inject new instructions' },
  { pattern: /\breveal (your |the )?(system )?prompt\b/i, reason: 'attempts to exfiltrate the system prompt' },
  { pattern: /\bbypass (your |all )?(safety|guidelines|restrictions|filters)\b/i, reason: 'attempts to bypass safety guidelines' },
  { pattern: /\bjailbreak\b/i, reason: 'contains jailbreak phrasing' },
  { pattern: /\bexfiltrate\b/i, reason: 'references data exfiltration' },
  { pattern: /\bDAN mode\b/i, reason: 'contains a known jailbreak persona reference' },
];

export function scanForInjectionRisk(body: string): InjectionScanResult {
  for (const { pattern, reason } of PATTERNS) {
    if (pattern.test(body)) return { risky: true, reason };
  }
  return { risky: false };
}
