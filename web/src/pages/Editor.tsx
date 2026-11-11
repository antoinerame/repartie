import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, type Arg, type Backer, CLOSURE_HINT, CLOSURE_LABEL, type Closure, FALLACIES, type Kind, KIND_HINT, KIND_LABEL, PARTIES,
  type Principle, type Relation, RELATION_HINT, RELATION_LABEL, type SearchResult, type Side, type Source, type SubFull, useData,
} from '../api';
import { Icon, SideTag } from '../ui';

export interface Draft { parentId: number | null; side: Side }

interface Form {
  side: Side; relation: Relation; title: string; body: string; kind: Kind; fallacy: string; strength: number;
  verify: boolean; closure: Closure; rebound: string; sources: Source[]; backers: Backer[]; principles: string[];
}

const RELATIONS: Relation[] = ['refute', 'renforce', 'nuance'];
const CLOSURES: Closure[] = ['', 'concede', 'valeurs'];

const KINDS: Kind[] = ['fait', 'valeur', 'exemple', 'sophisme'];
const STRENGTH_LABEL = ['', 'Fragile', 'Correct', 'Solide'];

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

export default function Editor({ sub, arg, draft, onClose, onCreated, onReply, onMove, onDelete, onChanged, onPreview }: {
  sub: SubFull;
  arg?: Arg;
  draft?: Draft;
  onClose: () => void;
  onCreated: (a: Arg, thenReply: boolean) => void;
  onReply: (a: Arg) => void;
  onMove: (a: Arg) => void;
  onDelete: (a: Arg) => void;
  onChanged: () => void;
  /** En création : remonte le camp et le titre en cours pour l'aperçu dans l'arbre. */
  onPreview?: (p: { side: Side; title: string }) => void;
}) {
  const creating = !arg;
  const parent = creating
    ? sub.arguments.find((a) => a.id === draft!.parentId)
    : sub.arguments.find((a) => a.id === arg!.parentId);
  /* Le fil : tout ce qui précède cet argument, de la question jusqu'à son parent. */
  const chain: Arg[] = [];
  for (let p = parent; p; p = sub.arguments.find((a) => a.id === p!.parentId)) chain.unshift(p);
  const shown = chain.slice(-3);
  const [form, setForm] = useState<Form>(() => arg
    ? {
      side: arg.side, relation: arg.relation, title: arg.title, body: arg.body, kind: arg.kind, fallacy: arg.fallacy,
      strength: arg.strength, verify: arg.verify, closure: arg.closure, rebound: arg.rebound, sources: arg.sources,
      backers: arg.backers, principles: arg.principles.map((p) => p.title),
    }
    : {
      side: draft!.side, relation: parent && parent.side === draft!.side ? 'renforce' : 'refute', title: '', body: '',
      kind: 'fait', fallacy: '', strength: 2, verify: false, closure: '', rebound: '', sources: [], backers: [], principles: [],
    });
  const relationTouched = useRef(!creating);
  /* Position qui résultera de ce camp et de cette relation. */
  const stance = parent
    ? (form.relation === 'renforce' ? parent.stance : parent.stance === 'pour' ? 'contre' : 'pour')
    : form.side === 'moi' ? 'pour' : 'contre';
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'new' | 'reuse'>('new');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { autoGrow(titleRef.current); autoGrow(bodyRef.current); }, [form.title, form.body, tab]);
  useEffect(() => { if (creating) titleRef.current?.focus({ preventScroll: true }); }, [creating]);
  useEffect(() => { if (creating) onPreview?.({ side: form.side, title: form.title }); }, [creating, form.side, form.title, onPreview]);

  /* --- enregistrement automatique en mode édition --- */
  const pending = useRef<Form | null>(null);
  const timer = useRef<number | null>(null);
  const save = async () => {
    const f = pending.current;
    if (!f || !arg) return;
    pending.current = null;
    setStatus('saving');
    try {
      await api(`/arguments/${arg.id}`, { method: 'PATCH', body: f });
      setStatus('saved');
      onChanged();
    } catch (e: any) { setStatus('error'); setError(e.message); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); saveRef.current(); }
  }, []);

  const update = (patch: Partial<Form>, immediate = false) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (creating) return;
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; saveRef.current(); }, immediate ? 0 : 600);
  };

  const create = async (thenReply: boolean) => {
    if (!form.title.trim()) { titleRef.current?.focus(); return; }
    try {
      const a = await api<Arg>('/arguments', { body: { ...form, subtopicId: sub.id, parentId: draft!.parentId } });
      onCreated(a, thenReply);
    } catch (e: any) { setError(e.message); }
  };

  const setSource = (i: number, patch: Partial<Source>) =>
    update({ sources: form.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <aside className={`drawer side-${form.side}`} aria-label={creating ? 'Nouvel argument' : "Détail de l'argument"}>
      <header className="drawer-head">
        <div className="drawer-title">
          <SideTag side={form.side} />
          <strong>{creating ? 'Nouvel argument' : 'Argument'}</strong>
          {!creating && (
            <span className={`save-status ${status}`} role="status">
              {status === 'saving' && 'Enregistrement…'}
              {status === 'saved' && <><Icon name="check" size={13} /> Enregistré</>}
              {status === 'error' && error}
            </span>
          )}
        </div>
        <button className="btn-icon" onClick={onClose} aria-label="Fermer" title="Fermer (Échap)"><Icon name="x" /></button>
      </header>

      <div className="drawer-body">
        <div className="ctx">
          <span className="ctx-label">{parent ? 'En réponse à' : 'Ouverture'}</span>
          {parent ? (
            <ol className="ctx-thread">
              {chain.length > shown.length && <li className="ctx-more">{chain.length - shown.length} plus haut dans le fil</li>}
              {shown.map((c, i) => (
                <li key={c.id} className={`ctx-line side-${c.side} ${i === shown.length - 1 ? 'last' : ''}`}>
                  <SideTag side={c.side} /><span>{c.title}</span>
                </li>
              ))}
            </ol>
          ) : <p className="ctx-root">{sub.title}</p>}
        </div>

        {creating && (
          <div className="tabs">
            <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>Rédiger</button>
            <button className={tab === 'reuse' ? 'on' : ''} onClick={() => setTab('reuse')}><Icon name="link" size={14} /> Réutiliser un argument</button>
          </div>
        )}

        {arg?.refFrom && (
          <div className="notice">
            <Icon name="link" size={15} />
            <span>Argument réutilisé depuis <Link to={`/arbre/${arg.refFrom.subtopicId}?focus=${arg.refId}`}>{arg.refFrom.topicTitle} › {arg.refFrom.subtopicTitle}</Link>. Le modifier ici le modifie partout.</span>
          </div>
        )}
        {!!arg?.usedCount && (
          <div className="notice"><Icon name="link" size={15} /><span>Réutilisé dans {arg.usedCount} autre{arg.usedCount > 1 ? 's' : ''} endroit{arg.usedCount > 1 ? 's' : ''}. Tes modifications s'y appliquent aussi.</span></div>
        )}

        <div className="prop">
          <span className="prop-label">Camp</span>
          <div className="segmented sides">
            {(['moi', 'autre'] as Side[]).map((s) => (
              <button key={s} type="button" className={`seg-${s} ${form.side === s ? 'on' : ''}`} onClick={() => {
                const patch: Partial<Form> = { side: s };
                if (parent && !relationTouched.current) patch.relation = parent.side === s ? 'renforce' : 'refute';
                update(patch, true);
              }}>
                {s === 'moi' ? 'Moi' : 'En face'}
              </button>
            ))}
          </div>
        </div>

        {parent && (
          <div className="prop">
            <span className="prop-label">Relation</span>
            <div className="segmented">
              {RELATIONS.map((r) => (
                <button key={r} type="button" title={RELATION_HINT[r]} className={form.relation === r ? 'on' : ''}
                  onClick={() => { relationTouched.current = true; update({ relation: r }, true); }}>{RELATION_LABEL[r]}</button>
              ))}
            </div>
            <small className="prop-hint">{RELATION_HINT[form.relation]}. <span className={`stance-hint stance-${stance}`}>{stance === 'pour' ? 'Va dans ton sens' : 'Va contre toi'}</span></small>
          </div>
        )}

        {creating && tab === 'reuse' ? (
          <Reuse sub={sub} draft={draft!} side={form.side} onCreated={(a) => onCreated(a, false)} />
        ) : (
          <>
            <label className="field">
              <span>Phrase choc <em>ce que tu dirais à l'oral</em></span>
              <textarea ref={titleRef} className="input-title" rows={2} value={form.title} maxLength={300}
                placeholder={form.side === 'moi' ? 'Ton argument, en une phrase' : "L'objection, sous sa meilleure forme"}
                onChange={(e) => update({ title: e.target.value })}
                onKeyDown={(e) => { if (creating && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) create(false); }} />
            </label>

            <label className="field">
              <span>Développement <em>2 ou 3 phrases</em></span>
              <textarea ref={bodyRef} rows={3} value={form.body} placeholder="Le raisonnement, le contexte, la nuance"
                onChange={(e) => update({ body: e.target.value })} />
            </label>

            <div className="prop">
              <span className="prop-label">Type</span>
              <div className="segmented">
                {KINDS.map((k) => (
                  <button key={k} type="button" title={KIND_HINT[k]} className={form.kind === k ? 'on' : ''} onClick={() => update({ kind: k }, true)}>{KIND_LABEL[k]}</button>
                ))}
              </div>
              <small className="prop-hint">{KIND_HINT[form.kind]}</small>
              {form.kind === 'sophisme' && (
                <div className="fallacy-pick">
                  <input list="fallacies" value={form.fallacy} placeholder="Lequel ? Ex. procès d'intention" onChange={(e) => update({ fallacy: e.target.value })} />
                  <datalist id="fallacies">{FALLACIES.map((x) => <option key={x} value={x} />)}</datalist>
                </div>
              )}
            </div>

            <div className="prop">
              <span className="prop-label" title="Force du raisonnement, pas fiabilité des faits">Solidité</span>
              <div className="segmented">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" className={form.strength === n ? 'on' : ''} onClick={() => update({ strength: n }, true)}>{STRENGTH_LABEL[n]}</button>
                ))}
              </div>
            </div>

            <label className="check">
              <input type="checkbox" checked={form.verify} onChange={(e) => update({ verify: e.target.checked }, true)} />
              <span><strong>À vérifier</strong><small>Un fait ou une attribution dont tu n'es pas sûr. À contrôler avant de le sortir en débat.</small></span>
            </label>

            <div className="prop">
              <span className="prop-label">Branche</span>
              <div className="segmented">
                {CLOSURES.map((c) => (
                  <button key={c || 'open'} type="button" title={CLOSURE_HINT[c]} className={form.closure === c ? 'on' : ''} onClick={() => update({ closure: c }, true)}>{c === 'valeurs' ? 'Valeurs' : CLOSURE_LABEL[c]}</button>
                ))}
              </div>
              <small className="prop-hint">{CLOSURE_HINT[form.closure]}</small>
              {form.closure && (
                <label className="field rebound-field">
                  <span>Et pourtant <em>la phrase pour rebondir</em></span>
                  <textarea rows={2} value={form.rebound} placeholder="Oui, et justement…" onChange={(e) => update({ rebound: e.target.value })} />
                </label>
              )}
            </div>

            <div className="field sources-field">
              <span>Sources et chiffres</span>
              {form.sources.map((s, i) => (
                <div className="source-row" key={i}>
                  <input value={s.label} placeholder="Chiffre ou référence" onChange={(e) => setSource(i, { label: e.target.value })} />
                  <div className="source-sub">
                    <input value={s.url ?? ''} placeholder="https://…" onChange={(e) => setSource(i, { url: e.target.value })} />
                    <input value={s.date ?? ''} placeholder="Année" className="source-date" onChange={(e) => setSource(i, { date: e.target.value })} />
                    <button type="button" className="btn-icon" aria-label="Retirer la source" onClick={() => update({ sources: form.sources.filter((_, j) => j !== i) }, true)}><Icon name="x" size={14} /></button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => update({ sources: [...form.sources, { label: '' }] })}><Icon name="plus" size={14} /> Ajouter une source</button>
            </div>

            <Backers value={form.backers} onChange={(backers, now) => update({ backers }, now)} />
            <Principles value={form.principles} onChange={(principles) => update({ principles }, true)} />
            {creating && error && <p className="error">{error}</p>}
          </>
        )}
      </div>

      {creating ? (
        tab === 'new' && (
          <footer className="drawer-foot">
            <button className="btn btn-primary" onClick={() => create(false)} disabled={!form.title.trim()}>Ajouter</button>
            <button className="btn" onClick={() => create(true)} disabled={!form.title.trim()} title="Ajoute cet argument puis enchaîne sur sa réponse">Ajouter et répondre</button>
          </footer>
        )
      ) : (
        <footer className="drawer-foot">
          <button className="btn btn-primary" onClick={() => onReply(arg!)}><Icon name="reply" /> Répondre</button>
          <span className="spacer" />
          <button className="btn-icon" title="Déplacer" aria-label="Déplacer" onClick={() => onMove(arg!)}><Icon name="move" /></button>
          <button className="btn-icon danger" title="Supprimer" aria-label="Supprimer" onClick={() => onDelete(arg!)}><Icon name="trash" /></button>
        </footer>
      )}
    </aside>
  );
}

