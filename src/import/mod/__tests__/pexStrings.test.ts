import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildPex } from '../../../formats/pex/__tests__/pexFixture';
import { collectPexStrings } from '../pexStrings';

describe('collectPexStrings on an unpacked mod folder', () => {
  let modDir: string;

  const writePex = (rel: string, strings: string[], sourceFile: string) => {
    const full = path.join(modDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buildPex(strings, { sourceFile }));
  };

  beforeEach(() => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pex-import-'));
    fs.writeFileSync(path.join(modDir, 'SS2.esm'), '');
  });

  afterEach(() => {
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it('reads namespaced scripts that an archive left in Scripts subfolders', async () => {
    writePex('Scripts/WSFW_Utility.pex', ['Choose your reward'], 'WSFW_Utility.psc');
    writePex(
      'Scripts/SimSettlementsV2/Quests/SS2Main.pex',
      ['Give holotape'],
      'SimSettlementsV2\\Quests\\SS2Main.psc',
    );
    writePex('Scripts/SimSettlementsV2/Aliases/SS2Main.pex', ['Alias text'], 'SS2Main.psc');

    const scripts = await collectPexStrings(path.join(modDir, 'SS2.esm'));

    expect([...scripts.keys()].sort()).toEqual([
      'SimSettlementsV2:Aliases:SS2Main',
      'SimSettlementsV2:Quests:SS2Main',
      'WSFW_Utility',
    ]);
    expect(scripts.get('SimSettlementsV2:Quests:SS2Main')?.pexFile).toBe(
      'Scripts\\SimSettlementsV2\\Quests\\SS2Main.pex',
    );
  });

  it('reads an upper-case SCRIPTS folder', async () => {
    writePex('SCRIPTS/MyScript.pex', ['Hello there'], 'MyScript.psc');

    const scripts = await collectPexStrings(path.join(modDir, 'SS2.esm'));

    expect([...scripts.keys()]).toEqual(['MyScript']);
  });
});
