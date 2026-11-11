import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type TopicCard, useData } from '../api';
import { Empty, Icon, Modal, Progress, plural } from '../ui';

export function TopicForm({ initial, onClose, onSaved }: {
  initial?: { id: number; title: string; description: string; emoji: string };
  onClose: () => void; onSaved: (id: number) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // L'emoji n'est plus affiché ni modifiable ici ; on renvoie la valeur existante pour ne pas toucher à l'API.
  const emoji = initial?.emoji ?? '💬';
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (initial) { await api(`/topics/${initial.id}`, { method: 'PATCH', body: { title, description, emoji } }); onSaved(initial.id); }
      else { const t = await api<{ id: number }>('/topics', { body: { title, description, emoji } }); onSaved(t.id); }
      onClose();
    } catch (err: any) { setError(err.message); }
  };
  return (
    <Modal title={initial ? 'Modifier le sujet' : 'Nouveau sujet'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Titre</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Retraites, Immigration, Nucléaire…" autoFocus />
          </label>
          <label className="field">
            <span>Description <em>(facultatif)</em></span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="En une phrase, de quoi on parle" />
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!title.trim()}>{initial ? 'Enregistrer' : 'Créer le sujet'}</button>
        </footer>
      </form>
    </Modal>
  );
}

export default function Home() {
  const { data: topics, reload } = useData<TopicCard[]>('/overview');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const totals = (topics ?? []).reduce(
    (acc, t) => ({ args: acc.args + t.argCount, gaps: acc.gaps + t.gapCount, train: acc.train + t.trainCount, mastered: acc.mastered + t.masteredCount }),
    { args: 0, gaps: 0, train: 0, mastered: 0 });

  const n = topics?.length ?? 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Sujets</h1>
          {topics && n > 0 && (
            <p className="summary">
              <span><b>{totals.args}</b> {totals.args > 1 ? 'arguments' : 'argument'}</span>
              {totals.gaps > 0 && <Link to="/trous" className="is-gap"><b>{totals.gaps}</b> {totals.gaps > 1 ? 'trous' : 'trou'} à combler</Link>}
              {totals.train > 0 && <span><b>{totals.mastered}/{totals.train}</b> répliques maîtrisées</span>}
            </p>
          )}
        </div>
        <div className="actions">
          {totals.train > 0 && <Link to="/entrainement" className="btn"><Icon name="target" /> S'entraîner</Link>}
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nouveau sujet</button>
        </div>
      </header>

      {topics && n === 0 && (
        <Empty title="Aucun sujet pour l'instant">
          <p>Crée un premier sujet ici, ou demande à Claude de le faire pendant une discussion (voir Réglages).</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nouveau sujet</button>
        </Empty>
      )}

      {topics && n > 0 && (
        <>
          <ol className="index">
            <li className="index-cols eyebrow" aria-hidden="true">
              <span>N°</span><span>Sujet</span><span>Sous-parties</span><span>État</span>
            </li>
            {topics.map((t, i) => (
              <li key={t.id}>
                <Link to={`/sujet/${t.id}`} className="index-row">
                  <span className="index-num">{String(i + 1).padStart(2, '0')}</span>
                  <div className="index-main">
                    <h2>{t.title}</h2>
                    {t.description && <p className="muted clamp-2">{t.description}</p>}
                  </div>
                  <ul className="index-subs">
                    {t.subtopics.slice(0, 3).map((s) => <li key={s.id}>{s.title}</li>)}
                    {t.subtopics.length > 3 && <li className="more">et {plural(t.subtopics.length - 3, 'autre')}</li>}
                    {t.subtopics.length === 0 && <li className="more">Aucune sous-partie</li>}
                  </ul>
                  <div className="index-state">
                    <span><b>{t.argCount}</b> {t.argCount > 1 ? 'arguments' : 'argument'}</span>
                    {t.gapCount > 0 && <span className="is-gap"><Icon name="alert" size={13} /> <span><b>{t.gapCount}</b> {t.gapCount > 1 ? 'trous' : 'trou'}</span></span>}
                    {t.trainCount > 0 && (
                      <span className="meter"><Progress value={t.masteredCount} total={t.trainCount} /> <span><b>{t.masteredCount}</b>/{t.trainCount}</span></span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
          <button className="row-add" onClick={() => setCreating(true)}><Icon name="plus" /> Nouveau sujet</button>
        </>
      )}

      {creating && <TopicForm onClose={() => setCreating(false)} onSaved={(id) => { reload(); navigate(`/sujet/${id}`); }} />}
    </div>
  );
}
