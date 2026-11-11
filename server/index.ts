import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import './db.ts';
import * as repo from './repo.ts';
import { APP_PASSWORD, MCP_TOKEN, isAuthed, login, logout, mcpAllowed, requireAuth } from './auth.ts';
import { buildMcpServer } from './mcp.ts';
import { seedIfEmpty } from './seed.ts';

seedIfEmpty();

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

/* ---------- MCP (Streamable HTTP, sans état) ---------- */
async function handleMcp(req: Request, res: Response) {
  if (!mcpAllowed(req, req.params.token as string | undefined)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Jeton MCP manquant ou invalide' }, id: null });
    return;
  }
  const server = buildMcpServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('Erreur MCP :', e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne' }, id: null });
    }
  }
}
const mcpNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée' }, id: null });
};
for (const p of ['/mcp', '/mcp/:token']) {
  app.post(p, handleMcp);
  app.get(p, mcpNotAllowed);
  app.delete(p, mcpNotAllowed);
}

/* ---------- auth ---------- */
app.get('/api/me', (req, res) => {
  res.json({ authRequired: !!APP_PASSWORD, authed: isAuthed(req), mcpTokenSet: !!MCP_TOKEN });
});
app.post('/api/login', login);
app.post('/api/logout', logout);

const api = express.Router();
api.use(requireAuth);
const id = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n)) throw new repo.HttpError(400, 'Identifiant invalide');
  return n;
};
const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));

api.get('/overview', (_req, res) => res.json(repo.overview()));
api.post('/topics', (req, res) => res.json(repo.createTopic(req.body)));
api.get('/topics/:id', (req, res) => res.json(repo.getTopic(id(req))));
api.patch('/topics/:id', (req, res) => { repo.updateTopic(id(req), req.body); res.json({ ok: true }); });
api.delete('/topics/:id', (req, res) => { repo.deleteTopic(id(req)); res.json({ ok: true }); });

api.post('/subtopics', (req, res) => res.json(repo.createSubtopic(req.body)));
api.get('/subtopics/:id', (req, res) => res.json(repo.getSubtopic(id(req))));
api.patch('/subtopics/:id', (req, res) => { repo.updateSubtopic(id(req), req.body); res.json({ ok: true }); });
api.delete('/subtopics/:id', (req, res) => { repo.deleteSubtopic(id(req)); res.json({ ok: true }); });
api.post('/subtopics/:id/flip', (req, res) => { repo.flipSubtopic(id(req)); res.json({ ok: true }); });

api.post('/arguments', (req, res) => res.json(repo.createArgument(req.body)));
api.patch('/arguments/:id', (req, res) => res.json(repo.updateArgument(id(req), req.body)));
api.delete('/arguments/:id', (req, res) => res.json(repo.deleteArgument(id(req))));
api.post('/arguments/:id/move', (req, res) => res.json(repo.moveArgument(id(req), req.body)));
api.post('/arguments/:id/grade', (req, res) => res.json(repo.gradeArgument(id(req), Number(req.body?.grade))));

api.get('/search', (req, res) => res.json(repo.search(String(req.query.q ?? ''))));
api.get('/gaps', (req, res) => res.json(repo.gaps({ topicId: num(req.query.topicId), subtopicId: num(req.query.subtopicId) })));
api.get('/unsourced', (req, res) => res.json(repo.unsourced({ topicId: num(req.query.topicId), subtopicId: num(req.query.subtopicId) })));
api.get('/backers', (_req, res) => res.json(repo.backerNames()));

api.get('/principles', (_req, res) => res.json(repo.listPrinciples()));
api.post('/principles', (req, res) => res.json(repo.createPrinciple(req.body)));
api.get('/principles/:id', (req, res) => res.json(repo.getPrinciple(id(req))));
api.patch('/principles/:id', (req, res) => { repo.updatePrinciple(id(req), req.body); res.json({ ok: true }); });
api.delete('/principles/:id', (req, res) => { repo.deletePrinciple(id(req)); res.json({ ok: true }); });
api.get('/training', (req, res) => res.json(repo.trainingCards({
  topicId: num(req.query.topicId), subtopicId: num(req.query.subtopicId),
  limit: num(req.query.limit), includeGaps: req.query.gaps === '1',
})));

api.get('/export', (_req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="repartie-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(repo.exportAll());
});
api.post('/import', (req, res) => res.json(repo.importAll(req.body?.data, req.body?.mode === 'replace' ? 'replace' : 'merge')));

// Flux d'événements : l'interface se rafraîchit quand Claude écrit via le MCP.
api.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  let timer: NodeJS.Timeout | null = null;
  const off = repo.onChange(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; res.write('data: change\n\n'); }, 150);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { off(); clearInterval(ping); if (timer) clearTimeout(timer); });
});

app.use('/api', api);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Route inconnue' }); });

/* ---------- interface ---------- */
const webDir = [path.resolve(process.cwd(), 'dist/web'), path.resolve(import.meta.dirname ?? '.', 'web')]
  .find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status ?? (err?.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Répartie écoute sur http://localhost:${PORT}`);
  if (!APP_PASSWORD) console.warn('⚠ APP_PASSWORD non défini : le site est accessible sans mot de passe.');
  if (!MCP_TOKEN) console.warn(APP_PASSWORD
    ? '⚠ MCP_TOKEN non défini : le point d’accès MCP est désactivé.'
    : '⚠ MCP_TOKEN non défini : le point d’accès MCP est ouvert à tous.');
});
