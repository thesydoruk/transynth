import fs from 'node:fs';
import path from 'node:path';

const chownTree = (root: string, uid: number, gid: number): void => {
  const st = fs.lstatSync(root);
  fs.lchownSync(root, uid, gid);
  if (!st.isDirectory() || st.isSymbolicLink()) return;
  for (const name of fs.readdirSync(root)) {
    chownTree(path.join(root, name), uid, gid);
  }
};

/** Directory uid of a Wine prefix, or null if it does not exist. */
export const winePrefixOwnerUid = (prefix: string): number | null => {
  try {
    return fs.statSync(prefix).uid;
  } catch {
    return null;
  }
};

/**
 * Wine refuses to use a prefix whose directory uid ≠ the current user
 * ("is not owned by you"). Bind mounts from another user namespace often
 * leave `.wine` at uid 100000 while the container process is root.
 *
 * @returns true when the tree was chowned
 */
export const ensureWinePrefixOwnedByCurrentUser = (prefix: string): boolean => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return false;
  if (!fs.existsSync(prefix)) return false;

  const uid = process.getuid();
  const gid = typeof process.getgid === 'function' ? process.getgid() : uid;
  const owner = winePrefixOwnerUid(prefix);
  if (owner == null || owner === uid) return false;

  try {
    chownTree(prefix, uid, gid);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Wine prefix ${prefix} is owned by uid ${owner}, not ${uid}; chown failed: ${detail}`,
    );
  }
  return true;
};
