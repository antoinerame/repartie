import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const APP_PASSWORD = process.env.APP_PASSWORD || '';
export const MCP_TOKEN = process.env.MCP_TOKEN || '';
const COOKIE = 'repartie_session';

function sessionValue() {
  return crypto.createHmac('sha256', APP_PASSWORD).update('repartie-session-v1').digest('hex');
}

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function isAuthed(req: Request) {
  if (!APP_PASSWORD) return true;
  const c = readCookie(req, COOKIE);
  return !!c && safeEqual(c, sessionValue());
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Non connecté' });
}

// Anti force brute très simple : 8 essais ratés → 5 minutes de blocage par IP.
const fails = new Map<string, { n: number; until: number }>();

export function login(req: Request, res: Response) {
  const ip = req.ip || 'x';
  const f = fails.get(ip);
  if (f && f.until > Date.now()) {
    res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!APP_PASSWORD || safeEqual(password, APP_PASSWORD)) {
    fails.delete(ip);
    if (APP_PASSWORD) {
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie',
        `${COOKIE}=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure ? '; Secure' : ''}`);
    }
    res.json({ ok: true });
    return;
  }
  const n = (f?.n ?? 0) + 1;
  fails.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60 * 1000 : 0 });
  res.status(401).json({ error: 'Mot de passe incorrect' });
}

export function logout(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}

/** Le MCP accepte « Authorization: Bearer <MCP_TOKEN> » ou le jeton dans le chemin (/mcp/<MCP_TOKEN>). */
export function mcpAllowed(req: Request, pathToken?: string) {
  if (!MCP_TOKEN) return !APP_PASSWORD; // sans jeton : ouvert seulement si le site lui-même est ouvert (dev local)
  const header = req.headers.authorization || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  return (!!bearer && safeEqual(bearer, MCP_TOKEN)) || (!!pathToken && safeEqual(pathToken, MCP_TOKEN));
}
