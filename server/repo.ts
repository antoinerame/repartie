import { all, get, run, tx } from './db.ts';

export type Side = 'moi' | 'autre';
export type Kind = 'fait' | 'valeur' | 'exemple' | 'sophisme';
export interface Source { label: string; url?: string; date?: string }

export interface Arg {
  id: number;
  subtopicId: number;
  parentId: number | null;
  side: Side;
  title: string;
  body: string;
  kind: Kind;
  strength: number;
  concede: boolean;
  sources: Source[];
  refId: number | null;
  refFrom: { subtopicId: number; subtopicTitle: string; topicTitle: string } | null;
  usedCount: number;
  position: number;
  box: number;
  dueAt: string | null;
  reviews: number;
  isGap: boolean;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ---------- change notifications (SSE) ---------- */
const listeners = new Set<() => void>();
export function onChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* ignore */ }
  }
}

/* ---------- helpers ---------- */
const ARG_SELECT = `
SELECT a.id, a.subtopic_id, a.parent_id, a.side, a.concede, a.ref_id, a.position, a.box, a.due_at, a.reviews,
  COALESCE(r.title, a.title) AS title,
  COALESCE(r.body, a.body) AS body,
  COALESCE(r.kind, a.kind) AS kind,
  COALESCE(r.strength, a.strength) AS strength,
  COALESCE(r.sources, a.sources) AS sources,
  r.subtopic_id AS ref_sub_id, rs.title AS ref_sub_title, rt.title AS ref_topic_title,
  (SELECT COUNT(*) FROM arguments u WHERE u.ref_id = a.id) AS used_count,
  (a.side = 'autre' AND a.concede = 0 AND NOT EXISTS (
     SELECT 1 FROM arguments c WHERE c.parent_id = a.id AND c.side = 'moi')) AS is_gap
FROM arguments a
LEFT JOIN arguments r ON r.id = a.ref_id
LEFT JOIN subtopics rs ON rs.id = r.subtopic_id
LEFT JOIN topics rt ON rt.id = rs.topic_id`;

function parseSources(raw: string): Source[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toArg(r: any): Arg {
  return {
    id: r.id,
    subtopicId: r.subtopic_id,
    parentId: r.parent_id,
    side: r.side,
    title: r.title,
    body: r.body,
    kind: r.kind,
    strength: r.strength,
    concede: !!r.concede,
    sources: parseSources(r.sources),
    refId: r.ref_id,
    refFrom: r.ref_id && r.ref_sub_id
      ? { subtopicId: r.ref_sub_id, subtopicTitle: r.ref_sub_title, topicTitle: r.ref_topic_title }
      : null,
    usedCount: r.used_count,
    position: r.position,
    box: r.box,
    dueAt: r.due_at,
    reviews: r.reviews,
    isGap: !!r.is_gap,
  };
}

function cleanSources(input: unknown): Source[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s: any) => (typeof s === 'string' ? { label: s } : s))
    .filter((s: any) => s && typeof s.label === 'string' && s.label.trim())
    .map((s: any) => {
      const out: Source = { label: String(s.label).trim().slice(0, 500) };
      if (s.url && /^https?:\/\//i.test(String(s.url))) out.url = String(s.url).trim();
      if (s.date) out.date = String(s.date).trim().slice(0, 40);
      return out;
    });
}

