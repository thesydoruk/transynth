/**
 * Internal GraphQL shapes — kept private to avoid leaking unstable API types.
 */

export interface GraphQLResponse<TData> {
  data?: TData;
  errors?: unknown[];
}

export interface ModRequirementNode {
  modId: string;
  modName: string;
  notes: string | null;
  externalRequirement: boolean;
}

export interface ModRequirementConnection {
  totalCount: number;
  nodesCount: number;
  nodes: ModRequirementNode[];
}

export type NexusRequestFn = <TData>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<TData>;

export type GetModByIdFn = (
  domainName: string,
  gameId: number,
  modId: number,
) => Promise<import('../types').NexusMod>;
