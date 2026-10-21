/**
 * The fleet controller: keeps the GPU services the queues need up, and the rest down.
 *
 * Reads `fleet.yml` (FLEET_CONFIG), watches the job queues in Redis, starts and stops
 * compose services on the inventory hosts through docker contexts over ssh, writes the
 * services that are up into the project setting `services.endpoints` as managed rows,
 * and publishes a snapshot the Settings → Services page shows.
 *
 * Usage:
 *   npm run fleet                 # loop until SIGINT / SIGTERM
 *   npm run fleet -- --once       # one tick, print the snapshot, exit
 *   FLEET_CONFIG=path/to/fleet.yml
 */
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { publishFleetSnapshot, readFleetOverrides } from '../src/fleet/channel';
import { FleetController } from '../src/fleet/controller';
import { bullQueueCounts } from '../src/fleet/demand';
import { ShellHostDriver } from '../src/fleet/driver';
import { loadFleetInventory } from '../src/fleet/inventory';
import { log } from '../src/logger';
import { probeServiceEndpoint } from '../src/services/probes';
import { getAllProjectSettings, setProjectSetting } from '../src/web/services/projectSettings';
import { closeSharedRedis, getSharedRedis } from '../worker/src/core/connection';

const once = process.argv.includes('--once');
const configPath = process.env.FLEET_CONFIG?.trim() || 'fleet.yml';

const inventory = loadFleetInventory(configPath);
log.info('fleet: inventory loaded', {
  path: configPath,
  hosts: inventory.hosts.map((h) => h.name),
  services: inventory.services.map((s) => `${s.name}(${s.kinds.join('+')})@${s.host}`),
  pollSec: inventory.pollSec,
  redis: CONFIG.redisUrl,
});

const db = openDb();
const redis = getSharedRedis();
const controller = new FleetController(inventory, new ShellHostDriver(), {
  readCounts: bullQueueCounts,
  probe: probeServiceEndpoint,
  readEndpoints: async () => (await getAllProjectSettings(db))['services.endpoints'],
  writeEndpoints: (rows) => setProjectSetting(db, 'services.endpoints', rows),
  readOverrides: (names) => readFleetOverrides(redis, names),
  publish: (snapshot) => publishFleetSnapshot(redis, snapshot, inventory.pollSec * 3 + 30),
  log,
});

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info('fleet: shutting down');
  await closeSharedRedis();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

try {
  if (once) {
    const snapshot = await controller.tick();
    console.log(JSON.stringify(snapshot, null, 2));
    await shutdown();
  }
  while (!stopping) {
    try {
      await controller.tick();
    } catch (err) {
      log.warn('fleet: tick failed', { error: err instanceof Error ? err.message : String(err) });
    }
    await sleep(inventory.pollSec * 1000);
  }
} catch (err) {
  log.error('fleet: fatal', { error: err instanceof Error ? err.message : String(err) });
  await shutdown();
}
