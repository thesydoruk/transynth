import { describe, expect, it } from '@jest/globals';
import { DEFAULT_LISTEN_HOST, isLoopbackHost, resolveListenHost } from '../listenHost';

describe('listenHost', () => {
  it('defaults to loopback when HOST is unset or blank', () => {
    expect(resolveListenHost(undefined)).toBe(DEFAULT_LISTEN_HOST);
    expect(resolveListenHost('')).toBe(DEFAULT_LISTEN_HOST);
    expect(resolveListenHost('  ')).toBe(DEFAULT_LISTEN_HOST);
  });

  it('keeps an explicit bind address', () => {
    expect(resolveListenHost('0.0.0.0')).toBe('0.0.0.0');
  });

  it('treats only loopback names as loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });
});
