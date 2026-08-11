import { req } from '../client';

export const projectSettingsEndpoints = {
  /** Returns all project settings merged with built-in defaults. */
  getAll: () => req<Record<string, unknown>>('/api/project-settings'),
  /** Updates a single project setting by key. */
  update: (key: string, value: unknown) =>
    req<{ key: string; value: unknown }>(`/api/project-settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};
