import { NexusModsError, NexusModsGraphQLError } from '../errors';
import type { GraphQLResponse } from './internalTypes';

export interface GraphqlRequestOptions {
  endpoint: string;
  headers: Record<string, string>;
  timeoutMs: number;
  query: string;
  variables: Record<string, unknown>;
}

export async function graphqlRequest<TData>(options: GraphqlRequestOptions): Promise<TData> {
  const { endpoint, headers, timeoutMs, query, variables } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new NexusModsError(
        `NexusMods API returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const body = (await response.json()) as GraphQLResponse<TData>;

    if (body.errors && body.errors.length > 0) {
      throw new NexusModsGraphQLError('The Nexus Mods GraphQL API returned errors.', body.errors);
    }

    if (!body.data) {
      throw new NexusModsError('The Nexus Mods GraphQL API returned no data.');
    }

    return body.data;
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof NexusModsError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new NexusModsError(`NexusMods API request timed out after ${timeoutMs} ms.`);
    }

    throw new NexusModsError('The request to Nexus Mods failed.', error);
  }
}
