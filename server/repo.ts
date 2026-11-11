import { all, get, run, tx } from './db.ts';

export type Side = 'moi' | 'autre';
export type Stance = 'pour' | 'contre';
export type Kind = 'fait' | 'valeur' | 'exemple' | 'sophisme';
export type Relation = 'refute' | 'renforce' | 'nuance';
export type Closure = '' | 'concede' | 'valeurs';
export interface Source { label: string; url?: string; date?: string }
export interface Backer { name: string; source?: string; url?: string; date?: string }
export interface PrincipleRef { id: number; title: string }

export const FALLACIES = [
  'Homme de paille', "Procès d'intention", 'Ad hominem', 'Pente glissante', 'Faux dilemme',
  'Généralisation abusive', 'Appel à la tradition', 'Appel à la nature', 'Appel à la peur',
  "Appel à l'émotion", "Argument d'autorité", 'Appel à la popularité', 'Whataboutisme',
  'Corrélation / causalité', 'Cueillette de cerises', 'Renversement de la charge de la preuve',
  'Hareng rouge', 'Raisonnement circulaire',
];

export interface Arg {
  id: number;
  subtopicId: number;
  parentId: number | null;
  /** Qui parle. */
  side: Side;
  /** Rapport au parent (sans objet à la racine). */
  relation: Relation;
  /** Calculé : l'argument va-t-il dans mon sens ou contre moi ? */
  stance: Stance;
  title: string;
  body: string;
  kind: Kind;
  fallacy: string;
  strength: number;
  verify: boolean;
  sources: Source[];
  backers: Backer[];
  principles: PrincipleRef[];
  closure: Closure;
  rebound: string;
  /** Compatibilité : closure === 'concede'. */
  concede: boolean;
  refId: number | null;
  refFrom: { subtopicId: number; subtopicTitle: string; topicTitle: string } | null;
  usedCount: number;
  position: number;
  box: number;
  dueAt: string | null;
  reviews: number;
  /** Clos lui-même ou sous une branche close. */
  closed: boolean;
  isGap: boolean;
  /** Raisons pour lesquelles l'argument est à vérifier (vide = rien à signaler). */
  checks: string[];
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
const KINDS: Kind[] = ['fait', 'valeur', 'exemple', 'sophisme'];
const RELATIONS: Relation[] = ['refute', 'renforce', 'nuance'];
const CLOSURES: Closure[] = ['', 'concede', 'valeurs'];

function str(v: unknown, max = 4000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function need<T>(v: T | undefined, what: string): T {
  if (!v) throw new HttpError(404, `${what} introuvable`);
  return v;
}
function parseJson<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function httpUrl(v: unknown) {
  const s = str(v, 1000);
  return /^https?:\/\//i.test(s) ? s : undefined;
}

function cleanSources(input: unknown): Source[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s: any) => (typeof s === 'string' ? { label: s } : s))
    .filter((s: any) => s && typeof s.label === 'string' && s.label.trim())
    .map((s: any) => {
      const out: Source = { label: str(s.label, 500) };
      const url = httpUrl(s.url);
      if (url) out.url = url;
      if (s.date) out.date = str(String(s.date), 40);
      return out;
    });
}

