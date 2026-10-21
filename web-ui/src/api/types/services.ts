export type ServiceKind = 'llm' | 'embed' | 'tts' | 'asr' | 'separate' | 'tools';

export type ServiceSource = 'settings' | 'legacy-llm' | 'env' | 'asr';

export type ServiceEndpointStatus = {
  kind: ServiceKind;
  host: string;
  maxParallel: number;
  managed: boolean;
  apiKeyConfigured: boolean;
  healthy: boolean;
  error: string | null;
  inFlight: number;
  queued: number;
};

export type ServiceKindStatus = {
  kind: ServiceKind;
  label: string;
  source: ServiceSource;
  endpoints: ServiceEndpointStatus[];
  pool: { inFlight: number; queued: number; max: number; healthyMax: number } | null;
};

export type ServicesPayload = {
  services: ServiceKindStatus[];
  probedAt: string;
};
