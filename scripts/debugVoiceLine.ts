#!/usr/bin/env tsx
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';

const db = openDb();
try {
  const { rows } = await db.query<{ tr: string; src: string; formid: string }>(
    `SELECT dn.info_formid_hex AS formid, s.text_raw AS src, t.text AS tr
     FROM dialog_nodes dn
     JOIN strings s ON s.id = dn.response_string_id
     JOIN LATERAL (
       SELECT text FROM translations
       WHERE src_string_id = s.id AND target_lang = 'uk'
       ORDER BY CASE status
         WHEN 'skip' THEN 0 WHEN 'draft' THEN 1 WHEN 'reviewed' THEN 2
         WHEN 'human' THEN 3 WHEN 'tm' THEN 4 WHEN 'fuzzy' THEN 5
         WHEN 'auto' THEN 6 WHEN 'rejected' THEN 7 ELSE 8 END,
         COALESCE(confidence, 0) DESC, created_at DESC
       LIMIT 1
     ) t ON TRUE
     WHERE UPPER(SUBSTRING(dn.info_formid_hex FROM 3)) = '01EFF'
     LIMIT 5`,
  );
  for (const row of rows) {
    console.log('FORMID:', row.formid);
    console.log('SRC:', row.src);
    console.log('TR :', row.tr);
    console.log(
      'codepoints:',
      [...row.tr].map((c) => `${c}(U+${c.codePointAt(0)!.toString(16).toUpperCase()})`).join(' '),
    );
    console.log('---');
  }
} finally {
  await closeDb();
}
