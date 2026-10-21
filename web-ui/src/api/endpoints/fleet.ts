import { req } from '../client';
import type { FleetOverride, FleetOverrideResult, FleetPayload } from '../types';

export const fleetEndpoints = {
  /** Fleet controller state: GPUs, managed services, demand and recent actions. */
  get: () => req<FleetPayload>('/api/fleet'),
  /** Force a service on or off, bypassing the scheduler. */
  override: (name: string, action: FleetOverride) =>
    req<FleetOverrideResult>(`/api/fleet/services/${encodeURIComponent(name)}/${action}`, {
      method: 'POST',
    }),
  /** Hand a service back to the scheduler. */
  clearOverride: (name: string) =>
    req<FleetOverrideResult>(`/api/fleet/services/${encodeURIComponent(name)}/override`, {
      method: 'DELETE',
    }),
};
