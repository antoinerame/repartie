import { useCallback, useEffect, useRef, useState } from 'react';

export type Side = 'moi' | 'autre';
export type Stance = 'pour' | 'contre';
export type Kind = 'fait' | 'valeur' | 'exemple' | 'sophisme';
export type Relation = 'refute' | 'renforce' | 'nuance';
export type Closure = '' | 'concede' | 'valeurs';
export interface Source { label: string; url?: string; date?: string }
export interface Backer { name: string; source?: string; url?: string; date?: string }
export interface PrincipleRef { id: number; title: string }

export interface Arg {
  id: number;
  subtopicId: number;
  parentId: number | null;
  /** Qui parle. */
  side: Side;
  relation: Relation;
  /** Calculé par le serveur : pour ou contre ma position. */
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
  concede: boolean;
  refId: number | null;
  refFrom: { subtopicId: number; subtopicTitle: string; topicTitle: string } | null;
  usedCount: number;
  position: number;
  box: number;
  dueAt: string | null;
  reviews: number;
  closed: boolean;
  isGap: boolean;
  checks: string[];
}

export interface Principle { id: number; title: string; description: string; useCount: number }
export interface PrincipleFull {
  id: number; title: string; description: string;
  uses: { argument: Arg; subtopic: { id: number; title: string }; topic: { id: number; title: string } }[];
}

export interface TopicCard {
  id: number; title: string; description: string; emoji: string;
  subtopics: { id: number; title: string }[];
  argCount: number; gapCount: number; trainCount: number; masteredCount: number; checkCount: number;
}
export interface SubCard {
  id: number; title: string; description: string;
  argCount: number; gapCount: number; trainCount: number; masteredCount: number; checkCount: number;
}
export interface TopicFull { id: number; title: string; description: string; emoji: string; subtopics: SubCard[] }
export interface SubFull {
  id: number; title: string; description: string;
  topic: { id: number; title: string; emoji: string };
  arguments: Arg[];
}
export interface PathItem { id: number; side: Side; stance?: Stance; title: string }
export interface GapItem {
  argument: Arg; path: PathItem[];
  subtopic: { id: number; title: string };
  topic: { id: number; title: string; emoji: string };
}
export interface TrainCard {
  argument: Arg; path: PathItem[]; responses: Arg[]; due: boolean;
  subtopic: { id: number; title: string; topicTitle: string; emoji: string };
}
export interface SearchResult {
  topics: { id: number; title: string; emoji: string }[];
  subtopics: { id: number; title: string; topicTitle: string; emoji: string }[];
  principles?: { id: number; title: string }[];
  arguments: { id: number; subtopicId: number; side: Side; title: string; body: string; kind: Kind; subtopicTitle: string; topicTitle: string }[];
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('auth-lost'));
  let data: any = null;
  try { data = await res.json(); } catch { /* pas de corps */ }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data as T;
}

/* ---------- rafraîchissement en direct (quand Claude écrit via le MCP) ---------- */
const liveListeners = new Set<() => void>();
let source: EventSource | null = null;
function ensureSource() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.onmessage = () => liveListeners.forEach((cb) => cb());
}
export function useLive(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    ensureSource();
    const fn = () => ref.current();
    liveListeners.add(fn);
    return () => { liveListeners.delete(fn); };
  }, []);
}

export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(path);
  current.current = path;
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (current.current === path) { setData(d); setError(null); }
    } catch (e: any) {
      if (current.current === path) setError(e.message);
    }
  }, [path]);
  useEffect(() => { setData(null); setError(null); reload(); }, [reload]);
  useLive(reload);
  return { data, error, reload };
}

export const KIND_LABEL: Record<Kind, string> = { fait: 'Fait', valeur: 'Valeur', exemple: 'Exemple', sophisme: 'Sophisme' };
export const KIND_HINT: Record<Kind, string> = {
  fait: 'Vérifiable : chiffres, études, droit',
  valeur: 'Désaccord de priorités, pas de chiffres',
  exemple: 'Cas concret, comparaison, anecdote',
  sophisme: 'Argument fallacieux à démasquer',
};
export const SIDE_LABEL: Record<Side, string> = { moi: 'Moi', autre: 'En face' };

export const RELATION_LABEL: Record<Relation, string> = { refute: 'Contredit', renforce: 'Renforce', nuance: 'Nuance' };
export const RELATION_HINT: Record<Relation, string> = {
  refute: 'Va contre le point auquel il répond',
  renforce: 'Va dans le sens du point auquel il répond',
  nuance: 'Le tempère sans le contredire',
};
export const CLOSURE_LABEL: Record<Closure, string> = { '': 'Ouverte', concede: 'Concédé', valeurs: 'Désaccord de valeurs' };
export const CLOSURE_HINT: Record<Closure, string> = {
  '': 'La discussion continue sur cette branche',
  concede: "Il a raison là-dessus : mieux vaut l'admettre que s'acharner",
  valeurs: "Ça ne se tranche pas avec un fait : on nomme le désaccord et on s'arrête",
};

export const FALLACIES = [
  'Homme de paille', "Procès d'intention", 'Ad hominem', 'Pente glissante', 'Faux dilemme',
  'Généralisation abusive', 'Appel à la tradition', 'Appel à la nature', 'Appel à la peur',
  "Appel à l'émotion", "Argument d'autorité", 'Appel à la popularité', 'Whataboutisme',
  'Corrélation / causalité', 'Cueillette de cerises', 'Renversement de la charge de la preuve',
  'Hareng rouge', 'Raisonnement circulaire',
];

/** Suggestions pour « Défendu par » (texte libre accepté). */
export const PARTIES = [
  'LFI', 'PS', 'Les Écologistes', 'PCF', 'Place publique', 'Renaissance', 'MoDem', 'Horizons',
  'LR', 'UDI', 'RN', 'Reconquête', 'UDR', 'NPA', 'LO', 'Debout la France',
  'CGT', 'CFDT', 'FO', 'Medef', 'CPME',
];
