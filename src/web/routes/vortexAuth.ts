/**
 * Which `/api/vortex` writes need the CLI token.
 *
 * The agent (and the manual CLI) upload staging content and report heartbeats
 * from another machine, so those writes carry `TRANSYNTH_CLI_TOKEN`. The web
 * UI's own buttons on the Vortex page — start a stage, stop a run — are as open
 * as every other mutating route of the app (there are no accounts; see
 * SECURITY.md). Reads are always open.
 */
import type { FastifyInstance } from 'fastify';
import { CONFIG } from '../../config';

const AGENT_WRITE_PATTERNS: readonly RegExp[] = [
  /^\/api\/vortex\/sync\/plan$/,
  /^\/api\/vortex\/sync\/[^/]+\/packs\//,
  /^\/api\/vortex\/sync\/[^/]+\/start$/,
  /^\/api\/vortex\/agent\//,
  /^\/api\/vortex\/groups\/[^/]+\/export-order$/,
  // The agent uploads the video files the server asked for.
  /^\/api\/mods\/[^/]+\/video\/[^/]+\/file$/,
];

/** True for the requests an agent or CLI makes that change server state. */
export const isVortexAgentWrite = (method: string, url: string): boolean => {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const path = url.split('?')[0] ?? url;
  return AGENT_WRITE_PATTERNS.some((pattern) => pattern.test(path));
};

/** Gate the agent writes on the CLI token; a server without one stays open. */
export const registerVortexAgentTokenGate = (app: FastifyInstance): void => {
  app.addHook('preHandler', async (req, reply) => {
    if (!CONFIG.cliToken) return;
    if (!isVortexAgentWrite(req.method, req.url)) return;
    if (req.headers.authorization !== `Bearer ${CONFIG.cliToken}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
};