const KINDS: Kind[] = ['fait', 'valeur', 'exemple', 'sophisme'];
function str(v: unknown, max = 4000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function need<T>(v: T | undefined, what: string): T {
  if (!v) throw new HttpError(404, `${what} introuvable`);
  return v;
}

const SUB_STATS = `
SELECT s.id,
  (SELECT COUNT(*) FROM arguments a WHERE a.subtopic_id = s.id) AS arg_count,
  (SELECT COUNT(*) FROM arguments a WHERE a.subtopic_id = s.id AND a.side = 'autre' AND a.concede = 0
     AND NOT EXISTS (SELECT 1 FROM arguments c WHERE c.parent_id = a.id AND c.side = 'moi')) AS gap_count,
  (SELECT COUNT(*) FROM arguments a WHERE a.subtopic_id = s.id AND a.side = 'autre'
     AND EXISTS (SELECT 1 FROM arguments c WHERE c.parent_id = a.id AND c.side = 'moi')) AS train_count,
  (SELECT COUNT(*) FROM arguments a WHERE a.subtopic_id = s.id AND a.side = 'autre' AND a.box >= 3
     AND EXISTS (SELECT 1 FROM arguments c WHERE c.parent_id = a.id AND c.side = 'moi')) AS mastered_count
FROM subtopics s`;

/* ---------- topics ---------- */
export function overview() {
  const topics = all(`SELECT * FROM topics ORDER BY position, id`);
  const subs = all(`SELECT s.id, s.topic_id, s.title FROM subtopics s ORDER BY s.position, s.id`);
  const stats = new Map(all(SUB_STATS).map((r: any) => [r.id, r]));
  return topics.map((t: any) => {
    const mine = subs.filter((s: any) => s.topic_id === t.id);
    const sum = (k: string) => mine.reduce((n: number, s: any) => n + (stats.get(s.id)?.[k] ?? 0), 0);
    return {
      id: t.id, title: t.title, description: t.description, emoji: t.emoji,
      subtopics: mine.map((s: any) => ({ id: s.id, title: s.title })),
      argCount: sum('arg_count'), gapCount: sum('gap_count'),
      trainCount: sum('train_count'), masteredCount: sum('mastered_count'),
    };
  });
}

export function getTopic(id: number) {
  const t: any = need(get(`SELECT * FROM topics WHERE id = ?`, id), 'Sujet');
  const subs = all(`${SUB_STATS} WHERE s.topic_id = ?`, id);
  const stats = new Map(subs.map((r: any) => [r.id, r]));
  const rows = all(`SELECT * FROM subtopics WHERE topic_id = ? ORDER BY position, id`, id);
  return {
    id: t.id, title: t.title, description: t.description, emoji: t.emoji,
    subtopics: rows.map((s: any) => ({
      id: s.id, title: s.title, description: s.description,
      argCount: stats.get(s.id)?.arg_count ?? 0,
      gapCount: stats.get(s.id)?.gap_count ?? 0,
      trainCount: stats.get(s.id)?.train_count ?? 0,
      masteredCount: stats.get(s.id)?.mastered_count ?? 0,
    })),
  };
}

export function createTopic(input: { title: string; description?: string; emoji?: string }) {
  const title = str(input.title, 200);
  if (!title) throw new HttpError(400, 'Le titre est obligatoire');
  const pos = (get<any>(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM topics`)!).p;
  const r = run(`INSERT INTO topics (title, description, emoji, position) VALUES (?, ?, ?, ?)`,
    title, str(input.description, 1000), str(input.emoji, 8) || '💬', pos);
  notify();
  return { id: Number(r.lastInsertRowid), title };
}

export function updateTopic(id: number, patch: { title?: string; description?: string; emoji?: string }) {
  const t: any = need(get(`SELECT * FROM topics WHERE id = ?`, id), 'Sujet');
  run(`UPDATE topics SET title = ?, description = ?, emoji = ? WHERE id = ?`,
    patch.title !== undefined ? str(patch.title, 200) || t.title : t.title,
    patch.description !== undefined ? str(patch.description, 1000) : t.description,
    patch.emoji !== undefined ? str(patch.emoji, 8) || t.emoji : t.emoji,
    id);
  notify();
}

export function deleteTopic(id: number) {
  need(get(`SELECT id FROM topics WHERE id = ?`, id), 'Sujet');
  tx(() => {
    materializeLinks(`SELECT a.id FROM arguments a JOIN subtopics s ON s.id = a.subtopic_id WHERE s.topic_id = ${Number(id)}`);
    run(`DELETE FROM topics WHERE id = ?`, id);
  });
  notify();
}

/* ---------- subtopics ---------- */
export function createSubtopic(input: { topicId: number; title: string; description?: string }) {
  need(get(`SELECT id FROM topics WHERE id = ?`, input.topicId), 'Sujet');
  const title = str(input.title, 300);
  if (!title) throw new HttpError(400, 'Le titre est obligatoire');
  const pos = (get<any>(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM subtopics WHERE topic_id = ?`, input.topicId)!).p;
  const r = run(`INSERT INTO subtopics (topic_id, title, description, position) VALUES (?, ?, ?, ?)`,
    input.topicId, title, str(input.description, 1000), pos);
  notify();
  return { id: Number(r.lastInsertRowid), title };
}

export function updateSubtopic(id: number, patch: { title?: string; description?: string }) {
  const s: any = need(get(`SELECT * FROM subtopics WHERE id = ?`, id), 'Sous-partie');
  run(`UPDATE subtopics SET title = ?, description = ? WHERE id = ?`,
    patch.title !== undefined ? str(patch.title, 300) || s.title : s.title,
    patch.description !== undefined ? str(patch.description, 1000) : s.description,
    id);
  notify();
}

export function deleteSubtopic(id: number) {
  need(get(`SELECT id FROM subtopics WHERE id = ?`, id), 'Sous-partie');
  tx(() => {
    materializeLinks(`SELECT id FROM arguments WHERE subtopic_id = ${Number(id)}`);
    run(`DELETE FROM subtopics WHERE id = ?`, id);
  });
  notify();
}

export function getSubtopic(id: number) {
  const s: any = need(get(
    `SELECT s.*, t.title AS topic_title, t.emoji AS topic_emoji FROM subtopics s JOIN topics t ON t.id = s.topic_id WHERE s.id = ?`, id),
    'Sous-partie');
  const args = all(`${ARG_SELECT} WHERE a.subtopic_id = ? ORDER BY a.position, a.id`, id).map(toArg);
  return {
    id: s.id, title: s.title, description: s.description,
    topic: { id: s.topic_id, title: s.topic_title, emoji: s.topic_emoji },
    arguments: args,
  };
}

/** « J'ai changé d'avis » : inverse les camps de toute la sous-partie. */
export function flipSubtopic(id: number) {
  need(get(`SELECT id FROM subtopics WHERE id = ?`, id), 'Sous-partie');
  run(`UPDATE arguments SET side = CASE side WHEN 'moi' THEN 'autre' ELSE 'moi' END,
       concede = 0, box = 0, due_at = NULL WHERE subtopic_id = ?`, id);
  notify();
}

/* ---------- arguments ---------- */
export interface ArgInput {
  subtopicId?: number;
  parentId?: number | null;
  side?: Side;
  title?: string;
  body?: string;
  kind?: Kind;
  strength?: number;
  concede?: boolean;
  sources?: unknown;
  refId?: number | null;
}

export function getArgument(id: number): Arg {
  return toArg(need(get(`${ARG_SELECT} WHERE a.id = ?`, id), 'Argument'));
}

function insertArgument(input: ArgInput): number {
  let subtopicId = input.subtopicId;
  let parent: any = null;
  if (input.parentId) {
    parent = need(get(`SELECT id, subtopic_id, side FROM arguments WHERE id = ?`, input.parentId), 'Argument parent');
    subtopicId = parent.subtopic_id;
  }
  if (!subtopicId) throw new HttpError(400, 'subtopicId ou parentId est obligatoire');
  need(get(`SELECT id FROM subtopics WHERE id = ?`, subtopicId), 'Sous-partie');

  const side: Side = input.side === 'moi' || input.side === 'autre'
    ? input.side
    : parent ? (parent.side === 'moi' ? 'autre' : 'moi') : 'moi';

  let refId: number | null = null;
  if (input.refId) {
    const target: any = need(get(`SELECT id, ref_id FROM arguments WHERE id = ?`, input.refId), 'Argument à réutiliser');
    refId = target.ref_id ?? target.id; // jamais de lien vers un lien
  }
  const title = str(input.title, 300);
  if (!refId && !title) throw new HttpError(400, 'La phrase choc (title) est obligatoire');

  const pos = (get<any>(
    `SELECT COALESCE(MAX(position), 0) + 1 AS p FROM arguments WHERE subtopic_id = ? AND parent_id IS ?`,
    subtopicId, parent?.id ?? null)!).p;
  const r = run(
    `INSERT INTO arguments (subtopic_id, parent_id, side, title, body, kind, strength, concede, sources, ref_id, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    subtopicId, parent?.id ?? null, side, title, str(input.body),
    KINDS.includes(input.kind as Kind) ? input.kind! : 'fait',
    [1, 2, 3].includes(Number(input.strength)) ? Number(input.strength) : 2,
    input.concede ? 1 : 0, JSON.stringify(cleanSources(input.sources)), refId, pos);
  return Number(r.lastInsertRowid);
}

export function createArgument(input: ArgInput): Arg {
  const id = insertArgument(input);
  notify();
  return getArgument(id);
}

export interface BulkItem extends ArgInput { tempId?: string; parentTempId?: string }

/** Ajoute plusieurs arguments d'un coup ; parentTempId permet de chaîner des nœuds créés dans le même appel. */
export function createArguments(subtopicId: number | undefined, items: BulkItem[]): Arg[] {
  const ids = tx(() => {
    const map = new Map<string, number>();
    const out: number[] = [];
    for (const it of items) {
      let parentId = it.parentId ?? null;
      if (it.parentTempId) {
        const p = map.get(it.parentTempId);
        if (!p) throw new HttpError(400, `parent_temp_id inconnu : "${it.parentTempId}" (le parent doit apparaître avant ses enfants dans la liste)`);
        parentId = p;
      }
      const id = insertArgument({ ...it, parentId, subtopicId: it.subtopicId ?? subtopicId });
      if (it.tempId) map.set(it.tempId, id);
      out.push(id);
    }
    return out;
  });
  notify();
  return ids.map(getArgument);
}

export function updateArgument(id: number, patch: ArgInput): Arg {
  const a: any = need(get(`SELECT * FROM arguments WHERE id = ?`, id), 'Argument');
  tx(() => {
    // Le contenu d'un argument réutilisé vit dans l'argument d'origine.
    const contentId = a.ref_id ?? id;
    const c: any = a.ref_id ? get(`SELECT * FROM arguments WHERE id = ?`, a.ref_id) : a;
    const title = patch.title !== undefined ? str(patch.title, 300) || c.title : c.title;
    run(`UPDATE arguments SET title = ?, body = ?, kind = ?, strength = ?, sources = ?, updated_at = datetime('now') WHERE id = ?`,
      title,
      patch.body !== undefined ? str(patch.body) : c.body,
      patch.kind !== undefined && KINDS.includes(patch.kind) ? patch.kind : c.kind,
      patch.strength !== undefined && [1, 2, 3].includes(Number(patch.strength)) ? Number(patch.strength) : c.strength,
      patch.sources !== undefined ? JSON.stringify(cleanSources(patch.sources)) : c.sources,
      contentId);
    run(`UPDATE arguments SET side = ?, concede = ?, updated_at = datetime('now') WHERE id = ?`,
      patch.side === 'moi' || patch.side === 'autre' ? patch.side : a.side,
      patch.concede !== undefined ? (patch.concede ? 1 : 0) : a.concede,
      id);
  });
  notify();
  return getArgument(id);
}

function subtreeIds(id: number): number[] {
  return all<any>(
    `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT a.id FROM arguments a JOIN sub ON a.parent_id = sub.id)
     SELECT id FROM sub`, id).map((r) => r.id);
}

/** Avant de supprimer des arguments, recopie leur contenu dans les liens qui pointent dessus. */
function materializeLinks(idsSql: string) {
  run(`UPDATE arguments SET
         title = (SELECT title FROM arguments r WHERE r.id = arguments.ref_id),
         body = (SELECT body FROM arguments r WHERE r.id = arguments.ref_id),
         kind = (SELECT kind FROM arguments r WHERE r.id = arguments.ref_id),
         strength = (SELECT strength FROM arguments r WHERE r.id = arguments.ref_id),
         sources = (SELECT sources FROM arguments r WHERE r.id = arguments.ref_id),
         ref_id = NULL
       WHERE ref_id IN (${idsSql}) AND id NOT IN (${idsSql})`);
}

export function deleteArgument(id: number) {
  need(get(`SELECT id FROM arguments WHERE id = ?`, id), 'Argument');
  const ids = subtreeIds(id);
  tx(() => {
    materializeLinks(ids.join(','));
    run(`DELETE FROM arguments WHERE id = ?`, id);
  });
  notify();
  return { deleted: ids.length };
}

export function moveArgument(id: number, to: { parentId?: number | null; subtopicId?: number }) {
  const a: any = need(get(`SELECT * FROM arguments WHERE id = ?`, id), 'Argument');
  const ids = subtreeIds(id);
  let subtopicId = a.subtopic_id;
  let parentId: number | null = null;
  if (to.parentId) {
    if (ids.includes(to.parentId)) throw new HttpError(400, 'Impossible de déplacer un argument sous lui-même');
    const p: any = need(get(`SELECT id, subtopic_id FROM arguments WHERE id = ?`, to.parentId), 'Nouveau parent');
    parentId = p.id;
    subtopicId = p.subtopic_id;
  } else if (to.subtopicId) {
    need(get(`SELECT id FROM subtopics WHERE id = ?`, to.subtopicId), 'Sous-partie');
    subtopicId = to.subtopicId;
  }
  tx(() => {
    const pos = (get<any>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS p FROM arguments WHERE subtopic_id = ? AND parent_id IS ?`,
      subtopicId, parentId)!).p;
    run(`UPDATE arguments SET parent_id = ?, position = ? WHERE id = ?`, parentId, pos, id);
    run(`UPDATE arguments SET subtopic_id = ? WHERE id IN (${ids.join(',')})`, subtopicId);
  });
  notify();
  return getArgument(id);
}

