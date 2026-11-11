import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Arg, type SubFull, useData } from '../api';
import { Empty, Icon, KindChip, Strength } from '../ui';
import { fr } from '../views-ui';

export default function Cheatsheet() {
  const { id } = useParams();
  const { data: sub, error } = useData<SubFull>(`/subtopics/${id}`);

  const sheet = useMemo(() => {
    if (!sub) return null;
    const args = sub.arguments;
    const depth = new Map<number, number>();
    const byId = new Map(args.map((a) => [a.id, a]));
    const d = (a: Arg): number => {
      if (depth.has(a.id)) return depth.get(a.id)!;
      const v = a.parentId && byId.has(a.parentId) ? d(byId.get(a.parentId)!) + 1 : 0;
      depth.set(a.id, v);
      return v;
    };
    const rank = (a: Arg, b: Arg) => b.strength - a.strength || d(a) - d(b) || a.position - b.position;
    const mine = args.filter((a) => a.side === 'moi').sort(rank).slice(0, 5);
    const objections = args.filter((a) => a.side === 'autre' && !a.concede && a.kind !== 'sophisme').sort(rank).slice(0, 6)
      .map((o) => ({ o, best: args.filter((r) => r.parentId === o.id && r.side === 'moi').sort(rank)[0] as Arg | undefined }));
    const concede = args.filter((a) => a.concede);
    const fallacies = args.filter((a) => a.side === 'autre' && a.kind === 'sophisme')
      .map((o) => ({ o, best: args.filter((r) => r.parentId === o.id && r.side === 'moi').sort(rank)[0] as Arg | undefined }));
    const seen = new Set<string>();
    const sources = args.filter((a) => a.side === 'moi').flatMap((a) => a.sources.map((s) => ({ s, a })))
      .filter(({ s }) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
    return { mine, objections, concede, fallacies, sources };
  }, [sub]);

  if (error) return <div className="page"><Empty icon="alert" title={error}><Link to="/">Retour aux sujets</Link></Empty></div>;
  if (!sub || !sheet) return <div className="page" />;

  return (
    <div className="page page-narrow sheet">
      <nav className="crumbs no-print" aria-label="Fil d'Ariane">
        <Link to="/">Sujets</Link><Icon name="chevron" size={13} />
        <Link to={`/sujet/${sub.topic.id}`}>{sub.topic.title}</Link><Icon name="chevron" size={13} />
        <Link to={`/arbre/${sub.id}`}>{sub.title}</Link><Icon name="chevron" size={13} />
        <span>Fiche</span>
      </nav>
      <header className="sheet-head">
        <div>
          <span className="eyebrow">Fiche antisèche · {sub.topic.title}</span>
          <h1>{fr(sub.title)}</h1>
          {sub.description && <p className="lead">{sub.description}</p>}
        </div>
        <button className="btn no-print" onClick={() => window.print()}><Icon name="print" /> Imprimer</button>
      </header>

      {sub.arguments.length === 0 && <Empty title="L'arbre est encore vide"><Link to={`/arbre/${sub.id}`} className="btn btn-primary">Ouvrir l'arbre</Link></Empty>}

      {sheet.mine.length > 0 && (
        <section className="sheet-section">
          <h2>Mes meilleurs arguments</h2>
          <ol className="sheet-list numbered">
            {sheet.mine.map((a) => (
              <li key={a.id}>
                <div className="sheet-line"><strong>{a.title}</strong><span className="sheet-tags"><KindChip kind={a.kind} /><Strength value={a.strength} /></span></div>
                {a.body && <p>{a.body}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {sheet.objections.length > 0 && (
        <section className="sheet-section">
          <h2>Ce qu'on va m'objecter</h2>
          <ul className="sheet-pairs">
            {sheet.objections.map(({ o, best }) => (
              <li key={o.id}>
                <div className="pair-q side-autre"><span className="pair-who">On me dit</span><p>{fr(o.title)}</p><span className="sheet-tags"><Strength value={o.strength} /></span></div>
                {best
                  ? <div className="pair-a side-moi"><span className="pair-who">Je réponds</span><div><strong>{best.title}</strong>{best.body && <p>{best.body}</p>}</div></div>
                  : <div className="pair-a pair-gap"><span className="pair-who">Sans réponse</span><Link to={`/arbre/${sub.id}?focus=${o.id}&reply=1`}>En préparer une</Link></div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.sources.length > 0 && (
        <section className="sheet-section">
          <h2>Chiffres et sources</h2>
          <ul className="sheet-sources">
            {sheet.sources.map(({ s, a }, i) => (
              <li key={i}>
                <span className="src-label">
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}
                  {s.date && <span className="muted"> ({s.date})</span>}
                </span>
                <small>Appuie : {a.title}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.concede.length > 0 && (
        <section className="sheet-section">
          <h2>Ce que je concède</h2>
          <ul className="sheet-list plain">
            {sheet.concede.map((a) => <li key={a.id}><strong>{a.title}</strong>{a.body && <p>{a.body}</p>}</li>)}
          </ul>
        </section>
      )}

      {sheet.fallacies.length > 0 && (
        <section className="sheet-section">
          <h2>Sophismes à repérer</h2>
          <ul className="sheet-pairs">
            {sheet.fallacies.map(({ o, best }) => (
              <li key={o.id}>
                <div className="pair-q side-autre"><span className="pair-who">On me dit</span><p>{o.title}{o.body && <small>{o.body}</small>}</p></div>
                {best && <div className="pair-a side-moi"><span className="pair-who">Je réponds</span><div><strong>{best.title}</strong></div></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
