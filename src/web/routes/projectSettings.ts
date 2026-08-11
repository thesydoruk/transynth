/**
 * projectSettings.ts (route) — REST API for project-wide workflow settings.
 *
 * Endpoints:
 *   GET  /api/project-settings         — Returns all settings merged with defaults.
 *   PUT  /api/project-settings/:key    — Updates a single setting by key.
 *
 * Settings are stored as key/JSONB rows in the `project_settings` table.
 * Reads and writes use the helpers in `src/web/projectSettings.ts`.
 */

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import {
  getAllProjectSettings,
  setProjectSetting,
  SETTING_DEFAULTS,
} from '../services/projectSettings';
import type { ProjectSettingKey, ProjectSettings } from '../services/projectSettings';
import { syncLlmPoolFromProjectSettings } from '../../llm/llmProjectSettings';
import { normalizeVllmServerEntries } from '../../llm/vllmServerConfig';
import { syncTtsPoolFromProjectSettings } from '../../voice/voiceProjectSettings';
import { log } from '../../logger';

export const projectSettingsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/project-settings — returns all settings merged with built-in defaults
  app.get('/api/project-settings', async (_req, reply) => {
    return reply.send(await getAllProjectSettings(db));
  });

  // PUT /api/project-settings/:key — update a single project setting
  //
  // The value must match the type registered for the given key (boolean for
  // boolean settings, number for numeric ones).  Unknown keys are rejected
  // with 400 to prevent accidental key pollution.
  app.put<{
    Params: { key: string };
    Body: { value: unknown };
  }>('/api/project-settings/:key', async (req, reply) => {
    const key = req.params.key as ProjectSettingKey;

    if (!(key in SETTING_DEFAULTS)) {
      return reply.code(400).send({ error: `Unknown setting key: ${key}` });
    }

    const { value } = req.body ?? {};
    if (value === undefined || value === null) {
      return reply.code(400).send({ error: 'value is required' });
    }

    if (key === 'llm.vllm_servers') {
      if (!Array.isArray(value)) {
        return reply.code(400).send({ error: 'Expected array for key "llm.vllm_servers"' });
      }
      const normalized = normalizeVllmServerEntries(value);
      if (value.length > 0 && normalized.length === 0) {
        return reply.code(400).send({ error: 'No valid vLLM servers in the list' });
      }
      log.info(`Project setting updated: ${key} = ${JSON.stringify(normalized)}`);
      await setProjectSetting(db, key, normalized);
      const settings = await getAllProjectSettings(db);
      syncLlmPoolFromProjectSettings(settings);
      return reply.send({ key, value: normalized });
    }

    // Validate that the incoming type matches the default type for this key.
    const defaultVal: ProjectSettings[ProjectSettingKey] = SETTING_DEFAULTS[key];
    if (typeof value !== typeof defaultVal) {
      return reply.code(400).send({
        error: `Expected ${typeof defaultVal} for key "${key}" but received ${typeof value}`,
      });
    }

    log.info(`Project setting updated: ${key} = ${JSON.stringify(value)}`);
    await setProjectSetting(db, key, value as ProjectSettings[ProjectSettingKey]);
    if (key === 'voice.tts_max_parallel_fish_speech') {
      syncTtsPoolFromProjectSettings(await getAllProjectSettings(db));
    }
    return reply.send({ key, value });
  });
};
