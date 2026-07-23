import { getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { DashboardData, GrupStatRow, Mod, Stats } from '../types';

export const statsEndpoints = {
  mod: (modId: number) => req<Stats>(`/api/stats?modId=${modId}`),
  global: () => req<Array<Mod & { stats: Stats }>>('/api/stats/global'),
  dashboard: () => req<DashboardData>('/api/stats/dashboard'),
  grup: (modId: number, lang = getTgtLang()) =>
    req<GrupStatRow[]>(`/api/stats/grup?modId=${modId}&lang=${lang}`),
};