function cleanBackers(input: unknown): Backer[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Backer[] = [];
  for (const raw of input) {
    const b: any = typeof raw === 'string' ? { name: raw } : raw;
    const name = str(b?.name, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const item: Backer = { name };
    const source = str(b.source, 500);
    if (source) item.source = source;
    const url = httpUrl(b.url);
    if (url) item.url = url;
    if (b.date) item.date = str(String(b.date), 40);
    out.push(item);
  }
  return out;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/* ---------- lecture des arguments + calculs (position, trous, clôture) ---------- */
const ARG_SELECT = `
SELECT a.id, a.subtopic_id, a.parent_id, a.side, a.relation, a.closure, a.rebound, a.ref_id, a.position,
  a.box, a.due_at, a.reviews,
  COALESCE(r.title, a.title) AS title,
  COALESCE(r.body, a.body) AS body,
  COALESCE(r.kind, a.kind) AS kind,
  COALESCE(r.fallacy, a.fallacy) AS fallacy,
  COALESCE(r.strength, a.strength) AS strength,
  COALESCE(r.verify, a.verify) AS verify,
  COALESCE(r.sources, a.sources) AS sources,
  COALESCE(r.backers, a.backers) AS backers,
  r.subtopic_id AS ref_sub_id, rs.title AS ref_sub_title, rt.title AS ref_topic_title,
  (SELECT COUNT(*) FROM arguments u WHERE u.ref_id = a.id) AS used_count
FROM arguments a
LEFT JOIN arguments r ON r.id = a.ref_id
LEFT JOIN subtopics rs ON rs.id = r.subtopic_id
LEFT JOIN topics rt ON rt.id = rs.topic_id`;

function principleMap(): Map<number, PrincipleRef[]> {
  const map = new Map<number, PrincipleRef[]>();
  for (const r of all<any>(
    `SELECT ap.argument_id, p.id, p.title FROM arg_principles ap JOIN principles p ON p.id = ap.principle_id ORDER BY p.title`)) {
    if (!map.has(r.argument_id)) map.set(r.argument_id, []);
    map.get(r.argument_id)!.push({ id: r.id, title: r.title });
  }
  return map;
}

function rowToArg(r: any, principles: Map<number, PrincipleRef[]>): Arg {
  const sources = parseJson<Source>(r.sources);
  const backers = parseJson<Backer>(r.backers);
  return {
    id: r.id,
    subtopicId: r.subtopic_id,
    parentId: r.parent_id,
    side: r.side,
    relation: pick(r.relation, RELATIONS, 'refute'),
    stance: 'pour',
    title: r.title,
    body: r.body,
    kind: r.kind,
    fallacy: r.fallacy ?? '',
    strength: r.strength,
    verify: !!r.verify,
    sources,
    backers,
    principles: principles.get(r.ref_id ?? r.id) ?? [],
    closure: pick(r.closure, CLOSURES, ''),
    rebound: r.rebound ?? '',
    concede: r.closure === 'concede',
    refId: r.ref_id,
    refFrom: r.ref_id && r.ref_sub_id
      ? { subtopicId: r.ref_sub_id, subtopicTitle: r.ref_sub_title, topicTitle: r.ref_topic_title }
      : null,
    usedCount: r.used_count,
    position: r.position,
    box: r.box,
    dueAt: r.due_at,
    reviews: r.reviews,
    closed: false,
    isGap: false,
    checks: [],
  };
}

/**
 * Calcule pour chaque argument sa position (pour / contre moi), s'il est dans une branche close et s'il est un trou.
 * - À la racine, la position découle du camp : « moi » = pour, « en face » = contre.
 * - Ensuite : « renforce » garde la position du parent, « contredit » et « nuance » l'inversent.
 * - Un trou = un argument contre moi, hors branche close, auquel aucun argument pour moi ne répond.
 */
function annotate(args: Arg[]): Arg[] {
  const byId = new Map(args.map((a) => [a.id, a]));
  const kids = new Map<number, Arg[]>();
  for (const a of args) {
    if (a.parentId == null) continue;
    if (!kids.has(a.parentId)) kids.set(a.parentId, []);
    kids.get(a.parentId)!.push(a);
  }
  const done = new Set<number>();
  const resolve = (a: Arg, guard = 0): void => {
    if (done.has(a.id)) return;
    const parent = a.parentId != null ? byId.get(a.parentId) : undefined;
    if (!parent || guard > 500) {
      a.stance = a.side === 'moi' ? 'pour' : 'contre';
      a.closed = !!a.closure;
    } else {
      resolve(parent, guard + 1);
      a.stance = a.relation === 'renforce' ? parent.stance : parent.stance === 'pour' ? 'contre' : 'pour';
      a.closed = parent.closed || !!a.closure;
    }
    done.add(a.id);
  };
  for (const a of args) resolve(a);
  for (const a of args) {
    a.isGap = a.stance === 'contre' && !a.closed && !(kids.get(a.id) ?? []).some((k) => k.stance === 'pour');
    const checks: string[] = [];
    if (a.verify) checks.push('Marqué « à vérifier »');
    if (a.kind === 'fait' && a.sources.length === 0) checks.push('Fait sans source');
    const loose = a.backers.filter((b) => !b.source && !b.url).map((b) => b.name);
    if (loose.length) checks.push(`Attribution sans source : ${loose.join(', ')}`);
    a.checks = checks;
  }
  return args;
}

/** Charge et annote les arguments (par sous-partie entière, pour que les calculs soient justes). */
function loadArgs(filter: { subtopicId?: number } = {}): Arg[] {
  const principles = principleMap();
  const rows = filter.subtopicId
    ? all(`${ARG_SELECT} WHERE a.subtopic_id = ? ORDER BY a.position, a.id`, filter.subtopicId)
    : all(`${ARG_SELECT} ORDER BY a.subtopic_id, a.position, a.id`);
  const args = rows.map((r) => rowToArg(r, principles));
  const bySub = new Map<number, Arg[]>();
  for (const a of args) {
    if (!bySub.has(a.subtopicId)) bySub.set(a.subtopicId, []);
    bySub.get(a.subtopicId)!.push(a);
  }
  for (const list of bySub.values()) annotate(list);
  return args;
}

function hasPourChild(args: Arg[], id: number) {
  return args.some((c) => c.parentId === id && c.stance === 'pour');
}

interface Stats { argCount: number; gapCount: number; trainCount: number; masteredCount: number; checkCount: number }
function statsBySub(): Map<number, Stats> {
  const args = loadArgs();
  const out = new Map<number, Stats>();
  for (const a of args) {
    if (!out.has(a.subtopicId)) out.set(a.subtopicId, { argCount: 0, gapCount: 0, trainCount: 0, masteredCount: 0, checkCount: 0 });
    const s = out.get(a.subtopicId)!;
    s.argCount++;
    if (a.isGap) s.gapCount++;
    if (!a.refId && a.checks.length) s.checkCount++;
    if (a.stance === 'contre' && !a.closed && hasPourChild(args, a.id)) {
      s.trainCount++;
      if (a.box >= 3) s.masteredCount++;
    }
  }
  return out;
}
const EMPTY_STATS: Stats = { argCount: 0, gapCount: 0, trainCount: 0, masteredCount: 0, checkCount: 0 };

/* ---------- topics ---------- */
export function overview() {
  const topics = all(`SELECT * FROM topics ORDER BY position, id`);
  const subs = all(`SELECT s.id, s.topic_id, s.title FROM subtopics s ORDER BY s.position, s.id`);
  const stats = statsBySub();
  return topics.map((t: any) => {
    const mine = subs.filter((s: any) => s.topic_id === t.id);
    const sum = (k: keyof Stats) => mine.reduce((n: number, s: any) => n + (stats.get(s.id)?.[k] ?? 0), 0);
    return {
      id: t.id, title: t.title, description: t.description, emoji: t.emoji,
      subtopics: mine.map((s: any) => ({ id: s.id, title: s.title })),
      argCount: sum('argCount'), gapCount: sum('gapCount'), trainCount: sum('trainCount'),
      masteredCount: sum('masteredCount'), checkCount: sum('checkCount'),
    };
  });
}

export function getTopic(id: number) {
  const t: any = need(get(`SELECT * FROM topics WHERE id = ?`, id), 'Sujet');
  const stats = statsBySub();
  const rows = all(`SELECT * FROM subtopics WHERE topic_id = ? ORDER BY position, id`, id);
  return {
    id: t.id, title: t.title, description: t.description, emoji: t.emoji,
    subtopics: rows.map((s: any) => ({ id: s.id, title: s.title, description: s.description, ...(stats.get(s.id) ?? EMPTY_STATS) })),
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

function subInfo(id: number) {
  return get<any>(
    `SELECT s.id, s.title, s.description, t.id AS topic_id, t.title AS topic_title, t.emoji
     FROM subtopics s JOIN topics t ON t.id = s.topic_id WHERE s.id = ?`, id);
}

export function getSubtopic(id: number) {
  const s = need(subInfo(id), 'Sous-partie');
  return {
    id: s.id, title: s.title, description: s.description,
    topic: { id: s.topic_id, title: s.topic_title, emoji: s.emoji },
    arguments: loadArgs({ subtopicId: id }),
  };
}

/** « J'ai changé d'avis » : inverse les camps de toute la sous-partie. Les relations restent, les positions s'inversent. */
export function flipSubtopic(id: number) {
  need(get(`SELECT id FROM subtopics WHERE id = ?`, id), 'Sous-partie');
  run(`UPDATE arguments SET side = CASE side WHEN 'moi' THEN 'autre' ELSE 'moi' END,
       closure = CASE closure WHEN 'concede' THEN '' ELSE closure END,
       box = 0, due_at = NULL WHERE subtopic_id = ?`, id);
  notify();
}

/* ---------- principes ---------- */
function resolvePrinciples(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<number>();
  for (const p of input) {
    if (typeof p === 'number' && Number.isInteger(p)) {
      if (get(`SELECT id FROM principles WHERE id = ?`, p)) ids.add(p);
      continue;
    }
    const name = str(typeof p === 'string' ? p : (p as any)?.title, 120);
    if (!name) continue;
    const found = get<any>(`SELECT id FROM principles WHERE lower(title) = lower(?)`, name);
    if (found) ids.add(found.id);
    else ids.add(Number(run(`INSERT INTO principles (title) VALUES (?)`, name).lastInsertRowid));
  }
  return [...ids];
}

function setPrinciples(contentId: number, input: unknown) {
  const ids = resolvePrinciples(input);
  run(`DELETE FROM arg_principles WHERE argument_id = ?`, contentId);
  for (const pid of ids) run(`INSERT OR IGNORE INTO arg_principles (argument_id, principle_id) VALUES (?, ?)`, contentId, pid);
}

export function listPrinciples() {
  return all<any>(
    `SELECT p.id, p.title, p.description,
       (SELECT COUNT(*) FROM arg_principles ap WHERE ap.principle_id = p.id) AS useCount
     FROM principles p ORDER BY lower(p.title)`);
}

export function createPrinciple(input: { title: string; description?: string }) {
  const title = str(input.title, 120);
  if (!title) throw new HttpError(400, 'Le nom du principe est obligatoire');
  if (get(`SELECT id FROM principles WHERE lower(title) = lower(?)`, title)) throw new HttpError(400, 'Ce principe existe déjà');
  const r = run(`INSERT INTO principles (title, description) VALUES (?, ?)`, title, str(input.description, 2000));
  notify();
  return { id: Number(r.lastInsertRowid), title };
}

export function updatePrinciple(id: number, patch: { title?: string; description?: string }) {
  const p: any = need(get(`SELECT * FROM principles WHERE id = ?`, id), 'Principe');
  const title = patch.title !== undefined ? str(patch.title, 120) || p.title : p.title;
  const clash = get<any>(`SELECT id FROM principles WHERE lower(title) = lower(?) AND id <> ?`, title, id);
  if (clash) throw new HttpError(400, 'Un autre principe porte déjà ce nom');
  run(`UPDATE principles SET title = ?, description = ? WHERE id = ?`,
    title, patch.description !== undefined ? str(patch.description, 2000) : p.description, id);
  notify();
}

export function deletePrinciple(id: number) {
  need(get(`SELECT id FROM principles WHERE id = ?`, id), 'Principe');
  run(`DELETE FROM principles WHERE id = ?`, id);
  notify();
}

/** Un principe et tous les arguments qui s'en servent, pour vérifier sa cohérence d'un sujet à l'autre. */
export function getPrinciple(id: number) {
  const p: any = need(get(`SELECT * FROM principles WHERE id = ?`, id), 'Principe');
  const ids = new Set(all<any>(`SELECT argument_id FROM arg_principles WHERE principle_id = ?`, id).map((r) => r.argument_id));
  const args = loadArgs().filter((a) => ids.has(a.refId ?? a.id) && !a.refId);
  return {
    id: p.id, title: p.title, description: p.description,
    uses: args.map((a) => {
      const s = subInfo(a.subtopicId);
      return { argument: a, subtopic: { id: s.id, title: s.title }, topic: { id: s.topic_id, title: s.topic_title } };
    }),
  };
}

/* ---------- arguments ---------- */
export interface ArgInput {
  subtopicId?: number;
  parentId?: number | null;
  side?: Side;
  relation?: Relation;
  title?: string;
  body?: string;
  kind?: Kind;
  fallacy?: string;
  strength?: number;
  verify?: boolean;
  sources?: unknown;
  backers?: unknown;
  principles?: unknown;
  closure?: Closure;
  rebound?: string;
  /** Ancien champ : true équivaut à closure = 'concede'. */
  concede?: boolean;
  refId?: number | null;
}

export function getArgument(id: number): Arg {
  const row = need(get<any>(`SELECT subtopic_id FROM arguments WHERE id = ?`, id), 'Argument');
  return need(loadArgs({ subtopicId: row.subtopic_id }).find((a) => a.id === id), 'Argument');
}

function closureFrom(input: ArgInput, current: Closure): Closure {
  if (input.closure !== undefined) return pick(input.closure, CLOSURES, '');
  if (input.concede === true) return 'concede';
  if (input.concede === false && current === 'concede') return '';
  return current;
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
  // Par défaut : même camp que le parent = renforce, camp opposé = contredit.
  const relation: Relation = pick(input.relation, RELATIONS, parent && parent.side === side ? 'renforce' : 'refute');

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
  const kind = pick(input.kind, KINDS, 'fait');
  const r = run(
    `INSERT INTO arguments (subtopic_id, parent_id, side, relation, title, body, kind, fallacy, strength, verify,
       sources, backers, closure, rebound, ref_id, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    subtopicId, parent?.id ?? null, side, relation, title, str(input.body), kind,
    kind === 'sophisme' ? str(input.fallacy, 80) : '',
    [1, 2, 3].includes(Number(input.strength)) ? Number(input.strength) : 2,
    input.verify ? 1 : 0,
    JSON.stringify(cleanSources(input.sources)), JSON.stringify(cleanBackers(input.backers)),
    closureFrom(input, ''), str(input.rebound, 1000), refId, pos);
  const id = Number(r.lastInsertRowid);
  if (!refId && input.principles !== undefined) setPrinciples(id, input.principles);
  return id;
}

export function createArgument(input: ArgInput): Arg {
  const id = tx(() => insertArgument(input));
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
  const created = new Set(ids);
  const subs = new Set(ids.map((id) => (get<any>(`SELECT subtopic_id FROM arguments WHERE id = ?`, id)!).subtopic_id));
  const args = [...subs].flatMap((s) => loadArgs({ subtopicId: s })).filter((a) => created.has(a.id));
  return ids.map((id) => args.find((a) => a.id === id)!);
}

export function updateArgument(id: number, patch: ArgInput): Arg {
  const a: any = need(get(`SELECT * FROM arguments WHERE id = ?`, id), 'Argument');
  tx(() => {
    // Le contenu d'un argument réutilisé vit dans l'argument d'origine.
    const contentId = a.ref_id ?? id;
    const c: any = a.ref_id ? get(`SELECT * FROM arguments WHERE id = ?`, a.ref_id) : a;
    const kind = patch.kind !== undefined ? pick(patch.kind, KINDS, c.kind) : c.kind;
    run(`UPDATE arguments SET title = ?, body = ?, kind = ?, fallacy = ?, strength = ?, verify = ?, sources = ?, backers = ?,
           updated_at = datetime('now') WHERE id = ?`,
      patch.title !== undefined ? str(patch.title, 300) || c.title : c.title,
      patch.body !== undefined ? str(patch.body) : c.body,
      kind,
      kind !== 'sophisme' ? '' : patch.fallacy !== undefined ? str(patch.fallacy, 80) : c.fallacy,
      patch.strength !== undefined && [1, 2, 3].includes(Number(patch.strength)) ? Number(patch.strength) : c.strength,
      patch.verify !== undefined ? (patch.verify ? 1 : 0) : c.verify,
      patch.sources !== undefined ? JSON.stringify(cleanSources(patch.sources)) : c.sources,
      patch.backers !== undefined ? JSON.stringify(cleanBackers(patch.backers)) : c.backers,
      contentId);
    if (patch.principles !== undefined) setPrinciples(contentId, patch.principles);
    run(`UPDATE arguments SET side = ?, relation = ?, closure = ?, rebound = ?, updated_at = datetime('now') WHERE id = ?`,
      patch.side === 'moi' || patch.side === 'autre' ? patch.side : a.side,
      patch.relation !== undefined ? pick(patch.relation, RELATIONS, a.relation) : a.relation,
      closureFrom(patch, pick(a.closure, CLOSURES, '')),
      patch.rebound !== undefined ? str(patch.rebound, 1000) : a.rebound,
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
  run(`INSERT OR IGNORE INTO arg_principles (argument_id, principle_id)
       SELECT l.id, ap.principle_id FROM arguments l JOIN arg_principles ap ON ap.argument_id = l.ref_id
       WHERE l.ref_id IN (${idsSql}) AND l.id NOT IN (${idsSql})`);
  run(`UPDATE arguments SET
         title = (SELECT title FROM arguments r WHERE r.id = arguments.ref_id),
         body = (SELECT body FROM arguments r WHERE r.id = arguments.ref_id),
         kind = (SELECT kind FROM arguments r WHERE r.id = arguments.ref_id),
         fallacy = (SELECT fallacy FROM arguments r WHERE r.id = arguments.ref_id),
         strength = (SELECT strength FROM arguments r WHERE r.id = arguments.ref_id),
         verify = (SELECT verify FROM arguments r WHERE r.id = arguments.ref_id),
         sources = (SELECT sources FROM arguments r WHERE r.id = arguments.ref_id),
         backers = (SELECT backers FROM arguments r WHERE r.id = arguments.ref_id),
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

/* ---------- recherche, trous, à vérifier ---------- */
function like(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

export function search(q: string, limit = 30) {
  q = q.trim();
  if (!q) return { topics: [], subtopics: [], principles: [], arguments: [] };
  const l = like(q);
  const topics = all(`SELECT id, title, emoji FROM topics WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 8`, l, l);
  const subtopics = all(
    `SELECT s.id, s.title, t.title AS topicTitle, t.emoji FROM subtopics s JOIN topics t ON t.id = s.topic_id
     WHERE s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' LIMIT 8`, l, l);
  const principles = all(`SELECT id, title FROM principles WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 8`, l, l);
  const args = all(
    `SELECT a.id, a.subtopic_id AS subtopicId, a.side, a.title, a.body, a.kind, s.title AS subtopicTitle, t.title AS topicTitle
     FROM arguments a JOIN subtopics s ON s.id = a.subtopic_id JOIN topics t ON t.id = s.topic_id
     WHERE a.ref_id IS NULL AND (a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\' OR a.sources LIKE ? ESCAPE '\\'
       OR a.backers LIKE ? ESCAPE '\\' OR a.rebound LIKE ? ESCAPE '\\')
     ORDER BY a.updated_at DESC LIMIT ?`, l, l, l, l, l, limit);
  return { topics, subtopics, principles, arguments: args };
}

function pathFrom(args: Arg[], id: number) {
  const byId = new Map(args.map((a) => [a.id, a]));
  const out: { id: number; side: Side; stance: Stance; title: string }[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  let guard = 0;
  while (cur != null && guard++ < 500) {
    const p = byId.get(cur);
    if (!p) break;
    out.unshift({ id: p.id, side: p.side, stance: p.stance, title: p.title });
    cur = p.parentId;
  }
  return out;
}

function placeOf(subtopicId: number) {
  const s = subInfo(subtopicId);
  return { subtopic: { id: s.id, title: s.title }, topic: { id: s.topic_id, title: s.topic_title, emoji: s.emoji } };
}

function subtopicsOf(filter: { topicId?: number; subtopicId?: number }): number[] | null {
  if (filter.subtopicId) return [filter.subtopicId];
  if (filter.topicId) return all<any>(`SELECT id FROM subtopics WHERE topic_id = ?`, filter.topicId).map((r) => r.id);
  return null;
}

function orderedSubs(): Map<number, number> {
  const rows = all<any>(`SELECT s.id FROM subtopics s JOIN topics t ON t.id = s.topic_id ORDER BY t.position, t.id, s.position, s.id`);
  return new Map(rows.map((r, i) => [r.id, i]));
}

export function gaps(filter: { topicId?: number; subtopicId?: number } = {}) {
  const subs = subtopicsOf(filter);
  const args = loadArgs();
  const order = orderedSubs();
  return args
    .filter((a) => a.isGap && (!subs || subs.includes(a.subtopicId)))
    .sort((a, b) => (order.get(a.subtopicId)! - order.get(b.subtopicId)!) || b.strength - a.strength)
    .map((a) => ({ argument: a, path: pathFrom(args, a.id), ...placeOf(a.subtopicId) }));
}

/** Ce qu'on affirme sans preuve : marqué à vérifier, fait sans source, attribution à un parti sans source. */
export function unsourced(filter: { topicId?: number; subtopicId?: number } = {}) {
  const subs = subtopicsOf(filter);
  const args = loadArgs();
  const order = orderedSubs();
  return args
    .filter((a) => !a.refId && a.checks.length && (!subs || subs.includes(a.subtopicId)))
    .sort((a, b) => (order.get(a.subtopicId)! - order.get(b.subtopicId)!) || Number(b.verify) - Number(a.verify) || b.strength - a.strength)
    .map((a) => ({ argument: a, path: pathFrom(args, a.id), ...placeOf(a.subtopicId) }));
}

/** Liste de tous les noms de partis / personnes déjà utilisés dans « Défendu par ». */
export function backerNames(): string[] {
  const names = new Map<string, string>();
  for (const r of all<any>(`SELECT backers FROM arguments WHERE ref_id IS NULL AND backers <> '[]'`)) {
    for (const b of parseJson<Backer>(r.backers)) if (b?.name) names.set(b.name.toLowerCase(), b.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* ---------- entraînement ---------- */
const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

export function trainingCards(opts: { topicId?: number; subtopicId?: number; limit?: number; includeGaps?: boolean }) {
  const subs = subtopicsOf(opts);
  const args = loadArgs();
  const now = new Date().toISOString();
  const candidates = args.filter((a) =>
    a.stance === 'contre' && !a.closed && (!subs || subs.includes(a.subtopicId)) &&
    (opts.includeGaps || hasPourChild(args, a.id)));
  const due = (a: Arg) => !a.dueAt || a.dueAt <= now;
  const shuffled = candidates.map((a) => ({ a, r: Math.random() }));
  shuffled.sort((x, y) =>
    Number(due(y.a)) - Number(due(x.a)) || x.a.box - y.a.box || (x.a.dueAt ?? '').localeCompare(y.a.dueAt ?? '') || x.r - y.r);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  return shuffled.slice(0, limit).map(({ a }) => {
    const s = subInfo(a.subtopicId);
    const responses = args
      .filter((c) => c.parentId === a.id && c.stance === 'pour')
      .sort((x, y) => y.strength - x.strength || x.position - y.position);
    return {
      argument: a,
      path: pathFrom(args, a.id),
      responses,
      subtopic: { id: s.id, title: s.title, topicTitle: s.topic_title, emoji: s.emoji },
      due: due(a),
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
  const links = all<any>(`SELECT ap.argument_id, p.title FROM arg_principles ap JOIN principles p ON p.id = ap.principle_id`);
  const principlesOf = (id: number) => links.filter((l) => l.argument_id === id).map((l) => l.title);
  return {
    app: 'repartie',
    version: 2,
    exportedAt: new Date().toISOString(),
    principles: all<any>(`SELECT title, description FROM principles ORDER BY lower(title)`),
    topics: topics.map((t) => ({
      title: t.title, description: t.description, emoji: t.emoji,
      subtopics: all<any>(`SELECT * FROM subtopics WHERE topic_id = ? ORDER BY position, id`, t.id).map((s) => ({
        title: s.title, description: s.description,
        arguments: all<any>(`SELECT * FROM arguments WHERE subtopic_id = ? ORDER BY id`, s.id).map((a) => ({
          id: a.id, parentId: a.parent_id, refId: a.ref_id, side: a.side, relation: a.relation,
          title: a.title, body: a.body, kind: a.kind, fallacy: a.fallacy, strength: a.strength, verify: !!a.verify,
          sources: parseJson(a.sources), backers: parseJson(a.backers), principles: principlesOf(a.id),
          closure: a.closure, rebound: a.rebound,
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
  const counts = { topics: 0, subtopics: 0, arguments: 0, principles: 0 };
  tx(() => {
    if (mode === 'replace') {
      run(`DELETE FROM topics`);
      run(`DELETE FROM principles`);
    }
    for (const p of Array.isArray(data.principles) ? data.principles : []) {
      const title = str(p?.title, 120);
      if (!title || get(`SELECT id FROM principles WHERE lower(title) = lower(?)`, title)) continue;
      run(`INSERT INTO principles (title, description) VALUES (?, ?)`, title, str(p.description, 2000));
      counts.principles++;
    }
    let tpos = (get<any>(`SELECT COALESCE(MAX(position), 0) AS p FROM topics`)!).p;
    const idMap = new Map<number, number>();
    const pending: { newId: number; parentId: number | null; refId: number | null; side: Side; relation?: string }[] = [];
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
          const side: Side = a.side === 'autre' ? 'autre' : 'moi';
          const kind = pick(a.kind, KINDS, 'fait');
          const ar = run(
            `INSERT INTO arguments (subtopic_id, side, relation, title, body, kind, fallacy, strength, verify, sources, backers,
               closure, rebound, position, box, due_at, reviews)
             VALUES (?, ?, 'refute', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            Number(sr.lastInsertRowid), side, str(a.title, 300), str(a.body), kind,
            kind === 'sophisme' ? str(a.fallacy, 80) : '',
            [1, 2, 3].includes(a.strength) ? a.strength : 2, a.verify ? 1 : 0,
            JSON.stringify(cleanSources(a.sources)), JSON.stringify(cleanBackers(a.backers)),
            a.closure !== undefined ? pick(a.closure, CLOSURES, '') : a.concede ? 'concede' : '',
            str(a.rebound, 1000), Number(a.position) || 0,
            Number(a.box) || 0, typeof a.dueAt === 'string' ? a.dueAt : null, Number(a.reviews) || 0);
          const newId = Number(ar.lastInsertRowid);
          if (Array.isArray(a.principles) && a.principles.length) setPrinciples(newId, a.principles);
          if (typeof a.id === 'number') idMap.set(a.id, newId);
          pending.push({ newId, parentId: a.parentId ?? null, refId: a.refId ?? null, side, relation: a.relation });
          counts.arguments++;
        }
      }
    }
    const sideOf = new Map(pending.map((p) => [p.newId, p.side]));
    for (const p of pending) {
      const parent = p.parentId != null ? idMap.get(p.parentId) ?? null : null;
      const ref = p.refId != null ? idMap.get(p.refId) ?? null : null;
      // Anciens exports sans relation : même camp que le parent = renforce, sinon contredit.
      const relation = RELATIONS.includes(p.relation as Relation)
        ? p.relation
        : parent && sideOf.get(parent) === p.side ? 'renforce' : 'refute';
      run(`UPDATE arguments SET parent_id = ?, ref_id = ?, relation = ? WHERE id = ?`, parent, ref, relation, p.newId);
    }
  });
  notify();
  return counts;
}

/* ---------- plan texte (pour le MCP) ---------- */
const RELATION_LABEL: Record<Relation, string> = { refute: 'contredit', renforce: 'renforce', nuance: 'nuance' };

export function describeArg(a: Arg) {
  return [
    a.parentId ? `${RELATION_LABEL[a.relation]} son parent` : '',
    a.stance === 'pour' ? 'va dans mon sens' : 'va contre moi',
    a.kind === 'sophisme' && a.fallacy ? `sophisme : ${a.fallacy}` : a.kind,
    `solidité ${a.strength}/3`,
    a.closure === 'concede' ? 'point concédé' : a.closure === 'valeurs' ? 'désaccord de valeurs assumé' : '',
    a.closed && !a.closure ? 'branche close' : '',
    a.refId ? `réutilise #${a.refId}` : '',
    a.isGap ? '⚠ SANS RÉPONSE' : '',
    a.verify ? 'à vérifier' : '',
  ].filter(Boolean).join(', ');
}

export function outline(subtopicId: number, detail = false): string {
  const sub = getSubtopic(subtopicId);
  const byParent = new Map<number | null, Arg[]>();
  for (const a of sub.arguments) {
    if (!byParent.has(a.parentId)) byParent.set(a.parentId, []);
    byParent.get(a.parentId)!.push(a);
  }
  const lines: string[] = [
    `Sujet : ${sub.topic.title} (topic_id=${sub.topic.id})`,
    `Sous-partie : ${sub.title} (subtopic_id=${sub.id})`,
  ];
  if (sub.description) lines.push(`Description : ${sub.description}`);
  lines.push('');
  if (!sub.arguments.length) lines.push('(arbre vide)');
  const walk = (parent: number | null, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      const pad = '  '.repeat(depth);
      lines.push(`${pad}[#${a.id}] ${a.side === 'moi' ? 'MOI' : 'AUTRE'} — « ${a.title} » (${describeArg(a)})`);
      if (a.backers.length) {
        lines.push(`${pad}    défendu par : ${a.backers.map((b) => `${b.name}${b.source || b.url ? '' : ' (sans source)'}`).join(', ')}`);
      }
      if (a.principles.length) lines.push(`${pad}    principes : ${a.principles.map((p) => p.title).join(', ')}`);
      if (a.rebound) lines.push(`${pad}    et pourtant : ${a.rebound}`);
      if (detail) {
        if (a.body) lines.push(`${pad}    ${a.body.replace(/\n+/g, ' ')}`);
        for (const s of a.sources) lines.push(`${pad}    source : ${s.label}${s.date ? ` (${s.date})` : ''}${s.url ? ` ${s.url}` : ''}`);
        for (const b of a.backers.filter((x) => x.source || x.url)) {
          lines.push(`${pad}    attribution ${b.name} : ${b.source ?? ''}${b.date ? ` (${b.date})` : ''}${b.url ? ` ${b.url}` : ''}`);
        }
      }
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n');
}
