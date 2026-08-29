import type { NexusModRequirement } from '../types';
import { NexusModsGraphQLError } from '../errors';
import {
  asRecord,
  parsePositiveInteger,
  toNullableBoolean,
  toNullableNumber,
  toNullableString,
  toString,
} from './coercion';
import type { ModRequirementConnection, ModRequirementNode, NexusRequestFn } from './internalTypes';

export const mapRequirementNode = (input: unknown): ModRequirementNode => {
  const value = asRecord(input);

  return {
    modId: toString(value['modId']),
    modName: toString(value['modName']),
    notes: toNullableString(value['notes']),
    externalRequirement: toNullableBoolean(value['externalRequirement']) ?? false,
  };
};

export const mapModRequirementNodes = (nodes: ModRequirementNode[]): NexusModRequirement[] => {
  return nodes.map((node) => ({
    modId: parsePositiveInteger(node.modId) ?? 0,
    modName: node.modName,
    notes: node.notes,
    externalRequirement: node.externalRequirement,
  }));
};

export async function loadRequirementConnection(
  request: NexusRequestFn,
  query: string,
  domainName: string,
  gameId: number,
  modId: number,
  offset: number,
  count: number,
  relationField: 'modsRequiringThisMod' | 'modsThisModRequires',
): Promise<ModRequirementConnection> {
  try {
    const data = await request<{
      mods: {
        nodes: Array<{
          modRequirements?: Record<string, unknown> | null;
        }>;
      };
    }>(query, {
      domainName,
      gameId: String(gameId),
      modId: String(modId),
      offset,
      count,
    });

    const rawConnection = data.mods.nodes[0]?.modRequirements?.[relationField];
    if (!rawConnection) {
      return { totalCount: 0, nodesCount: 0, nodes: [] };
    }

    const value = asRecord(rawConnection);
    const rawNodes = Array.isArray(value['nodes']) ? value['nodes'] : [];

    const nodes = rawNodes
      .map((item) => {
        try {
          return mapRequirementNode(item);
        } catch {
          return null;
        }
      })
      .filter((item): item is ModRequirementNode => item !== null);

    return {
      totalCount: toNullableNumber(value['totalCount']) ?? nodes.length,
      nodesCount: toNullableNumber(value['nodesCount']) ?? nodes.length,
      nodes,
    };
  } catch (error: unknown) {
    if (error instanceof NexusModsGraphQLError) {
      const details = JSON.stringify(error.graphqlErrors ?? []).toLowerCase();
      if (details.includes('cannot query field')) {
        return { totalCount: 0, nodesCount: 0, nodes: [] };
      }
    }
    throw error;
  }
}

export async function loadRequirementConnectionSafe(
  request: NexusRequestFn,
  query: string,
  domainName: string,
  gameId: number,
  modId: number,
  offset: number,
  count: number,
  relationField: 'modsRequiringThisMod' | 'modsThisModRequires',
): Promise<ModRequirementConnection> {
  try {
    return await loadRequirementConnection(
      request,
      query,
      domainName,
      gameId,
      modId,
      offset,
      count,
      relationField,
    );
  } catch {
    return { totalCount: 0, nodesCount: 0, nodes: [] };
  }
}
