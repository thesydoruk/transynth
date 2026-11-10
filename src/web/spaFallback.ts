import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Routes the router did not match. A browser navigating inside the React app
 * gets `index.html`; anything else — an API call, an upload, a PUT — gets a
 * JSON 404. Answering those with the page and status 200 made a client whose
 * URL missed the route believe its upload had succeeded.
 */
export const isSpaNavigation = (method: string, url: string): boolean => {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = url.split('?')[0] ?? '';
  return !/^\/api(\/|$)/.test(pathname);
};

export const spaNotFoundHandler = (req: FastifyRequest, reply: FastifyReply) => {
  if (isSpaNavigation(req.method, req.url)) return reply.sendFile('index.html');
  return reply.code(404).send({ error: `Not found: ${req.method} ${req.url.split('?')[0]}` });
};
