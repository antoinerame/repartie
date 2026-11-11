import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type Arg, type Side, type SubFull, SIDE_LABEL, useData, CLOSURE_LABEL, RELATION_LABEL } from '../api';
import { Confirm, Empty, Icon, KindChip, SideTag, Strength, plural } from '../ui';
import { fr } from '../views-ui';
import Editor, { type Draft } from './Editor';

const other = (s: Side): Side => (s === 'moi' ? 'autre' : 'moi');

/* Largeur de la gouttière entre un argument et ses réponses (doit rester égale à --gutter dans views.css) */
const GUTTER = 56;

interface Wire { id: number | string; cls: string }

/* Connecteurs en courbes : un SVG par colonne de réponses, mesuré sur la mise en page réelle. */
function Wires({ items }: { items: Wire[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [geo, setGeo] = useState<{ h: number; ys: number[] }>({ h: 0, ys: [] });
  const sig = items.map((i) => i.id).join(',');

  useLayoutEffect(() => {
    const svg = ref.current;
    const box = svg?.parentElement;
    if (!svg || !box) return;
    const measure = () => {
      const kidEls = [...box.children].filter((c) => c.classList.contains('kid')) as HTMLElement[];
      const h = box.offsetHeight;
      const ys = kidEls.map((k) => k.offsetTop + k.offsetHeight / 2);
      setGeo((g) => (g.h === h && g.ys.length === ys.length && g.ys.every((y, i) => y === ys[i]) ? g : { h, ys }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const c of box.children) if (c !== svg) ro.observe(c);
    return () => ro.disconnect();
  }, [sig]);

  const mid = geo.h / 2;
  const paths = items
    .map((it, i) => ({ ...it, y: geo.ys[i] }))
    .filter((p) => p.y != null)
    .sort((a, b) => Number(a.cls === 'on') - Number(b.cls === 'on'));
  return (
    <svg ref={ref} className="wires" viewBox={`0 0 ${GUTTER} ${geo.h || 1}`} preserveAspectRatio="none" aria-hidden="true">
      {paths.map((p) => (
        <path key={p.id} className={`wire ${p.cls}`}
          d={`M0 ${mid} C ${GUTTER * 0.55} ${mid}, ${GUTTER * 0.45} ${p.y}, ${GUTTER} ${p.y}`} />
      ))}
    </svg>
  );
}

export default function Tree() {
  const { id } = useParams();
  const subId = Number(id);
  const { data: sub, error, reload } = useData<SubFull>(`/subtopics/${id}`);
  const [params, setParams] = useSearchParams();

  const [backer, setBacker] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{ side: Side; title: string } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [toDelete, setToDelete] = useState<Arg | null>(null);
  const [confirmFlip, setConfirmFlip] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`collapsed-${subId}`) || '[]')); } catch { return new Set(); }
  });
  const canvas = useRef<HTMLDivElement>(null);
  const gapCursor = useRef(-1);

  useEffect(() => {
    try { localStorage.setItem(`collapsed-${subId}`, JSON.stringify([...collapsed])); } catch { /* ignore */ }
  }, [collapsed, subId]);

  const { kids, byId, order } = useMemo(() => {
    const kids = new Map<number | null, Arg[]>();
    const byId = new Map<number, Arg>();
    for (const a of sub?.arguments ?? []) {
      byId.set(a.id, a);
      if (!kids.has(a.parentId)) kids.set(a.parentId, []);
      kids.get(a.parentId)!.push(a);
    }
    const order: Arg[] = [];
    const walk = (p: number | null) => { for (const a of kids.get(p) ?? []) { order.push(a); walk(a.id); } };
    walk(null);
    return { kids, byId, order };
  }, [sub]);

  /* Le fil de discussion : l'argument actif et tous ceux auxquels il répond, jusqu'à la question. */
  const active = selected ?? draft?.parentId ?? null;
  const thread = useMemo(() => {
    const s = new Set<number>();
    let cur = active;
    while (cur != null && byId.has(cur)) { s.add(cur); cur = byId.get(cur)!.parentId; }
    return s;
  }, [active, byId]);

  const countDesc = useCallback((nodeId: number): number =>
    (kids.get(nodeId) ?? []).reduce((n, k) => n + 1 + countDesc(k.id), 0), [kids]);
  const inSubtree = useCallback((nodeId: number, rootId: number) => {
    let cur: number | null = nodeId;
    while (cur != null) { if (cur === rootId) return true; cur = byId.get(cur)?.parentId ?? null; }
    return false;
  }, [byId]);

  const reveal = useCallback((nodeId: number) => {
    setCollapsed((c) => {
      const next = new Set(c);
      let cur = byId.get(nodeId)?.parentId ?? null;
      while (cur != null) { next.delete(cur); cur = byId.get(cur)?.parentId ?? null; }
      return next;
    });
    setFlash(nodeId);
    window.setTimeout(() => setFlash((f) => (f === nodeId ? null : f)), 1600);
    window.setTimeout(() => {
      document.getElementById(`node-${nodeId}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }, 60);
  }, [byId]);

  // ?focus=12 (depuis la recherche ou la page des trous), ?reply=1 pour ouvrir directement la réponse
  useEffect(() => {
    const f = Number(params.get('focus'));
    if (!sub || !f || !byId.has(f)) return;
    const a = byId.get(f)!;
    if (params.get('reply')) { setSelected(null); setDraft({ parentId: a.id, side: other(a.side) }); }
    else { setDraft(null); setSelected(a.id); }
    reveal(a.id);
    setParams({}, { replace: true });
  }, [sub, params, byId, reveal, setParams]);

  // Échap : annule le déplacement, puis ferme le panneau
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (moving) setMoving(null);
      else if (draft) setDraft(null);
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving, draft]);

  // Ctrl + molette : zoom
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(1.5, Math.max(0.4, +(z - Math.sign(e.deltaY) * 0.1).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [sub]);

  // L'emplacement du futur argument reste visible pendant qu'on le rédige
  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    const t = window.setTimeout(() => {
      document.getElementById('node-ghost')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 140);
    return () => clearTimeout(t);
  }, [draft]);

  // À l'ouverture du panneau, l'argument sélectionné ne doit pas rester caché dessous
  useEffect(() => {
    if (selected == null) return;
    const t = window.setTimeout(() => {
      document.getElementById(`node-${selected}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 140);
    return () => clearTimeout(t);
  }, [selected]);

  // Glisser le fond pour se déplacer
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.node, button, a')) return;
    const el = canvas.current!;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    el.classList.add('grabbing');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = canvas.current!;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const moved = Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y);
    drag.current = null;
    canvas.current?.classList.remove('grabbing');
    if (moved < 4 && !moving) { setSelected(null); setDraft(null); }
  };

  if (error) return <div className="page"><Empty icon="alert" title={error}><Link to="/">Retour aux sujets</Link></Empty></div>;
  if (!sub) return <div className="page" />;

  const gapIds = order.filter((a) => a.isGap).map((a) => a.id);
  const nextGap = () => {
    if (!gapIds.length) return;
    gapCursor.current = (gapCursor.current + 1) % gapIds.length;
    const g = gapIds[gapCursor.current];
    setDraft(null); setSelected(g); reveal(g);
  };

  const clickNode = async (a: Arg) => {
    if (moving) {
      if (inSubtree(a.id, moving)) return;
      await api(`/arguments/${moving}/move`, { body: { parentId: a.id } });
      const m = moving;
      setMoving(null);
      await reload();
      reveal(m);
      return;
    }
    setDraft(null);
    setSelected(a.id === selected ? null : a.id);
  };
  const moveToRoot = async () => {
    if (!moving) return;
    await api(`/arguments/${moving}/move`, { body: { parentId: null } });
    const m = moving;
    setMoving(null);
    await reload();
    reveal(m);
  };
  const startReply = (a: Arg) => { setSelected(null); setDraft({ parentId: a.id, side: other(a.side) }); reveal(a.id); };
  const toggle = (nodeId: number) => setCollapsed((c) => {
    const next = new Set(c);
    next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
    return next;
  });

  /* Colonne des réponses d'un argument (ou de la question), avec l'emplacement du brouillon en cours. */
  const Kids = (parentId: number | null) => {
    const children = kids.get(parentId) ?? [];
    const ghost = !!draft && draft.parentId === parentId;
    if (!children.length && !ghost) return null;
    const ghostSide = preview?.side ?? draft?.side ?? 'moi';
    const wires: Wire[] = children.map((k) => ({ id: k.id, cls: thread.has(k.id) ? 'on' : '' }));
    if (ghost) wires.push({ id: 'ghost', cls: 'draft' });
    return (
      <div className="kids">
        <Wires items={wires} />
        {children.map((k) => <div className="kid" key={k.id}>{Branch(k)}</div>)}
        {ghost && (
          <div className="kid" key="ghost">
            <div className="branch">
              <div id="node-ghost" className={`node ghost side-${ghostSide}`}>
                <div className="node-top"><SideTag side={ghostSide} /><span className="node-note">Brouillon</span></div>
                <p className="node-title">{preview?.title.trim() || (parentId == null ? 'Nouvel argument' : 'Nouvelle réponse')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const backerNames = [...new Set(order.flatMap((a) => a.backers.map((b) => b.name)))].sort((x, y) => x.localeCompare(y, 'fr'));

  const Branch = (a: Arg) => {
    const children = kids.get(a.id) ?? [];
    const replying = draft?.parentId === a.id;
    const isCollapsed = collapsed.has(a.id) && !replying;
    const dim = moving != null && inSubtree(a.id, moving);
    const isSelected = selected === a.id || replying;
    const unsourcedBacker = a.backers.some((b) => !b.source && !b.url);
    const offSide = (a.side === 'autre' && a.stance === 'pour') || (a.side === 'moi' && a.stance === 'contre');
    const filteredOut = backer !== '' && !a.backers.some((b) => b.name === backer);
    const hasFoot = a.isGap || !!a.closure || a.verify || unsourcedBacker || a.sources.length > 0 || a.backers.length > 0
      || (a.kind === 'sophisme' && !!a.fallacy) || offSide || a.principles.length > 0;
    return (
      <div className="branch">
        <div id={`node-${a.id}`} role="button" tabIndex={0} aria-pressed={isSelected}
          aria-label={`${SIDE_LABEL[a.side]} : ${a.title}`}
          className={[
            'node', `side-${a.side}`,
            isSelected ? 'selected' : thread.has(a.id) ? 'on-thread' : '',
            a.isGap ? 'is-gap' : '', a.closure ? 'is-concede' : '', a.closed && !a.closure ? 'is-closed' : '',
            backer ? (filteredOut ? 'filter-out' : 'filter-in') : '',
            flash === a.id ? 'flash' : '', dim ? 'dim' : '', moving && !dim ? 'target' : '',
          ].join(' ')}
          onClick={() => clickNode(a)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickNode(a); }
          }}>
          <div className="node-top">
            <SideTag side={a.side} />
            <KindChip kind={a.kind} />
            {a.parentId != null && a.relation !== 'refute' && <span className="node-rel">{RELATION_LABEL[a.relation].toLowerCase()}</span>}
            {a.refId && <span className="node-link" title="Argument réutilisé"><Icon name="link" size={13} /></span>}
            <Strength value={a.strength} />
          </div>
          <p className="node-title">{fr(a.title)}</p>
          {hasFoot && (
            <div className="node-foot">
              {a.isGap && <span className="nf nf-gap"><Icon name="alert" size={12} /> Sans réponse</span>}
              {offSide && <span className={`nf nf-stance-${a.stance}`}>{a.stance === 'pour' ? 'Dans ton sens' : 'Contre toi'}</span>}
              {a.closure && <span className="nf nf-concede"><Icon name="flag" size={12} /> {CLOSURE_LABEL[a.closure]}</span>}
              {(a.verify || unsourcedBacker) && <span className="nf nf-check"><Icon name="alert" size={12} /> À vérifier</span>}
              {a.kind === 'sophisme' && a.fallacy && <span className="nf nf-fallacy">{a.fallacy}</span>}
              {a.sources.length > 0 && <span className="nf">{plural(a.sources.length, 'source')}</span>}
              {a.backers.length > 0 && <span className="nf nf-backers" title="Défendu par">{a.backers.map((b) => b.name).join(' · ')}</span>}
              {a.principles.length > 0 && <span className="nf nf-principles" title="Principes">{a.principles.map((p) => p.title).join(' · ')}</span>}
            </div>
          )}
          {!moving && (
            <button className="node-add" title="Répondre à cet argument" aria-label="Répondre"
              onClick={(e) => { e.stopPropagation(); startReply(a); }}><Icon name="plus" size={14} /></button>
          )}
        </div>
        {children.length > 0 && (
          <button className={`toggle ${isCollapsed ? 'closed' : ''}`} onClick={() => toggle(a.id)} aria-expanded={!isCollapsed}
            title={isCollapsed ? `Déplier (${plural(countDesc(a.id), 'réponse')})` : 'Replier'} aria-label={isCollapsed ? 'Déplier' : 'Replier'}>
            {isCollapsed ? countDesc(a.id) : <Icon name="minus" size={11} />}
          </button>
        )}
        {!isCollapsed && Kids(a.id)}
      </div>
    );
  };

  const roots = kids.get(null) ?? [];
  const selectedArg = selected != null ? byId.get(selected) : undefined;
  const panelOpen = !!draft || !!selectedArg;
  const openRoot = (side: Side) => { setSelected(null); setDraft({ parentId: null, side }); };

  return (
    <div className={`tree-page ${panelOpen ? 'with-panel' : ''}`}>
      <div className="tree-bar">
        <nav className="crumbs" aria-label="Fil d'Ariane">
          <Link to="/">Sujets</Link><Icon name="chevron" size={13} />
          <Link to={`/sujet/${sub.topic.id}`}>{sub.topic.title}</Link><Icon name="chevron" size={13} />
          <span>{sub.title}</span>
        </nav>
        <div className="tree-tools">
          {backerNames.length > 0 && (
            <select className={`tree-filter ${backer ? 'on' : ''}`} value={backer} onChange={(e) => setBacker(e.target.value)} aria-label="Filtrer par parti" title="Mettre en avant ce que défend un parti">
              <option value="">Tous les partis</option>
              {backerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {gapIds.length > 0 && (
            <button className="btn btn-sm btn-gap" onClick={nextGap} title="Aller au trou suivant">
              <Icon name="alert" size={14} /> {plural(gapIds.length, 'trou')}
            </button>
          )}
          <Link to={`/entrainement?subtopicId=${sub.id}`} className="btn btn-sm" title="S'entraîner sur cet arbre"><Icon name="target" size={14} /> <span className="hide-sm">S'entraîner</span></Link>
          <Link to={`/fiche/${sub.id}`} className="btn btn-sm" title="Fiche antisèche"><Icon name="file" size={14} /> <span className="hide-sm">Fiche</span></Link>
          <button className="btn btn-sm" onClick={() => setConfirmFlip(true)} title="J'ai changé d'avis : échanger « Moi » et « En face »"><Icon name="swap" size={14} /> <span className="hide-sm">Inverser les camps</span></button>
        </div>
      </div>

      {moving && (
        <div className="move-banner" role="status">
          <Icon name="move" />
          <span className="move-text">Clique sur l'argument sous lequel placer « {byId.get(moving)?.title} »</span>
          <button className="btn btn-sm" onClick={moveToRoot}>Mettre à la racine</button>
          <button className="btn btn-sm" onClick={() => setMoving(null)}>Annuler</button>
        </div>
      )}

      <div className="tree-wrap">
        <div className="canvas" ref={canvas} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="tree" style={{ zoom }}>
            <div className="branch">
              <div className="root">
                <span className="root-label">Question</span>
                <p className="root-title">{fr(sub.title)}</p>
                {sub.description && <p className="root-desc">{sub.description}</p>}
                <div className="root-add">
                  <button className="btn btn-sm add-moi" onClick={() => openRoot('moi')}><Icon name="plus" size={14} /> Mon argument</button>
                  <button className="btn btn-sm add-autre" onClick={() => openRoot('autre')}><Icon name="plus" size={14} /> En face</button>
                </div>
              </div>
              {Kids(null)}
            </div>
            {roots.length === 0 && !draft && (
              <div className="tree-hint">
                <p><strong>L'arbre est vide.</strong></p>
                <p>Pose un premier argument avec les boutons ci-contre, ou dis à Claude : « Ajoute dans Répartie l'arbre de ce qu'on vient de voir. »</p>
              </div>
            )}
          </div>
        </div>

        {draft && (
          <Editor key={`new-${draft.parentId}-${draft.side}`} sub={sub} draft={draft} onPreview={setPreview}
            onClose={() => setDraft(null)} onChanged={reload} onReply={() => {}} onMove={() => {}} onDelete={() => {}}
            onCreated={async (a, thenReply) => {
              await reload();
              if (thenReply) setDraft({ parentId: a.id, side: other(a.side) });
              else { setDraft(null); setSelected(a.id); }
              reveal(a.id);
            }} />
        )}
        {!draft && selectedArg && (
          <Editor key={selectedArg.id} sub={sub} arg={selectedArg}
            onClose={() => setSelected(null)} onChanged={reload} onCreated={() => {}}
            onReply={startReply}
            onMove={(a) => { setSelected(null); setMoving(a.id); }}
            onDelete={setToDelete} />
        )}
      </div>

      <div className="tree-status">
        <span className="key"><i className="swatch swatch-moi" /> Moi</span>
        <span className="key"><i className="swatch swatch-autre" /> En face</span>
        <span className="key"><i className="swatch swatch-gap" /> Sans réponse</span>
        <span className="status-count hide-sm">{plural(order.length, 'argument')}</span>
        <span className="status-hint hide-sm">Glisser le fond pour se déplacer, Ctrl + molette pour zoomer</span>
        <span className="zoom">
          <button className="btn-icon" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Dézoomer" title="Dézoomer"><Icon name="minus" size={14} /></button>
          <button className="zoom-val" onClick={() => setZoom(1)} title="Revenir à 100 %">{Math.round(zoom * 100)} %</button>
          <button className="btn-icon" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} aria-label="Zoomer" title="Zoomer"><Icon name="plus" size={14} /></button>
          <button className="btn-icon" title="Tout déplier" aria-label="Tout déplier" onClick={() => setCollapsed(new Set())}><Icon name="expand" size={14} /></button>
        </span>
      </div>

      {toDelete && (
        <Confirm title="Supprimer cet argument ?" onClose={() => setToDelete(null)}
          message={<>« {toDelete.title} »{countDesc(toDelete.id) > 0 && <> et les {plural(countDesc(toDelete.id), 'réponse')} en dessous</>} seront supprimés définitivement.</>}
          onConfirm={async () => { await api(`/arguments/${toDelete.id}`, { method: 'DELETE' }); setSelected(null); reload(); }} />
      )}
      {confirmFlip && (
        <Confirm title="Inverser les camps ?" confirmLabel="Inverser" danger={false} onClose={() => setConfirmFlip(false)}
          message="Tout ce qui était « Moi » devient « En face », et inversement. Tes progrès d'entraînement sur cette sous-partie repartent de zéro. Tu peux ré-inverser à tout moment."
          onConfirm={async () => { await api(`/subtopics/${sub.id}/flip`, { method: 'POST', body: {} }); reload(); }} />
      )}
    </div>
  );
}
