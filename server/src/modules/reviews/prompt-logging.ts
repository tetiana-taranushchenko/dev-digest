import type { PromptAssemblyEvent } from '@devdigest/reviewer-core';

/** Small pino-compatible surface, kept separate so the payload is unit-testable. */
export type PromptLogger = {
  info: (obj: unknown, msg?: string) => void;
};

export interface PromptLogInput {
  runId: string;
  model: string;
  verbose: boolean;
  event: PromptAssemblyEvent;
}

/**
 * Log content-free metrics for one actual LLM prompt.
 *
 * The compact production payload includes a dedicated diff size. The complete
 * per-section breakdown is added only when the server's local-development
 * verbose flag is enabled. Neither form accepts or logs prompt content.
 */
export function logPromptAssembly(
  logger: PromptLogger | undefined,
  { runId, model, verbose, event }: PromptLogInput,
): void {
  if (!logger) return;

  const diffChars = event.summary.sections.find((section) => section.section === 'diff')?.chars ?? 0;
  const context = {
    event: 'prompt_assembly',
    correlationId: runId,
    runId,
    model,
    callIndex: event.callIndex,
    callCount: event.callCount,
    mode: event.mode,
    scope: event.scope,
    sectionCount: event.summary.sections.length,
    promptChars: event.summary.promptChars,
    diffChars,
  };
  const message =
    `prompt assembly ${event.callIndex}/${event.callCount}: ` +
    `${event.summary.sections.length} section(s), ${event.summary.promptChars} char(s) total, ` +
    `${diffChars} diff char(s)`;

  logger.info(
    verbose ? { ...context, sections: event.summary.sections } : context,
    message,
  );
}
