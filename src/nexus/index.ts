/**
 * Public barrel for the `nexus` module.
 *
 * Re-exports all public types, error classes, and the client class from their
 * respective sub-modules. Also provides {@link createNexusClient}, a factory
 * that pre-configures the client from the project's `CONFIG` object.
 *
 * ### Typical usage (backend route / CLI)
 *
 * ```typescript
 * import { createNexusClient, NexusModsNotFoundError } from './index';
 *
 * const nexus = createNexusClient();
 *
 * try {
 *   const mod = await nexus.getModById('fallout4', 12345);
 *   console.log(mod.name);
 * } catch (e) {
 *   if (e instanceof NexusModsNotFoundError) { ... }
 *   throw e;
 * }
 * ```
 */

import { CONFIG } from '../config';
import { NexusModsClient } from './client';
import type { NexusModsClientOptions } from './types';

// Re-export everything so callers can import from one place
export * from './types';
export * from './errors';
export * from './graphql';
export { NexusModsClient };

/**
 * Creates a {@link NexusModsClient} pre-configured from the project `CONFIG`.
 *
 * - Uses `CONFIG.nexusApiKey` (`NEXUS_API_KEY` env var) as the Bearer token.
 * - Sets a descriptive User-Agent string.
 * - All options can be overridden by passing `options`.
 *
 * @param options - Optional overrides for endpoint, timeout, userAgent, or
 *   accessToken. Merged on top of the CONFIG-derived defaults.
 * @returns A ready-to-use `NexusModsClient` instance.
 */
export const createNexusClient = (options?: NexusModsClientOptions): NexusModsClient =>
  new NexusModsClient({
    accessToken: CONFIG.nexusApiKey || undefined,
    userAgent: 'storywealth-localizer/1.0',
    ...options,
  });
