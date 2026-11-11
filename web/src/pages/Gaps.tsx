import { Link, useSearchParams } from 'react-router-dom';
import { type GapItem, useData } from '../api';
import { Empty, Icon, KindChip, SideTag, Strength, plural } from '../ui';
import { fr } from '../views-ui';

export default function Gaps() {
  const [params] = useSearchParams();
  const topicId = params.get('topicId');
  const { data: gaps } = useData<GapItem[]>(`/gaps${topicId ? `?topicId=${topicId}` : ''}`);

  const groups = new Map<number, { title: string; topic: GapItem['topic']; items: GapItem[] }>();
  for (const g of gaps ?? []) {
    if (!groups.has(g.subtopic.id)) groups.set(g.subtopic.id, { title: g.subtopic.title, topic: g.topic, items: [] });
    groups.get(g.subtopic.id)!.items.push(g);
  }

  return (
    <div className="page page-narrow gaps">
      <header className="page-head">
        <div>
          <h1>Trous à combler</h1>
          <p className="lead">Les arguments d'en face auxquels tu n'as encore rien à répondre. Les plus solides d'abord.</p>
        </div>
        {topicId && <Link to="/trous" className="btn">Voir tous les sujets</Link>}
      </header>

      {gaps && gaps.length === 0 && (
        <Empty icon="check" title="Aucun trou">
          <p>Chaque argument adverse a une réponse, ou a été marqué comme concédé.</p>
        </Empty>
      )}

      {[...groups.entries()].map(([subId, g]) => (
        <section key={subId} className="gap-group">
          <h2>
            <Link to={`/arbre/${subId}`}><span className="gap-topic">{g.topic.title}</span><Icon name="chevron" size={13} />{g.title}</Link>
            <span className="gap-count">{plural(g.items.length, 'trou')}</span>
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
                  <div className="say say-sm side-autre">
                    <div className="say-meta"><SideTag side="autre" /><KindChip kind={a.kind} /><Strength value={a.strength} /></div>
                    <p className="say-title">{fr(a.title)}</p>
                    {a.body && <p className="say-body">{a.body}</p>}
                  </div>
                </div>
                <Link to={`/arbre/${subId}?focus=${a.id}&reply=1`} className="btn btn-primary gap-reply"><Icon name="reply" /> Répondre</Link>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {gaps && gaps.length > 0 && (
        <p className="tip">Tu peux aussi demander à Claude : « Trouve les trous dans Répartie et aide-moi à y répondre ».</p>
      )}
    </div>
  );
}
