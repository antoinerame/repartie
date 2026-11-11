import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Arg, type TopicCard, type TrainCard, useData } from '../api';
import { Empty, Icon, KindChip, SideTag, Strength } from '../ui';
import { fr } from '../views-ui';

const GRADES = [
  { grade: 0, label: 'Raté', hint: 'Revient très vite', cls: 'grade-bad' },
  { grade: 1, label: 'Hésitant', hint: 'Revient demain', cls: 'grade-mid' },
  { grade: 2, label: 'Maîtrisé', hint: 'Revient plus tard', cls: 'grade-good' },
];

export default function Training() {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topicId');
  const subtopicId = params.get('subtopicId');
  const { data: topics } = useData<TopicCard[]>('/overview');

  const [cards, setCards] = useState<TrainCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [saved, setSaved] = useState(false);
  const [includeGaps, setIncludeGaps] = useState(false);
  const [results, setResults] = useState<number[]>([]);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setCards(null);
    const q = new URLSearchParams({ limit: '10' });
    if (topicId) q.set('topicId', topicId);
    if (subtopicId) q.set('subtopicId', subtopicId);
    if (includeGaps) q.set('gaps', '1');
    const c = await api<TrainCard[]>(`/training?${q}`);
    setCards(c); setIndex(0); setRevealed(false); setAnswer(''); setSaved(false); setResults([]);
  }, [topicId, subtopicId, includeGaps]);
  useEffect(() => { load(); }, [load]);

  const card = cards?.[index];
  const done = !!cards && cards.length > 0 && index >= cards.length;

  const grade = useCallback(async (g: number) => {
    if (!card) return;
    api(`/arguments/${card.argument.id}/grade`, { body: { grade: g } }).catch(() => {});
    setResults((r) => [...r, g]);
    setIndex((i) => i + 1); setRevealed(false); setAnswer(''); setSaved(false);
  }, [card]);

  useEffect(() => { if (card && !revealed) answerRef.current?.focus(); }, [card, revealed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      const typing = (e.target as HTMLElement).tagName === 'TEXTAREA';
      if (!revealed && e.key === 'Enter' && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); setRevealed(true); }
      else if (revealed && !typing && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); grade(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, grade]);

  const saveAnswer = async () => {
    if (!card || !answer.trim()) return;
    const lines = answer.trim().split('\n');
    const created = await api<Arg>('/arguments', { body: { parentId: card.argument.id, side: 'moi', title: lines[0].slice(0, 300), body: lines.slice(1).join('\n').trim() } });
    setSaved(true);
    setCards((cs) => cs && cs.map((c, i) => (i === index ? { ...c, responses: [...c.responses, created] } : c)));
  };

  const scopeLabel = (() => {
    if (!topics) return '';
    if (subtopicId) {
      for (const t of topics) { const s = t.subtopics.find((x) => String(x.id) === subtopicId); if (s) return `${t.title} › ${s.title}`; }
    }
    if (topicId) { const t = topics.find((x) => String(x.id) === topicId); if (t) return t.title; }
    return 'Tous les sujets';
  })();

  const count = (g: number) => results.filter((r) => r === g).length;
  const two = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="page page-narrow train">
      <header className="train-head">
        <div className="train-heading">
          <h1>Entraînement</h1>
          <p className="muted">On t'oppose un argument. Réponds, puis compare avec ce que tu avais préparé.</p>
        </div>
        <div className="train-scope">
          <select value={subtopicId ? `s${subtopicId}` : topicId ? `t${topicId}` : ''} aria-label="Périmètre"
            onChange={(e) => {
              const v = e.target.value;
              setParams(v.startsWith('s') ? { subtopicId: v.slice(1) } : v.startsWith('t') ? { topicId: v.slice(1) } : {});
            }}>
            <option value="">Tous les sujets</option>
            {topics?.map((t) => (
              <optgroup key={t.id} label={t.title}>
                <option value={`t${t.id}`}>Tout « {t.title} »</option>
                {t.subtopics.map((s) => <option key={s.id} value={`s${s.id}`}>{s.title}</option>)}
              </optgroup>
            ))}
          </select>
          <label className="check check-inline">
            <input type="checkbox" checked={includeGaps} onChange={(e) => setIncludeGaps(e.target.checked)} />
            <span>Inclure les trous</span>
          </label>
        </div>
      </header>

      {cards && cards.length === 0 && (
        <Empty icon="target" title="Rien à travailler ici pour le moment">
          <p>L'entraînement se nourrit des arguments « En face » auxquels tu as préparé au moins une réponse. Complète un arbre, ou coche « Inclure les trous » pour improviser.</p>
          <Link to="/" className="btn btn-primary">Voir mes sujets</Link>
        </Empty>
      )}

      {cards && cards.length > 0 && !done && card && (
        <>
          <div className="train-progress">
            <span className="train-count" aria-label={`Carte ${index + 1} sur ${cards.length}`}><b>{two(index + 1)}</b> / {two(cards.length)}</span>
            <div className="steps" aria-hidden="true">
              {cards.map((_, i) => <i key={i} className={i < index ? `done g${results[i]}` : i === index ? 'current' : ''} />)}
            </div>
            <span className="train-where">{card.subtopic.topicTitle} › {card.subtopic.title}</span>
          </div>

          <article className="train-card">
            {card.path.length > 0 && (
              <ol className="thread" aria-label="Ce qui précède">
                {card.path.slice(-3).map((p) => (
                  <li key={p.id} className={`thread-line side-${p.side}`}><SideTag side={p.side} /><span>{p.title}</span></li>
                ))}
              </ol>
            )}

            <div className="say side-autre">
              <div className="say-meta"><SideTag side="autre" /><KindChip kind={card.argument.kind} /><Strength value={card.argument.strength} /></div>
              <p className="say-title">{fr(card.argument.title)}</p>
              {card.argument.body && <p className="say-body">{card.argument.body}</p>}
            </div>

            {!revealed ? (
              <div className="train-answer">
                <label className="field">
                  <span>Que réponds-tu ? <em>à voix haute ou par écrit</em></span>
                  <textarea ref={answerRef} rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Ta réplique" />
                </label>
                <div className="train-actions">
                  <button className="btn btn-primary btn-lg" onClick={() => setRevealed(true)}>Révéler mes réponses <kbd>Entrée</kbd></button>
                  <span className="train-tip hide-sm">Depuis le champ de texte : Ctrl + Entrée</span>
                </div>
              </div>
            ) : (
              <div className="train-reveal">
                <div className={`compare ${answer.trim() ? 'two' : ''}`}>
                  {answer.trim() && (
                    <section className="compare-col your-answer">
                      <h3>Ta réponse</h3>
                      <p className="your-text">{answer}</p>
                      {saved
                        ? <span className="saved-note"><Icon name="check" size={13} /> Ajoutée à l'arbre</span>
                        : <button className="btn btn-sm" onClick={saveAnswer}><Icon name="plus" size={14} /> L'ajouter à l'arbre</button>}
                    </section>
                  )}
                  <section className="compare-col">
                    <h3>{card.responses.length ? 'Ce que tu avais préparé' : 'Aucune réponse préparée'}</h3>
                    {card.responses.length === 0 && (
                      <p className="muted">C'est un trou dans ton arbre. Note ta réponse avant de révéler, ou <Link to={`/arbre/${card.subtopic.id}?focus=${card.argument.id}&reply=1`}>ouvre l'arbre</Link> pour la rédiger.</p>
                    )}
                    {card.responses.map((r) => (
                      <div key={r.id} className="say say-sm side-moi response">
                        <div className="say-meta"><KindChip kind={r.kind} /><Strength value={r.strength} /></div>
                        <p className="say-title">{fr(r.title)}</p>
                        {r.body && <p className="say-body">{r.body}</p>}
                        {r.sources.length > 0 && (
                          <ul className="sources">
                            {r.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}{s.date && <span className="muted"> ({s.date})</span>}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </section>
                </div>
                <div className="grades">
                  <span className="grades-label">Comment était ta réponse ?</span>
                  <div className="grades-row">
                    {GRADES.map((g, i) => (
                      <button key={g.grade} className={`grade ${g.cls}`} onClick={() => grade(g.grade)}>
                        <kbd>{i + 1}</kbd><strong>{g.label}</strong><small>{g.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </article>
        </>
      )}

      {done && cards && (
        <div className="train-done">
          <span className="eyebrow">{scopeLabel}</span>
          <h2>Session terminée</h2>
          <dl className="done-stats">
            <div className="grade-good"><dt>{count(2)}</dt><dd>{count(2) > 1 ? 'maîtrisées' : 'maîtrisée'}</dd></div>
            <div className="grade-mid"><dt>{count(1)}</dt><dd>{count(1) > 1 ? 'hésitantes' : 'hésitante'}</dd></div>
            <div className="grade-bad"><dt>{count(0)}</dt><dd>{count(0) > 1 ? 'ratées' : 'ratée'}</dd></div>
          </dl>
          <ol className="done-list">
            {cards.map((c, i) => (
              <li key={c.argument.id} className={GRADES[results[i]]?.cls}>
                <span className="done-grade">{GRADES[results[i]]?.label}</span>
                <Link to={`/arbre/${c.subtopic.id}?focus=${c.argument.id}`}>{c.argument.title}</Link>
              </li>
            ))}
          </ol>
          <div className="done-actions">
            <button className="btn btn-primary btn-lg" onClick={load}>Nouvelle session</button>
            <Link to="/" className="btn btn-lg">Retour aux sujets</Link>
          </div>
        </div>
      )}
    </div>
  );
}