/* ---------- search & gaps ---------- */
function like(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

export function search(q: string, limit = 30) {
  q = q.trim();
  if (!q) return { topics: [], subtopics: [], arguments: [] };
  const l = like(q);
  const topics = all(`SELECT id, title, emoji FROM topics WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 8`, l, l);
  const subtopics = all(
    `SELECT s.id, s.title, t.title AS topicTitle, t.emoji FROM subtopics s JOIN topics t ON t.id = s.topic_id
     WHERE s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' LIMIT 8`, l, l);
  const args = all(
    `SELECT a.id, a.subtopic_id AS subtopicId, a.side, a.title, a.body, a.kind, s.title AS subtopicTitle, t.title AS topicTitle
     FROM arguments a JOIN subtopics s ON s.id = a.subtopic_id JOIN topics t ON t.id = s.topic_id
     WHERE a.ref_id IS NULL AND (a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\' OR a.sources LIKE ? ESCAPE '\\')
     ORDER BY a.updated_at DESC LIMIT ?`, l, l, l, limit);
  return { topics, subtopics, arguments: args };
}

export function gaps(filter: { topicId?: number; subtopicId?: number } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.subtopicId) { where.push('a.subtopic_id = ?'); params.push(filter.subtopicId); }
  if (filter.topicId) { where.push('s.topic_id = ?'); params.push(filter.topicId); }
  const rows = all(
    `SELECT a.id AS arg_id FROM (${ARG_SELECT}) a JOIN subtopics s ON s.id = a.subtopic_id JOIN topics t ON t.id = s.topic_id
     WHERE a.is_gap = 1 ${where.length ? 'AND ' + where.join(' AND ') : ''}
     ORDER BY t.position, t.id, s.position, s.id, a.strength DESC`, ...params);
  return rows.map((r: any) => {
    const arg = getArgument(r.arg_id);
    const sub: any = get(`SELECT s.id, s.title, t.id AS topic_id, t.title AS topic_title, t.emoji FROM subtopics s JOIN topics t ON t.id = s.topic_id WHERE s.id = ?`, arg.subtopicId);
    return {
      argument: arg,
      path: pathOf(arg.id),
      subtopic: { id: sub.id, title: sub.title },
      topic: { id: sub.topic_id, title: sub.topic_title, emoji: sub.emoji },
    };
  });
}

