import { adaptUkrainianForFonix } from '../ukToFonix';
import { prepareFaceFxDialogueText } from '../text';

describe('adaptUkrainianForFonix', () => {
  it('leaves English dialogue unchanged', () => {
    expect(adaptUkrainianForFonix('Hello, vault dweller.')).toBe('Hello, vault dweller.');
  });

  it('respells common Ukrainian words for Fonix, not ISO translit', () => {
    expect(adaptUkrainianForFonix('привіт')).toBe('prihveet');
    expect(adaptUkrainianForFonix('ні')).toBe('nee');
    expect(adaptUkrainianForFonix('це')).toBe('tseh');
    expect(adaptUkrainianForFonix('що')).toBe('shchoh');
    expect(adaptUkrainianForFonix('їжа')).toBe('yeezhah');
    expect(adaptUkrainianForFonix('ґава')).toBe('gahvah');
    expect(adaptUkrainianForFonix('дякую')).toBe('dyahkooyoo');
  });

  it('keeps Latin names inside a Ukrainian line', () => {
    expect(adaptUkrainianForFonix('Pip-Boy працює')).toBe('Pip-Boy prahtsyooyeh');
  });

  it('drops soft signs and apostrophes', () => {
    expect(adaptUkrainianForFonix("з'їсти")).toBe('zyeestih');
    expect(adaptUkrainianForFonix('сьогодні')).toBe('sohhohdnee');
  });

  it('maps дж / дз as English clusters', () => {
    expect(adaptUkrainianForFonix('джерело')).toBe('jehrehloh');
    expect(adaptUkrainianForFonix('дзвін')).toBe('dzveen');
  });
});

describe('prepareFaceFxDialogueText', () => {
  it('strips tone tags then respells the spoken Ukrainian', () => {
    expect(prepareFaceFxDialogueText('[Сарказм] Привіт, мешканцю.')).toBe(
      'Prihveet, mehshkahntsyoo.',
    );
  });
});
