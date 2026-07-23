import { req } from '../client';
import type { ActivityLogResponse } from '../types';

export const activityEndpoints = {
  /** Fetches paginated activity log entries */
  list: (params?: {
    limit?: number;
    offset?: number;
    userId?: number;
    action?: string;
    entityType?: string;
    entityId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.userId) qs.set('userId', String(params.userId));
    if (params?.action) qs.set('action', params.action);
    if (params?.entityType) qs.set('entityType', params.entityType);
    if (params?.entityId) qs.set('entityId', String(params.entityId));
    if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params?.dateTo) qs.set('dateTo', params.dateTo);
    return req<ActivityLogResponse>(`/api/activity?${qs}`);
  },
  /**
   * Triggers a CSV download of the filtered activity log (max 10 000 rows).
   * Uses fetch + Blob so that auth cookies are included automatically.
   */
  csvDownload: async (params?: {
    action?: string;
    entityType?: string;
    entityId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.action) qs.set('action', params.action);
    if (params?.entityType) qs.set('entityType', params.entityType);
    if (params?.entityId) qs.set('entityId', String(params.entityId));
    if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params?.dateTo) qs.set('dateTo', params.dateTo);
    const res = await fetch(`/api/activity/csv?${qs}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`CSV export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activity.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