function Reuse({ sub, draft, side, onCreated }: { sub: SubFull; draft: Draft; side: Side; onCreated: (a: Arg) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult['arguments']>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api<SearchResult>(`/search?q=${encodeURIComponent(q)}`).then((r) => setRes(r.arguments)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  const pick = async (id: number) => {
    try { onCreated(await api<Arg>('/arguments', { body: { subtopicId: sub.id, parentId: draft.parentId, side, refId: id } })); }
    catch (e: any) { setError(e.message); }
  };
  return (
    <div className="field">
      <span>Chercher un argument déjà écrit</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. dette, démographie…" autoFocus />
      <small className="muted">Il apparaîtra ici avec le même contenu. Toute modification vaudra partout.</small>
      <div className="reuse-list">
        {res.map((a) => (
          <button key={a.id} className="reuse-item" onClick={() => pick(a.id)}>
            <strong>{a.title}</strong>
            <small>{a.topicTitle} › {a.subtopicTitle}</small>
          </button>
        ))}
        {q.trim().length >= 2 && res.length === 0 && <p className="muted">Aucun argument trouvé.</p>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Backers({ value, onChange }: { value: Backer[]; onChange: (v: Backer[], immediate?: boolean) => void }) {
  const { data: known } = useData<string[]>('/backers');
  const names = [...new Set([...PARTIES, ...(known ?? [])])].sort((a, b) => a.localeCompare(b, 'fr'));
  const set = (i: number, patch: Partial<Backer>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="field sources-field">
      <span>Défendu par <em>parti, personnalité, organisation</em></span>
      {value.map((b, i) => (
        <div className="source-row" key={i}>
          <div className="source-sub">
            <input list="backer-names" value={b.name} placeholder="Ex. RN, LFI, Institut Montaigne" onChange={(e) => set(i, { name: e.target.value })} />
            <button type="button" className="btn-icon" aria-label="Retirer" onClick={() => onChange(value.filter((_, j) => j !== i), true)}><Icon name="x" size={14} /></button>
          </div>
          <input value={b.source ?? ''} placeholder="Preuve : programme, déclaration, vote…" onChange={(e) => set(i, { source: e.target.value })} />
          <div className="source-sub">
            <input value={b.url ?? ''} placeholder="https://…" onChange={(e) => set(i, { url: e.target.value })} />
            <input value={b.date ?? ''} placeholder="Année" className="source-date" onChange={(e) => set(i, { date: e.target.value })} />
          </div>
          {!b.source && !b.url && b.name && <small className="backer-warn"><Icon name="alert" size={12} /> Sans source, l'attribution reste à vérifier</small>}
        </div>
      ))}
      <datalist id="backer-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <button type="button" className="btn btn-sm" onClick={() => onChange([...value, { name: '' }])}><Icon name="plus" size={14} /> Ajouter</button>
    </div>
  );
}

function Principles({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: known } = useData<Principle[]>('/principles');
  const [q, setQ] = useState('');
  const add = () => {
    const name = q.trim();
    if (!name) return;
    const existing = known?.find((p) => p.title.toLowerCase() === name.toLowerCase());
    const title = existing?.title ?? name;
    if (!value.some((v) => v.toLowerCase() === title.toLowerCase())) onChange([...value, title]);
    setQ('');
  };
  return (
    <div className="field">
      <span>Principes <em>tes critères qui reviennent d'un sujet à l'autre</em></span>
      {value.length > 0 && (
        <ul className="tag-list">
          {value.map((p) => (
            <li key={p} className="tag">{p}<button type="button" aria-label={`Retirer ${p}`} onClick={() => onChange(value.filter((v) => v !== p))}><Icon name="x" size={12} /></button></li>
          ))}
        </ul>
      )}
      <div className="source-sub">
        <input list="principle-names" value={q} placeholder="Ex. Tyrannie de la majorité" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!q.trim()}>Ajouter</button>
      </div>
      <datalist id="principle-names">{(known ?? []).map((p) => <option key={p.id} value={p.title} />)}</datalist>
    </div>
  );
}
