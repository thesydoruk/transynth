import { describe, it, expect } from '@jest/globals';
import {
  applyGlossaryMask,
  extractProtectedTokens,
  maskFunctionKeywords,
  maskPlaceholders,
  unmask,
} from '../placeholders';

describe('maskPlaceholders', () => {
  it('masks printf-style placeholders', () => {
    const { masked, mapping } = maskPlaceholders('Hello %s, you have %d items');
    expect(masked).toBe('Hello ¤PH0¤, you have ¤PH1¤ items');
    expect(mapping['¤PH0¤']).toBe('%s');
    expect(mapping['¤PH1¤']).toBe('%d');
  });

  it('masks extended printf placeholders', () => {
    const { masked, mapping } = maskPlaceholders('Chance: %.0f%%');
    expect(masked).toBe('Chance: ¤PH0¤¤PH1¤');
    expect(mapping['¤PH0¤']).toBe('%.0f');
    expect(mapping['¤PH1¤']).toBe('%%');
  });

  it('masks line breaks', () => {
    const original = 'Line one\r\nLine two\nLine three';
    const { masked, mapping } = maskPlaceholders(original);
    expect(unmask(masked, mapping)).toBe(original);
    expect(masked).toBe('Line one¤PH0¤Line two¤PH1¤Line three');
  });

  it('masks curly-brace placeholders', () => {
    const { masked, mapping } = maskPlaceholders('{0} gave {item} to {1}');
    expect(masked).toBe('¤PH0¤ gave ¤PH1¤ to ¤PH2¤');
    expect(mapping['¤PH0¤']).toBe('{0}');
    expect(mapping['¤PH1¤']).toBe('{item}');
    expect(mapping['¤PH2¤']).toBe('{1}');
  });

  it('masks HTML-like tags', () => {
    const { masked } = maskPlaceholders('<b>Bold</b> text');
    expect(masked).toBe('¤PH0¤Bold¤PH1¤ text');
  });

  it('masks nested font/global tags as one token', () => {
    const tag = "<font color='#<Global=SS2_Instance_ResourceManager_ComponentFontColor01>'>";
    const { masked, mapping } = maskPlaceholders(`${tag}Hello`);
    expect(masked).toBe('¤PH0¤Hello');
    expect(mapping['¤PH0¤']).toBe(tag);
  });

  it('masks UI bracket tags but not stage directions', () => {
    const { masked: uiMasked, mapping: uiMap } = maskPlaceholders('[Mod] Workshop');
    expect(uiMasked).toBe('¤PH0¤ Workshop');
    expect(uiMap['¤PH0¤']).toBe('[Mod]');

    const { masked: stageMasked, mapping: stageMap } = maskPlaceholders('[Sarcasm] Really?');
    expect(stageMasked).toBe('[Sarcasm] Really?');
    expect(Object.keys(stageMap)).toHaveLength(0);
  });

  it('masks wildcard and form-reference bracket tags', () => {
    const { masked, mapping } = maskPlaceholders('[*Class] Armor Store [DIAL:001234AB]');
    expect(masked).toBe('¤PH0¤ Armor Store ¤PH1¤');
    expect(mapping['¤PH0¤']).toBe('[*Class]');
    expect(mapping['¤PH1¤']).toBe('[DIAL:001234AB]');
  });

  it('masks $ variables', () => {
    const { masked, mapping } = maskPlaceholders('$PlayerName entered');
    expect(masked).toBe('¤PH0¤ entered');
    expect(mapping['¤PH0¤']).toBe('$PlayerName');
  });

  it('returns empty mapping for plain text', () => {
    const { masked, mapping } = maskPlaceholders('Just a sentence.');
    expect(masked).toBe('Just a sentence.');
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});

describe('unmask', () => {
  it('round-trips: mask -> unmask restores original', () => {
    const original = 'Hello %s, you have %d items in {location}';
    const { masked, mapping } = maskPlaceholders(original);
    expect(unmask(masked, mapping)).toBe(original);
  });

  it('handles overlapping-length keys correctly (longest first)', () => {
    const mapping = { '¤PH0¤': 'short', '¤PH10¤': 'longer' };
    const text = 'A ¤PH10¤ and ¤PH0¤';
    expect(unmask(text, mapping)).toBe('A longer and short');
  });
});

describe('applyGlossaryMask', () => {
  it('masks glossary terms', () => {
    const { masked, mapping } = applyGlossaryMask('The Brotherhood of Steel attacked', [
      'Brotherhood of Steel',
    ]);
    expect(masked).toBe('The ¤GL0¤ attacked');
    expect(mapping['¤GL0¤']).toBe('Brotherhood of Steel');
  });

  it('round-trips: glossary mask -> unmask', () => {
    const original = 'Visit the Brotherhood of Steel at the Institute';
    const { masked, mapping } = applyGlossaryMask(original, ['Brotherhood of Steel', 'Institute']);
    expect(unmask(masked, mapping)).toBe(original);
  });
});

describe('maskFunctionKeywords', () => {
  it('masks code-like function keywords for the active game', () => {
    const { masked, mapping } = maskFunctionKeywords('Debug.Notification(AddItem)', 'fo4');
    expect(masked).toBe('¤FK0¤.¤FK1¤(¤FK2¤)');
    expect(mapping['¤FK0¤']).toBe('Debug');
    expect(mapping['¤FK1¤']).toBe('Notification');
    expect(mapping['¤FK2¤']).toBe('AddItem');
  });

  it('does not mask ordinary prose that happens to contain legacy keywords', () => {
    const { masked, mapping } = maskFunctionKeywords(
      'Add the item to the map and read the book.',
      'fo4',
    );
    expect(masked).toBe('Add the item to the map and read the book.');
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('does not mask keywords in item names with dotted abbreviations', () => {
    const { masked, mapping } = maskFunctionKeywords('Hellfire Mk.VI Arm Armor', 'fo4');
    expect(masked).toBe('Hellfire Mk.VI Arm Armor');
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('does not mask keywords in HTML-formatted prose', () => {
    const source =
      "<font face='$HandwrittenFont' size='20'>\r\n<p align='center'>\r\nIf you cannot stand the heat";
    const { masked, mapping } = maskFunctionKeywords(source, 'fo4');
    expect(masked).toBe(source);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('masks declaration-style keyword lines without punctuation', () => {
    const { masked, mapping } = maskFunctionKeywords('Actor Property PlayerRef Auto', 'sse');
    expect(masked).toBe('¤FK0¤ ¤FK1¤ PlayerRef ¤FK2¤');
    expect(mapping['¤FK0¤']).toBe('Actor');
    expect(mapping['¤FK1¤']).toBe('Property');
    expect(mapping['¤FK2¤']).toBe('Auto');
  });
});

describe('extractProtectedTokens', () => {
  it('includes both placeholders and function keywords for QA comparisons', () => {
    expect(extractProtectedTokens('Debug.Notification(<Alias=Player>)', 'fo4')).toEqual([
      '<Alias=Player>',
      'Debug',
      'Notification',
    ]);
  });

  it('does not treat stage directions or dotted item names as protected tokens', () => {
    expect(extractProtectedTokens('[Sarcasm] Really?', 'fo4')).toEqual([]);
    expect(extractProtectedTokens('Hellfire Mk.VI Arm Armor', 'fo4')).toEqual([]);
  });
});
