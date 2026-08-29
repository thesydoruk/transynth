import type { Argv } from 'yargs';
import type { RagRetrievalOptions } from '../src/llm/rag';

/** Parsed yargs values for shared RAG CLI flags (yargs camelCases kebab options). */
export type CliRagFlagValues = {
  noRag?: boolean;
  ragModOnly?: boolean;
};

/** Shared yargs flags for reference-example retrieval (translate & verify). */
export const addCliRagFlagOptions = <T>(yargs: Argv<T>): Argv<T> =>
  yargs
    .option('rag', {
      type: 'boolean',
      default: true,
      describe: 'Enable reference-example search (disable with --no-rag)',
    })
    .option('rag-mod-only', {
      type: 'boolean',
      default: false,
      describe: 'Search reference examples only within the current mod (TM + embedding)',
    }) as Argv<T>;

export const assertCliRagFlags = (flags: CliRagFlagValues): void => {
  if (flags.noRag && flags.ragModOnly) {
    throw new Error('Use either --no-rag or --rag-mod-only, not both');
  }
};

export const readCliRagFlags = (argv: Record<string, unknown>): CliRagFlagValues => ({
  noRag: argv.rag === false,
  ragModOnly: argv.ragModOnly === true,
});

export const toRagRetrievalOptions = (
  flags: CliRagFlagValues,
  modId: number,
): RagRetrievalOptions => ({
  disableRag: flags.noRag === true,
  modId: flags.ragModOnly === true ? modId : undefined,
});

export const formatCliRagFlags = (flags: CliRagFlagValues): string => {
  if (flags.noRag) return 'rag=off';
  if (flags.ragModOnly) return 'rag=mod-only';
  return 'rag=global';
};
