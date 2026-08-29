export type SystemLogLevel = 'error' | 'warning' | 'info';
export type SystemLogSource = 'llm' | 'tts' | 'job' | 'system';

export type SystemLogEntry = {
  id: number;
  level: SystemLogLevel;
  source: SystemLogSource;
  message: string;
  job_id: number | null;
  job_kind: string | null;
  mod_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type SystemLogResponse = {
  entries: SystemLogEntry[];
  total: number;
  limit: number;
  offset: number;
};
