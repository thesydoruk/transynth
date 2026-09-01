import { describe, it, expect } from '@jest/globals';
import {
  maskLlmText,
  maskLlmTextFields,
  maskLlmReferenceExamples,
  maskTranslateSource,
  unmaskLlmText,
} from '../llmTextMask';

describe('maskLlmTextFields', () => {
  it('reuses one key when the same token appears in source and translation', () => {
    const alias = '<Alias=ComponentNameHolder01>';
    const { masked, mapping } = maskLlmTextFields([`${alias} Scrap`, `${alias} Брухт`], {
      reuseKeysForIdenticalTokens: true,
    });
    expect(masked[0]).toBe('¤PH0¤ Scrap');
    expect(masked[1]).toBe('¤PH0¤ Брухт');
    expect(Object.keys(mapping)).toHaveLength(1);
  });

  it('uses one shared counter across fields', () => {
    const tag = "<font color='#<Global=SS2_Instance_ResourceManager_ComponentFontColor05>'>";
    const { masked, mapping } = maskLlmTextFields([
      `${tag}Scrap`,
      `${tag}Брухт`,
      '<Alias=Player> entered',
    ]);
    expect(masked[0]).toBe('¤PH0¤Scrap');
    expect(masked[1]).toBe('¤PH1¤Брухт');
    expect(masked[2]).toBe('¤PH2¤ entered');
    expect(mapping['¤PH0¤']).toBe(tag);
    expect(mapping['¤PH1¤']).toBe(tag);
    expect(mapping['¤PH2¤']).toBe('<Alias=Player>');
  });

  it('round-trips suggestions via unmaskLlmText', () => {
    const { masked, mapping } = maskLlmTextFields(['Need %s caps', 'Need %s кришок']);
    const suggestion = `${masked[1]!.replace('кришок', 'монет')}`;
    expect(unmaskLlmText(suggestion, mapping)).toBe('Need %s монет');
  });
});

describe('maskLlmReferenceExamples', () => {
  it('masks each example field independently', () => {
    const masked = maskLlmReferenceExamples([
      {
        source: '<Alias=Player> left',
        translation: '<Alias=Player> пішов',
        grup: 'INFO',
        edid: null,
        field: 'NAM1',
        match_method: 'exact',
        similarity: 1,
      },
    ]);
    expect(masked?.[0]?.source).toBe('¤PH0¤ left');
    expect(masked?.[0]?.translation).toBe('¤PH0¤ пішов');
  });
});

describe('maskLlmText', () => {
  it('delegates to maskPlaceholders', () => {
    const { masked, mapping } = maskLlmText('Hello %s');
    expect(masked).toBe('Hello ¤PH0¤');
    expect(mapping['¤PH0¤']).toBe('%s');
  });
});

describe('maskTranslateSource', () => {
  it('adds Disco lockit keys after placeholders', () => {
    const { masked, placeholderMap } = maskTranslateSource('Need {0} -- *now*', 'disco');
    expect(masked).toBe('Need ¤PH0¤ ¤EM0¤ ¤IT0¤now¤IT0¤');
    expect(placeholderMap['¤PH0¤']).toBe('{0}');
    expect(placeholderMap['¤EM0¤']).toBe('--');
    expect(placeholderMap['¤IT0¤']).toBe('*');
  });

  it('does not mask Disco markup for other games', () => {
    const { masked } = maskTranslateSource('Need {0} -- *now*', 'fo4');
    expect(masked).toBe('Need ¤PH0¤ -- *now*');
  });
});

describe('maskLlmReferenceExamples disco', () => {
  it('masks lockit markup in RAG examples for Disco', () => {
    const masked = maskLlmReferenceExamples(
      [
        {
          source: 'You *belong* here.',
          translation: 'Ти *належиш* сюди.',
          grup: 'PO',
          edid: null,
          field: 'Dialogue Text',
          match_method: 'exact',
          similarity: 1,
        },
      ],
      'disco',
    );
    expect(masked?.[0]?.source).toBe('You ¤IT0¤belong¤IT0¤ here.');
    expect(masked?.[0]?.translation).toBe('Ти ¤IT0¤належиш¤IT0¤ сюди.');
  });
});
