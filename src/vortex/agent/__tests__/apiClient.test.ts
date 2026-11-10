import { describe, expect, it } from '@jest/globals';
import { isRegisteredUpload, isUploadRejection } from '../apiClient';

describe('isRegisteredUpload', () => {
  it('accepts the route answer for the same unit', () => {
    expect(
      isRegisteredUpload('{"job":{"id":181,"mod_id":null},"unitId":"mods:a:a"}', 'mods:a:a'),
    ).toBe(true);
  });

  it.each([
    ['the SPA page a missed route answered with', '<!doctype html><html>…</html>'],
    ['an empty body', ''],
    ['another unit', '{"job":{"id":1},"unitId":"mods:b:b"}'],
    ['no job', '{"unitId":"mods:a:a"}'],
  ])('rejects %s', (_label, body) => {
    expect(isRegisteredUpload(body, 'mods:a:a')).toBe(false);
  });
});

describe('isUploadRejection', () => {
  it('treats the route refusing a unit as a rejection', () => {
    expect(
      isUploadRejection(
        'Upload mods:x:folder failed: 500 {"statusCode":500,"message":"Archive holds no files this game can import (fo4)"}',
      ),
    ).toBe(true);
  });

  it.each([
    'Upload mods:x:x failed: fetch failed (ECONNRESET)',
    'Upload mods:x:x was not registered by the server (200: <!doctype html><script src="/assets/index-500ab.js">)',
    'Upload mods:x:x failed: 413 {"statusCode":413}',
  ])('fails the cycle for %s', (message) => {
    expect(isUploadRejection(message)).toBe(false);
  });
});
