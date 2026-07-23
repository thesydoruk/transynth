export type PexStringUsageKind =
  | 'function'
  | 'getter'
  | 'setter'
  | 'property-default'
  | 'variable-default';

export type PexStringUsage = {
  objectName: string;
  stateName: string;
  functionName: string;
  kind: PexStringUsageKind;
  /** Opcode name where the literal was referenced (e.g. callstatic). */
  opcode: string;
  /** Resolved call target such as `Debug.Trace` when available. */
  usageHint: string | null;
  lineNumber: number | null;
};

export type PexUserStringDetail = {
  text: string;
  tableIndex: number;
  literalIndex: number;
  usages: PexStringUsage[];
};