/** Chaîne des ancêtres (du plus ancien au parent direct). */
export function pathOf(id: number): { id: number; side: Side; title: string }[] {
  const rows = all<any>(
    `WITH RECURSIVE up(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM arguments WHERE id = ?
       UNION ALL SELECT a.id, a.parent_id, up.depth + 1 FROM arguments a JOIN up ON a.id = up.parent_id)
     SELECT a.id, a.side, COALESCE(r.title, a.title) AS title, up.depth
     FROM up JOIN arguments a ON a.id = up.id LEFT JOIN arguments r ON r.id = a.ref_id
     WHERE up.depth > 0 ORDER BY up.depth DESC`, id);
  return rows.map((r) => ({ id: r.id, side: r.side, title: r.title }));
}

/* ---------- training ---------- */
const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

export function trainingCards(opts: { topicId?: number; subtopicId?: number; limit?: number; includeGaps?: boolean }) {
  const where: string[] = [`a.side = 'autre'`, `a.concede = 0`];
  const params: any[] = [];
  if (opts.subtopicId) { where.push('a.subtopic_id = ?'); params.push(opts.subtopicId); }
  if (opts.topicId) { where.push('s.topic_id = ?'); params.push(opts.topicId); }
  if (!opts.includeGaps) where.push(`EXISTS (SELECT 1 FROM arguments c WHERE c.parent_id = a.id AND c.side = 'moi')`);
  const now = new Date().toISOString();
  const rows = all<any>(
    `SELECT a.id FROM arguments a JOIN subtopics s ON s.id = a.subtopic_id
     WHERE ${where.join(' AND ')}
     ORDER BY (a.due_at IS NULL OR a.due_at <= ?) DESC, a.box ASC, COALESCE(a.due_at, '') ASC, RANDOM()
     LIMIT ?`, ...params, now, Math.min(Math.max(opts.limit ?? 10, 1), 50));
  return rows.map((r) => {
    const argument = getArgument(r.id);
    const sub: any = get(`SELECT s.id, s.title, t.title AS topic_title, t.emoji FROM subtopics s JOIN topics t ON t.id = s.topic_id WHERE s.id = ?`, argument.subtopicId);
    const responses = all(`${ARG_SELECT} WHERE a.parent_id = ? AND a.side = 'moi' ORDER BY strength DESC, a.position`, r.id).map(toArg);
    return {
      argument,
      path: pathOf(r.id),
      responses,
      subtopic: { id: sub.id, title: sub.title, topicTitle: sub.topic_title, emoji: sub.emoji },
      due: !argument.dueAt || argument.dueAt <= now,
    };
  });
}

