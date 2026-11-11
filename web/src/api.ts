import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface TopicCard {
  id: number; title: string; description: string; emoji: string;
  subtopics: { id: number; title: string }[];
  argCount: number; gapCount: number; trainCount: number; masteredCount: number;
}
export interface SubCard {
  id: number; title: string; description: string;
  argCount: number; gapCount: number; trainCount: number; masteredCount: number;
}
export interface TopicFull { id: number; title: string; description: string; emoji: string; subtopics: SubCard[] }
export interface SubFull {
  id: number; title: string; description: string;
  topic: { id: number; title: string; emoji: string };
  arguments: Arg[];
}
export interface PathItem { id: number; side: Side; title: string }
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
