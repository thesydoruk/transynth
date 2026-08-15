import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureWinePrefixOwnedByCurrentUser, winePrefixOwnerUid } from '../ensureWinePrefixOwner';

describe('ensureWinePrefixOwnedByCurrentUser', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing prefix', () => {
    expect(winePrefixOwnerUid(path.join(os.tmpdir(), 'no-such-wine-prefix'))).toBeNull();
  });

  it('no-ops when the prefix is already owned by the current user', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wine-prefix-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'system.reg'), 'x');

    expect(ensureWinePrefixOwnedByCurrentUser(dir)).toBe(false);
    if (process.platform !== 'win32' && typeof process.getuid === 'function') {
      expect(winePrefixOwnerUid(dir)).toBe(process.getuid());
    }
  });

  it('returns false when the prefix does not exist', () => {
    expect(ensureWinePrefixOwnedByCurrentUser(path.join(os.tmpdir(), 'no-such-wine-prefix'))).toBe(
      false,
    );
  });
});