/** grade : 0 = raté, 1 = hésitant, 2 = maîtrisé */
export function gradeArgument(id: number, grade: number) {
  const a: any = need(get(`SELECT id, box FROM arguments WHERE id = ?`, id), 'Argument');
  let box = a.box;
  let due = new Date();
  if (grade <= 0) {
    box = 0;
    due = new Date(Date.now() + 10 * 60 * 1000);
  } else if (grade === 1) {
    box = Math.max(box, 1);
    due = new Date(Date.now() + 24 * 3600 * 1000);
  } else {
    box = Math.min(box + 1, INTERVAL_DAYS.length);
    due = new Date(Date.now() + INTERVAL_DAYS[box - 1] * 24 * 3600 * 1000);
  }
  run(`UPDATE arguments SET box = ?, due_at = ?, reviews = reviews + 1 WHERE id = ?`, box, due.toISOString(), id);
  return { box, dueAt: due.toISOString() };
}

/* ---------- export / import ---------- */
export function exportAll() {
  const topics = all<any>(`SELECT * FROM topics ORDER BY position, id`);
  return {
    app: 'repartie',
    version: 1,
    exportedAt: new Date().toISOString(),
    topics: topics.map((t) => ({
      title: t.title, description: t.description, emoji: t.emoji,
      subtopics: all<any>(`SELECT * FROM subtopics WHERE topic_id = ? ORDER BY position, id`, t.id).map((s) => ({
        title: s.title, description: s.description,
        arguments: all<any>(`SELECT * FROM arguments WHERE subtopic_id = ? ORDER BY id`, s.id).map((a) => ({
          id: a.id, parentId: a.parent_id, refId: a.ref_id, side: a.side, title: a.title, body: a.body,
          kind: a.kind, strength: a.strength, concede: !!a.concede, sources: parseSources(a.sources),
          position: a.position, box: a.box, dueAt: a.due_at, reviews: a.reviews,
        })),
      })),
    })),
  };
}

