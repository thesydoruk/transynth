import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};

/** Nexus Mods ToS requires a descriptive User-Agent. */
export const NEXUS_USER_AGENT = `transynth/${version}`;
