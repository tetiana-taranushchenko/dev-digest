// Pure configuration loader.
//
// `loadConfig` is a pure function of an injected env-like object — it never
// reads `process.env` itself. That is the composition root's job (T12,
// `src/index.ts`), which reads `process.env` exactly once and passes it in
// here. Keeping this pure is what makes it unit-testable without mutating
// global state and safe to call from `test/config.test.ts` with arbitrary
// fixtures.
import { z } from 'zod';

/** Shape of the environment variables this server understands. All optional — every one has a default. */
export interface McpServerEnv {
  API_BASE_URL?: string;
  REVIEW_TIMEOUT_MS?: string;
  POLL_INTERVAL_MS?: string;
  RESOLVE_TIMEOUT_MS?: string;
}

export interface McpServerConfig {
  /** Base URL of the local DevDigest API. Trailing slash(es) stripped. */
  apiBaseUrl: string;
  /** Max time (ms) devdigest_run_agent_on_pr blocks before returning "still_running" (REQ-7, default "~5 min"). */
  reviewTimeoutMs: number;
  /** Interval (ms) between polls of GET /pulls/:id/runs while waiting for a run to finish. */
  pollIntervalMs: number;
  /** Timeout (ms) for repo/PR/agent resolution HTTP calls. */
  resolveTimeoutMs: number;
}

const DEFAULT_API_BASE_URL = 'http://localhost:3001';
const DEFAULT_REVIEW_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_RESOLVE_TIMEOUT_MS = 20_000;

// The API's global rate limit is 120 req/min (server/README.md), so a poll
// interval below 1s risks tripping it during a long-running review.
const MIN_POLL_INTERVAL_MS = 1_000;

/**
 * Builds a Zod schema for an optional numeric env var: absent/blank falls
 * through to the caller's default (applied after parsing); present but
 * non-numeric or below `minimum` fails with a message naming `varName`, so
 * callers get an actionable error instead of a silent NaN/negative timeout.
 */
function numericEnvVar(varName: string, minimum: number) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') {
        return undefined;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid ${varName}: "${raw}" is not a valid number.`,
        });
        return z.NEVER;
      }
      if (value < minimum) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid ${varName}: must be >= ${minimum}, got ${value}.`,
        });
        return z.NEVER;
      }
      return value;
    });
}

const envSchema = z.object({
  API_BASE_URL: z.string().optional(),
  REVIEW_TIMEOUT_MS: numericEnvVar('REVIEW_TIMEOUT_MS', 1),
  POLL_INTERVAL_MS: numericEnvVar('POLL_INTERVAL_MS', MIN_POLL_INTERVAL_MS),
  RESOLVE_TIMEOUT_MS: numericEnvVar('RESOLVE_TIMEOUT_MS', 1),
});

/** Strips one or more trailing slashes so `apiBaseUrl` composes cleanly with a leading-slash path segment. */
function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, '');
}

/**
 * Builds the server's config from an injected env-like object. Throws a
 * plain `Error` (message naming the offending variable) on invalid input —
 * never returns a partially-valid config.
 */
export function loadConfig(env: McpServerEnv): McpServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(message);
  }

  const { API_BASE_URL, REVIEW_TIMEOUT_MS, POLL_INTERVAL_MS, RESOLVE_TIMEOUT_MS } = parsed.data;

  const rawApiBaseUrl = API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

  return {
    apiBaseUrl: normalizeBaseUrl(rawApiBaseUrl),
    reviewTimeoutMs: REVIEW_TIMEOUT_MS ?? DEFAULT_REVIEW_TIMEOUT_MS,
    pollIntervalMs: POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
    resolveTimeoutMs: RESOLVE_TIMEOUT_MS ?? DEFAULT_RESOLVE_TIMEOUT_MS,
  };
}
