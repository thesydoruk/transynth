export const log = {
  info: (...a: any[]) => console.log('[info]', ...a),
  warn: (...a: any[]) => console.warn('[warn]', ...a),
  error: (...a: any[]) => console.error('[error]', ...a),
  debug: (...a: any[]) => process.env.DEBUG ? console.log('[debug]', ...a) : undefined,
};
