import type { ChatMessage } from '../llm/provider';
import type { Logger } from '../logger';

/** Metadata attached to an LLM chat/embed call for structured logs. */
export type LlmLogMeta = {
  operation: string;
  context?: Record<string, unknown>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Error);

const messageStats = (messages: ChatMessage[]) => {
  const byRole: Record<string, number> = {};
  let totalChars = 0;
  for (const msg of messages) {
    byRole[msg.role] = (byRole[msg.role] ?? 0) + 1;
    totalChars += msg.content.length;
  }
  return { byRole, totalChars, count: messages.length };
};

/** Log outbound LLM messages (full bodies at trace). */
export const logLlmRequest = (
  logger: Logger,
  opts: {
    operation: string;
    model: string;
    messages: ChatMessage[];
    context?: Record<string, unknown>;
  },
): void => {
  const stats = messageStats(opts.messages);
  logger.debug(`${opts.operation} request`, {
    model: opts.model,
    messages: stats.count,
    roles: stats.byRole,
    totalChars: stats.totalChars,
    ...opts.context,
  });

  if (!logger.isTrace()) return;

  for (const [index, msg] of opts.messages.entries()) {
    logger.trace(`${opts.operation} prompt[${index}] role=${msg.role}`, {
      chars: msg.content.length,
      content: msg.content,
    });
  }
};

/** Log inbound LLM response (full body at trace). */
export const logLlmResponse = (
  logger: Logger,
  opts: {
    operation: string;
    model: string;
    response: string;
    durationMs: number;
    provider?: string;
    context?: Record<string, unknown>;
  },
): void => {
  logger.debug(`${opts.operation} response`, {
    model: opts.model,
    provider: opts.provider,
    durationMs: opts.durationMs,
    responseChars: opts.response.length,
    ...opts.context,
  });

  if (logger.isTrace()) {
    logger.trace(`${opts.operation} response body`, {
      content: opts.response,
    });
  }
};

/** Log embedding batch calls. */
export const logEmbedRequest = (
  logger: Logger,
  opts: {
    operation: string;
    model: string;
    textCount: number;
    dimensions?: number;
    context?: Record<string, unknown>;
  },
): void => {
  logger.debug(`${opts.operation} embed request`, {
    model: opts.model,
    textCount: opts.textCount,
    dimensions: opts.dimensions,
    ...opts.context,
  });
};

export const logEmbedResponse = (
  logger: Logger,
  opts: {
    operation: string;
    model: string;
    vectorCount: number;
    durationMs: number;
    provider?: string;
    context?: Record<string, unknown>;
  },
): void => {
  logger.debug(`${opts.operation} embed response`, {
    model: opts.model,
    provider: opts.provider,
    vectorCount: opts.vectorCount,
    durationMs: opts.durationMs,
    ...opts.context,
  });
};
