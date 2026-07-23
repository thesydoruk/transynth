import { req } from '../client';
import type { SettingsPayload } from '../types';

export const settingsEndpoints = {
  /** Returns the current server configuration snapshot. */
  get: () => req<SettingsPayload>('/api/settings'),
};
