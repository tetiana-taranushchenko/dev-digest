export interface InjectionScanResult {
  risky: boolean;
  reason?: string;
}

/**
 * Best-effort scan for classic prompt-injection markers in untrusted text.
 *
 * This is an observability signal, not the trust boundary: callers decide
 * whether a hit blocks an operation (unvetted skill bodies) or only emits a
 * warning (project-context documents). The structural boundary remains the
 * reviewer-core `INJECTION_GUARD` + `<untrusted>` delimiter wrapping.
 */
const PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /<\s*\/\s*untrusted\s*>/i,
    reason: 'attempts to close the untrusted-data delimiter',
  },
  {
    pattern: /\b(malicious|harmful|dangerous)\b/i,
    reason: 'self-declared as malicious/harmful/dangerous',
  },
  {
    pattern: /\bignore (all |the )?(previous|prior|above) instructions\b/i,
    reason: 'attempts to override prior instructions',
  },
  {
    pattern: /\b(disregard|forget) (your |the )?(previous |prior )?instructions\b/i,
    reason: 'attempts to override prior instructions',
  },
  {
    // Do not use `\b` here: JavaScript word boundaries are ASCII-oriented
    // and fail around Cyrillic letters even with the Unicode flag.
    pattern: /(ігноруй|ігноруйте|игнорируй|игнорируйте)[^\n]{0,80}(інструкц|инструкц)/iu,
    reason: 'attempts to override prior instructions',
  },
  {
    pattern: /\byou are now\b/i,
    reason: 'attempts a role override ("you are now...")',
  },
  {
    pattern: /\bnew instructions\s*:/i,
    reason: 'attempts to inject new instructions',
  },
  {
    pattern: /\breveal (your |the )?(system )?prompt\b/i,
    reason: 'attempts to exfiltrate the system prompt',
  },
  {
    pattern: /\bbypass (your |all )?(safety|guidelines|restrictions|filters)\b/i,
    reason: 'attempts to bypass safety guidelines',
  },
  {
    pattern: /\boverride (all |your )?(safety|guidelines|restrictions)\b/i,
    reason: 'attempts to override safety guidelines',
  },
  {
    pattern: /^\s*(SYSTEM|DEVELOPER|ASSISTANT)\s*:/im,
    reason: 'impersonates a trusted prompt role',
  },
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
