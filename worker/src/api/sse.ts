/**
 * Open a Server-Sent Events response for a long-running job.
 *
 * The HTTP connection stays open for hours; the job itself lives in the worker
 * and keeps going if the client disconnects. `hijack()` takes the raw socket
 * away from Fastify so we can write SSE frames by hand.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export type SseStream = {
  send: (data: object) => void;
  end: () => void;
  /** Fires when the client goes away; the job keeps running in the worker. */
  onClose: (handler: () => void) => void;
};

export const openSseStream = (req: FastifyRequest, reply: FastifyReply): SseStream => {
  // Jobs can run for hours — disable the socket idle timeout.
  req.raw.socket.setTimeout(0);
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // nginx (and similar) must not buffer the stream into one big response.
    'X-Accel-Buffering': 'no',
  });

  return {
    send: (data) => {
      try {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
          const raw = reply.raw as typeof reply.raw & { flush?: () => void };
          raw.flush?.();
        }
      } catch {
        /* client disconnected — job continues in the worker */
      }
    },
    end: () => {
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    },
    onClose: (handler) => {
      reply.raw.on('close', handler);
    },
  };
};
