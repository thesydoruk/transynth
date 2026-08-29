import { NexusModsError } from '../errors';

export const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NexusModsError('Expected an object from the API response.');
  }
  return value as Record<string, unknown>;
};

export const toString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new NexusModsError('Expected a string-compatible value from the API response.');
};

export const toNullableString = (value: unknown): string | null => {
  if (value == null) return null;
  return toString(value);
};

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  throw new NexusModsError('Expected a numeric value from the API response.');
};

export const toNullableNumber = (value: unknown): number | null => {
  if (value == null) return null;
  return toNumber(value);
};

export const toNullableBoolean = (value: unknown): boolean | null => {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  throw new NexusModsError('Expected a boolean value from the API response.');
};

export const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
