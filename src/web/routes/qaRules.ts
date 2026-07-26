import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';

/**
 * QA rules CRUD routes.
 *
 * Each rule represents a configurable validation check (forbidden characters or
 * maximum length) that is applied during translation QA.  Rules can be scoped to
 * a specific record signature (GRUP) and/or path (field) so that different parts
 * of the game data can have independent constraints.
 */
export const qaRulesRoutes = async (app: FastifyInstance, db: Tx) => {
  /** Allowed rule_type values for validation. */
  const VALID_RULE_TYPES = ['forbidden_chars', 'max_length'] as const;
  /** Allowed severity values for validation. */
  const VALID_SEVERITIES = ['warning', 'error'] as const;

  // ── GET /api/qa-rules — list all rules (optionally filtered) ────────────
  app.get<{ Querystring: { game?: string; ruleType?: string; isActive?: string } }>(
    '/api/qa-rules',
    async (req, reply) => {
      const { game, ruleType, isActive } = req.query;
      log.debug(`GET /api/qa-rules game=${game} ruleType=${ruleType} isActive=${isActive}`);

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (game) {
        conditions.push(`game = $${params.length + 1}`);
        params.push(game);
      }
      if (ruleType) {
        conditions.push(`rule_type = $${params.length + 1}`);
        params.push(ruleType);
      }
      if (isActive !== undefined) {
        conditions.push(`is_active = $${params.length + 1}`);
        params.push(isActive === 'true');
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await db.query(
        `SELECT id, game, rule_type, signature, path, value, severity, description, is_active, created_at, updated_at
         FROM qa_rules ${where}
         ORDER BY rule_type, signature NULLS LAST, path NULLS LAST`,
        params,
      );

      return reply.send(rows);
    },
  );

  // ── GET /api/qa-rules/:id — get a single rule by id ────────────────────
  app.get<{ Params: { id: string } }>('/api/qa-rules/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query(
      `SELECT id, game, rule_type, signature, path, value, severity, description, is_active, created_at, updated_at
       FROM qa_rules WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' });

    return reply.send(rows[0]);
  });

  // ── POST /api/qa-rules — create a new rule ─────────────────────────────
  app.post<{
    Body: {
      game?: string;
      rule_type: string;
      signature?: string | null;
      path?: string | null;
      value: string;
      severity?: string;
      description?: string | null;
      is_active?: boolean;
    };
  }>('/api/qa-rules', async (req, reply) => {
    const body = req.body ?? ({} as Record<string, unknown>);
    const {
      game = 'fo4',
      rule_type,
      signature = null,
      path = null,
      value,
      severity = 'error',
      description = null,
      is_active = true,
    } = body;

    // Validate required fields
    if (!rule_type || !value) {
      return reply.code(400).send({ error: 'rule_type and value are required' });
    }
    if (!(VALID_RULE_TYPES as readonly string[]).includes(rule_type)) {
      return reply
        .code(400)
        .send({ error: `rule_type must be one of: ${VALID_RULE_TYPES.join(', ')}` });
    }
    if (!(VALID_SEVERITIES as readonly string[]).includes(severity)) {
      return reply
        .code(400)
        .send({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    // For max_length rules, value must be a positive integer
    if (rule_type === 'max_length') {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return reply
          .code(400)
          .send({ error: 'For max_length rules, value must be a positive integer' });
      }
    }

    log.info(
      `POST /api/qa-rules type=${rule_type} sig=${signature ?? '*'} path=${path ?? '*'} value="${value}"`,
    );

    const { rows } = await db.query(
      `INSERT INTO qa_rules(game, rule_type, signature, path, value, severity, description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, game, rule_type, signature, path, value, severity, description, is_active, created_at, updated_at`,
      [
        game,
        rule_type,
        signature || null,
        path || null,
        value,
        severity,
        description || null,
        is_active,
      ],
    );

    return reply.code(201).send(rows[0]);
  });

  // ── PUT /api/qa-rules/:id — update an existing rule ────────────────────
  app.put<{
    Params: { id: string };
    Body: {
      game?: string;
      rule_type?: string;
      signature?: string | null;
      path?: string | null;
      value?: string;
      severity?: string;
      description?: string | null;
      is_active?: boolean;
    };
  }>('/api/qa-rules/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body ?? ({} as Record<string, unknown>);

    // Validate rule_type if provided
    if (
      body.rule_type !== undefined &&
      !(VALID_RULE_TYPES as readonly string[]).includes(body.rule_type)
    ) {
      return reply
        .code(400)
        .send({ error: `rule_type must be one of: ${VALID_RULE_TYPES.join(', ')}` });
    }
    if (
      body.severity !== undefined &&
      !(VALID_SEVERITIES as readonly string[]).includes(body.severity)
    ) {
      return reply
        .code(400)
        .send({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    if (body.rule_type === 'max_length' && body.value !== undefined) {
      const parsed = parseInt(body.value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return reply
          .code(400)
          .send({ error: 'For max_length rules, value must be a positive integer' });
      }
    }

    // Build dynamic SET clause from provided fields
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    const allowed = [
      'game',
      'rule_type',
      'signature',
      'path',
      'value',
      'severity',
      'description',
      'is_active',
    ] as const;

    for (const key of allowed) {
      if (key in body) {
        fields.push(`${key} = $${idx++}`);
        // Normalize empty string to null for nullable text fields
        const val = body[key as keyof typeof body];
        params.push(
          (key === 'signature' || key === 'path' || key === 'description') && val === ''
            ? null
            : (val ?? null),
        );
      }
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await db.query(
      `UPDATE qa_rules SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, game, rule_type, signature, path, value, severity, description, is_active, created_at, updated_at`,
      params,
    );

    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  // ── DELETE /api/qa-rules/:id — delete a rule ───────────────────────────
  app.delete<{ Params: { id: string } }>('/api/qa-rules/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const result = await db.query(`DELETE FROM qa_rules WHERE id = $1`, [id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Not found' });

    log.info(`DELETE /api/qa-rules/${id}`);
    return reply.send({ ok: true });
  });
};
