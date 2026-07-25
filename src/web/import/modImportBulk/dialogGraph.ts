import type { Tx } from '../../../db';
import type { DialogGraphImportContext, DialogInfoImportRow, ModImportBulkResult } from './types';

const dialogInfoImportKey = (topicFormId: string, infoFormId: string): string =>
  `${topicFormId}\0${infoFormId}`;

const dialogEdgeImportKey = (
  topicId: number,
  fromInfoFormId: string,
  toInfoFormId: string,
  edgeKind: string,
): string => `${topicId}\0${fromInfoFormId}\0${toInfoFormId}\0${edgeKind}`;

const mergeDialogInfoImportRow = (
  kept: DialogInfoImportRow,
  next: DialogInfoImportRow,
): DialogInfoImportRow => ({
  ...kept,
  speakerFormId: kept.speakerFormId ?? next.speakerFormId,
  speakerName: kept.speakerName ?? next.speakerName,
  previousInfoFormId: kept.previousInfoFormId ?? next.previousInfoFormId,
});

/**
 * One INFO produces several import rows: one per translatable subrecord
 * (NAM1 response, RNAM prompt, …) and one per imported locale. They all map to
 * a single dialog node, and PostgreSQL rejects duplicate ON CONFLICT keys in a
 * single INSERT, so collapse them into one row that keeps every known field.
 */
export const dedupeDialogInfoRowsForImport = (
  rows: DialogInfoImportRow[],
): DialogInfoImportRow[] => {
  const byKey = new Map<string, DialogInfoImportRow>();

  for (const row of rows) {
    const key = dialogInfoImportKey(row.topicFormId, row.infoFormId);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeDialogInfoImportRow(existing, row) : row);
  }

  return [...byKey.values()];
};

/** Bulk upsert DIAL/INFO dialog graph rows for one import batch (replaces per-row upserts). */
export const bulkUpsertDialogGraphForImportBatch = async (
  db: Tx,
  modId: number,
  results: ModImportBulkResult[],
  ctx: DialogGraphImportContext,
): Promise<void> => {
  const rawInfoRows: DialogInfoImportRow[] = [];
  for (const res of results) {
    const row = res.row.csvRow;
    if (row.Signature !== 'INFO' || !row.FormID || !row.DialogTopicFormID) continue;

    const speakerFormId = row.SpeakerFormID ?? ctx.speakerMap.get(row.FormID) ?? null;
    const speakerName = res.row.context ?? ctx.voiceSpeakerMap.get(row.FormID.substring(2)) ?? null;

    rawInfoRows.push({
      topicFormId: row.DialogTopicFormID,
      infoFormId: row.FormID,
      speakerFormId,
      speakerName,
      previousInfoFormId: row.PreviousInfoFormID ?? null,
    });
  }

  const infoRows = dedupeDialogInfoRowsForImport(rawInfoRows);

  if (infoRows.length === 0) return;

  const missingTopicFormIds = [
    ...new Set(infoRows.map((row) => row.topicFormId).filter((fid) => !ctx.topicIdCache.has(fid))),
  ];

  if (missingTopicFormIds.length > 0) {
    const modIds = missingTopicFormIds.map(() => modId);
    const edids = missingTopicFormIds.map((fid) => ctx.dialogEdidByFormId.get(fid) ?? null);
    const { rows: topicRows } = await db.query<{ id: number; formid_hex: string }>(
      `INSERT INTO dialog_topics(mod_id, formid_hex, edid)
       SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[])
       ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
         edid = COALESCE(EXCLUDED.edid, dialog_topics.edid)
       RETURNING id, formid_hex`,
      [modIds, missingTopicFormIds, edids],
    );
    for (const topic of topicRows) {
      ctx.topicIdCache.set(topic.formid_hex, topic.id);
    }
  }

  const topicIds: number[] = [];
  const infoFormIds: string[] = [];
  const speakerFormIds: Array<string | null> = [];
  const speakerNames: Array<string | null> = [];
  const previousInfoFormIds: Array<string | null> = [];

  for (const info of infoRows) {
    const topicId = ctx.topicIdCache.get(info.topicFormId);
    if (topicId == null) {
      throw new Error(`Dialog topic id missing after upsert for ${info.topicFormId}`);
    }
    topicIds.push(topicId);
    infoFormIds.push(info.infoFormId);
    speakerFormIds.push(info.speakerFormId);
    speakerNames.push(info.speakerName);
    previousInfoFormIds.push(info.previousInfoFormId);
  }

  await db.query(
    `INSERT INTO dialog_nodes(
       topic_id, info_formid_hex, speaker_formid_hex, speaker_name, previous_info_formid_hex
     )
     SELECT * FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[]
     )
     ON CONFLICT(topic_id, info_formid_hex) DO UPDATE SET
       speaker_formid_hex = COALESCE(EXCLUDED.speaker_formid_hex, dialog_nodes.speaker_formid_hex),
       speaker_name = COALESCE(EXCLUDED.speaker_name, dialog_nodes.speaker_name),
       previous_info_formid_hex = COALESCE(EXCLUDED.previous_info_formid_hex, dialog_nodes.previous_info_formid_hex),
       updated_at = NOW()`,
    [topicIds, infoFormIds, speakerFormIds, speakerNames, previousInfoFormIds],
  );

  const edgeTopicIds: number[] = [];
  const fromInfoFormIds: string[] = [];
  const toInfoFormIds: string[] = [];
  const seenEdges = new Set<string>();

  for (let i = 0; i < infoRows.length; i++) {
    const previous = infoRows[i]!.previousInfoFormId;
    if (!previous) continue;
    const topicId = topicIds[i]!;
    const toInfo = infoFormIds[i]!;
    const edgeKey = dialogEdgeImportKey(topicId, previous, toInfo, 'previous');
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edgeTopicIds.push(topicId);
    fromInfoFormIds.push(previous);
    toInfoFormIds.push(toInfo);
  }

  if (edgeTopicIds.length === 0) return;

  const edgeKinds = edgeTopicIds.map(() => 'previous');
  const confidences = edgeTopicIds.map(() => 'exact');

  await db.query(
    `INSERT INTO dialog_edges(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind, confidence)
     SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind) DO UPDATE SET
       confidence = EXCLUDED.confidence`,
    [edgeTopicIds, fromInfoFormIds, toInfoFormIds, edgeKinds, confidences],
  );
};
