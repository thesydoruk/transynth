import { req } from '../client';
import type { ServicesPayload } from '../types';

export const servicesEndpoints = {
  /** Every service kind with resolved endpoints, fresh health and pool load. */
  get: () => req<ServicesPayload>('/api/services'),
};
