import {
  normalizeFormId,
  normalizePath,
  normalizeEdid,
  getUnique,
} from './importApplyHelpers';

export type ImportedMatchMaps = {
  byIdentity: Map<string, string | null>;
  byFormIdSignaturePath: Map<string, string | null>;
  byFormIdSignature: Map<string, string | null>;
  byEdidSignaturePath: Map<string, string | null>;
  byEdidPath: Map<string, string | null>;
  byEdidSignature: Map<string, string | null>;
  byFormIdOnly: Map<string, string | null>;
  identityBuckets: Map<string, string[]>;
};

export const resolveImportedCandidate = (
  row: {
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    identity_rank: number;
  },
  maps: ImportedMatchMaps,
): { text: string; method: string } | null => {
    const formId = normalizeFormId(row.formid_hex);
    const pathRaw = normalizePath(row.path);
    const pathSimplified = normalizePath(row.path_simplified) || pathRaw;
    const signature = (row.signature ?? '').trim().toUpperCase();
    const edid = normalizeEdid(row.edid);
    const identityKey = `${formId}|${pathRaw}`;

    const directChecks: Array<{
      method: string;
      key: string;
      map: Map<string, string | null>;
    }> = [
      { method: 'identity', key: identityKey, map: maps.byIdentity },
      {
        method: 'formid_signature_path',
        key: signature ? `${formId}|${signature}|${pathSimplified}` : '',
        map: maps.byFormIdSignaturePath,
      },
      {
        method: 'edid_signature_path',
        key: edid && signature ? `${edid}|${signature}|${pathSimplified}` : '',
        map: maps.byEdidSignaturePath,
      },
      {
        method: 'edid_path',
        key: edid ? `${edid}|${pathRaw}` : '',
        map: maps.byEdidPath,
      },
      {
        method: 'edid_signature',
        key: edid && signature ? `${edid}|${signature}` : '',
        map: maps.byEdidSignature,
      },
      {
        method: 'formid_signature',
        key: signature ? `${formId}|${signature}` : '',
        map: maps.byFormIdSignature,
      },
      { method: 'formid_only', key: formId, map: maps.byFormIdOnly },
    ];

    for (const check of directChecks) {
      if (!check.key) continue;
      const text = getUnique(check.map, check.key);
      if (text != null) {
        return { text, method: check.method };
      }
    }

    // Fallback for duplicate keys: when identity is ambiguous,
    // align by row rank within the same FormID+path bucket.
    const bucket = maps.identityBuckets.get(identityKey);
    if (bucket && row.identity_rank > 0 && row.identity_rank <= bucket.length) {
      const ranked = bucket[row.identity_rank - 1]?.trim();
      if (ranked) {
        return { text: ranked, method: 'identity_ranked' };
      }
    }

    return null;
  };
