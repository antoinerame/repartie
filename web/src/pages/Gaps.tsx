import { Link, useSearchParams } from 'react-router-dom';
import { type GapItem, useData } from '../api';
import { Empty, Icon, KindChip, SideTag, Strength, plural } from '../ui';
import { fr } from '../views-ui';

type View = 'trous' | 'verifier';

export default function Gaps() {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topicId');
  const view: View = params.get('vue') === 'verifier' ? 'verifier' : 'trous';
  const q = topicId ? `?topicId=${topicId}` : '';
  const { data: gaps } = useData<GapItem[]>(`/gaps${q}`);
  const { data: checks } = useData<GapItem[]>(`/unsourced${q}`);
  const items = view === 'trous' ? gaps : checks;

  const groups = new Map<number, { title: string; topic: GapItem['topic']; items: GapItem[] }>();
  for (const g of items ?? []) {
    if (!groups.has(g.subtopic.id)) groups.set(g.subtopic.id, { title: g.subtopic.title, topic: g.topic, items: [] });
    groups.get(g.subtopic.id)!.items.push(g);
  }
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'verifier') next.set('vue', 'verifier'); else next.delete('vue');
    setParams(next, { replace: true });
  };

  return (
    <div className="page page-narrow gaps">
      <header className="page-head">
        <div>
          <h1>À travailler</h1>
          <p className="lead">
            {view === 'trous'
              ? "Les arguments contre toi auxquels tu n'as encore rien à répondre. Les plus solides d'abord."
              : "Ce que tu affirmes sans preuve : marqué « à vérifier », faits sans source, partis cités sans source."}
          </p>
        </div>
        {topicId && <Link to={view === 'verifier' ? '/trous?vue=verifier' : '/trous'} className="btn">Voir tous les sujets</Link>}
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'trous'} className={view === 'trous' ? 'on' : ''} onClick={() => setView('trous')}>
          Trous {gaps && <span className="tab-count">{gaps.length}</span>}
        </button>
        <button role="tab" aria-selected={view === 'verifier'} className={view === 'verifier' ? 'on' : ''} onClick={() => setView('verifier')}>
          À vérifier {checks && <span className="tab-count">{checks.length}</span>}
        </button>
      </div>

      {items && items.length === 0 && (
        view === 'trous'
          ? <Empty icon="check" title="Aucun trou"><p>Chaque argument contre toi a une réponse, ou se trouve dans une branche close (concédée ou désaccord de valeurs).</p></Empty>
          : <Empty icon="check" title="Rien à vérifier"><p>Tous tes faits ont une source et aucune attribution n'est en suspens.</p></Empty>
      )}

      {[...groups.entries()].map(([subId, g]) => (
        <section key={subId} className="gap-group">
          <h2>
            <Link to={`/arbre/${subId}`}><span className="gap-topic">{g.topic.title}</span><Icon name="chevron" size={13} />{g.title}</Link>
            <span className="gap-count">{plural(g.items.length, view === 'trous' ? 'trou' : 'point')}</span>
          </h2>
          <ol className="gap-list">
            {g.items.map(({ argument: a, path }, i) => (
              <li key={a.id} className="gap-row">
                <span className="gap-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div className="gap-main">
                  {path.length > 0 && (
                    <ol className="thread" aria-label="Ce qui précède">
                      {path.slice(-2).map((p) => (
                        <li key={p.id} className={`thread-line side-${p.side}`}><SideTag side={p.side} /><span>{p.title}</span></li>
                      ))}
                    </ol>
                  )}
                  <div className={`say say-sm side-${a.side}`}>
                    <div className="say-meta"><SideTag side={a.side} /><KindChip kind={a.kind} /><Strength value={a.strength} /></div>
                    <p className="say-title">{fr(a.title)}</p>
                    {a.body && <p className="say-body">{a.body}</p>}
                    {view === 'verifier' && (
                      <ul className="check-reasons">
                        {a.checks.map((c) => <li key={c}><Icon name="alert" size={12} /> {c}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
                {view === 'trous'
                  ? <Link to={`/arbre/${subId}?focus=${a.id}&reply=1`} className="btn btn-primary gap-reply"><Icon name="reply" /> Répondre</Link>
                  : <Link to={`/arbre/${subId}?focus=${a.id}`} className="btn gap-reply"><Icon name="edit" /> Compléter</Link>}
              </li>
            ))}
          </ol>
        </section>
      ))}

      {items && items.length > 0 && (
        <p className="tip">
          {view === 'trous'
            ? 'Tu peux aussi demander à Claude : « Trouve les trous dans Répartie et aide-moi à y répondre ».'
            : 'Tu peux aussi demander à Claude : « Cherche des sources pour ce qui est à vérifier dans Répartie ».'}
        </p>
      )}
    </div>
  );
}
