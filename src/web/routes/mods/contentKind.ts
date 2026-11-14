import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { setModContentKind } from '../../data/queries';
import { isModContentKind, resolveModContentKind } from '../../services/modContentKind';

export const registerContentKindRoutes = async (app: FastifyInstance, db: Tx) => {
  // PATCH /api/mods/:id/content-kind — manual override of the kind; `kind: null` clears it.
  app.patch<{ Params: { id: string }; Body: { kind?: unknown } }>(
    '/api/mods/:id/content-kind',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      const kind = req.body?.kind;
      if (kind !== null && !isModContentKind(kind)) {
        return reply.code(400).send({ error: 'kind must be base, dlc, addon, mod or null' });
      }

      const mod = await setModContentKind(db, id, kind);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const resolved = resolveModContentKind(mod);
      return reply.send({
        id: mod.id,
        content_kind: resolved.kind,
        content_kind_manual: resolved.manual,
      });
    },
  );
};