export function importAll(data: any, mode: 'replace' | 'merge') {
  if (!data || data.app !== 'repartie' || !Array.isArray(data.topics)) {
    throw new HttpError(400, "Ce fichier n'est pas un export Répartie valide");
  }
  const counts = { topics: 0, subtopics: 0, arguments: 0 };
  tx(() => {
    if (mode === 'replace') run(`DELETE FROM topics`);
    let tpos = (get<any>(`SELECT COALESCE(MAX(position), 0) AS p FROM topics`)!).p;
    const idMap = new Map<number, number>();
    const pending: { newId: number; parentId: number | null; refId: number | null }[] = [];
    for (const t of data.topics) {
      const tr = run(`INSERT INTO topics (title, description, emoji, position) VALUES (?, ?, ?, ?)`,
        str(t.title, 200) || 'Sans titre', str(t.description, 1000), str(t.emoji, 8) || '💬', ++tpos);
      counts.topics++;
      let spos = 0;
      for (const s of t.subtopics ?? []) {
        const sr = run(`INSERT INTO subtopics (topic_id, title, description, position) VALUES (?, ?, ?, ?)`,
          Number(tr.lastInsertRowid), str(s.title, 300) || 'Sans titre', str(s.description, 1000), ++spos);
        counts.subtopics++;
        for (const a of s.arguments ?? []) {
          const ar = run(
            `INSERT INTO arguments (subtopic_id, side, title, body, kind, strength, concede, sources, position, box, due_at, reviews)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            Number(sr.lastInsertRowid), a.side === 'autre' ? 'autre' : 'moi', str(a.title, 300), str(a.body),
            KINDS.includes(a.kind) ? a.kind : 'fait', [1, 2, 3].includes(a.strength) ? a.strength : 2,
            a.concede ? 1 : 0, JSON.stringify(cleanSources(a.sources)), Number(a.position) || 0,
            Number(a.box) || 0, typeof a.dueAt === 'string' ? a.dueAt : null, Number(a.reviews) || 0);
          const newId = Number(ar.lastInsertRowid);
          if (typeof a.id === 'number') idMap.set(a.id, newId);
          pending.push({ newId, parentId: a.parentId ?? null, refId: a.refId ?? null });
          counts.arguments++;
        }
      }
    }
    for (const p of pending) {
      const parent = p.parentId != null ? idMap.get(p.parentId) ?? null : null;
      const ref = p.refId != null ? idMap.get(p.refId) ?? null : null;
      if (parent || ref) run(`UPDATE arguments SET parent_id = ?, ref_id = ? WHERE id = ?`, parent, ref, p.newId);
    }
  });
  notify();
  return counts;
}

/* ---------- text outline (pour le MCP) ---------- */
export function outline(subtopicId: number, detail = false): string {
  const sub = getSubtopic(subtopicId);
  const byParent = new Map<number | null, Arg[]>();
  for (const a of sub.arguments) {
    const k = a.parentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(a);
  }
  const lines: string[] = [
    `Sujet : ${sub.topic.title} (topic_id=${sub.topic.id})`,
    `Sous-partie : ${sub.title} (subtopic_id=${sub.id})`,
    sub.description ? `Description : ${sub.description}` : '',
    '',
  ].filter((l, i) => l || i === 3);
  if (!sub.arguments.length) lines.push('(arbre vide)');
  const walk = (parent: number | null, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      const pad = '  '.repeat(depth);
      const flags = [
        a.kind, `solidité ${a.strength}/3`,
        a.concede ? 'point concédé' : '',
        a.refId ? `réutilise #${a.refId}` : '',
        a.isGap ? '⚠ SANS RÉPONSE' : '',
      ].filter(Boolean).join(', ');
      lines.push(`${pad}[#${a.id}] ${a.side === 'moi' ? 'MOI' : 'AUTRE'} — « ${a.title} » (${flags})`);
      if (detail) {
        if (a.body) lines.push(`${pad}    ${a.body.replace(/\n+/g, ' ')}`);
        for (const s of a.sources) lines.push(`${pad}    source : ${s.label}${s.date ? ` (${s.date})` : ''}${s.url ? ` ${s.url}` : ''}`);
      }
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n');
}
