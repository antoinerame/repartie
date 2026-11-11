import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type SubCard, type TopicFull, useData } from '../api';
import { Confirm, Empty, Icon, Modal, Progress, plural } from '../ui';
import { TopicForm } from './Home';

export function SubForm({ topicId, initial, onClose, onSaved }: {
  topicId: number; initial?: { id: number; title: string; description: string };
  onClose: () => void; onSaved: (id: number) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (initial) { await api(`/subtopics/${initial.id}`, { method: 'PATCH', body: { title, description } }); onSaved(initial.id); }
      else { const s = await api<{ id: number }>('/subtopics', { body: { topicId, title, description } }); onSaved(s.id); }
      onClose();
    } catch (err: any) { setError(err.message); }
  };
  return (
    <Modal title={initial ? 'Modifier la sous-partie' : 'Nouvelle sous-partie'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Question ou thèse débattue</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Faut-il reculer l'âge légal de départ ?" autoFocus />
          </label>
          <label className="field">
            <span>Précision <em>(facultatif)</em></span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Le cadre du débat, en une phrase" />
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!title.trim()}>{initial ? 'Enregistrer' : "Créer et ouvrir l'arbre"}</button>
        </footer>
      </form>
    </Modal>
  );
}

export default function Topic() {
  const { id } = useParams();
  const { data: topic, error, reload } = useData<TopicFull>(`/topics/${id}`);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editSub, setEditSub] = useState<SubCard | null>(null);
  const [delSub, setDelSub] = useState<SubCard | null>(null);
  const [delTopic, setDelTopic] = useState(false);

  if (error) return <div className="page"><Empty icon="alert" title={error}><Link to="/">Retour aux sujets</Link></Empty></div>;
  if (!topic) return <div className="page" />;

  const gaps = topic.subtopics.reduce((n, s) => n + s.gapCount, 0);
  const trainable = topic.subtopics.reduce((n, s) => n + s.trainCount, 0);
  const mastered = topic.subtopics.reduce((n, s) => n + s.masteredCount, 0);
  const args = topic.subtopics.reduce((n, s) => n + s.argCount, 0);

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Fil d'Ariane"><Link to="/">Sujets</Link><Icon name="chevron" size={13} /><span>{topic.title}</span></nav>
      <header className="page-head">
        <div>
          <h1>{topic.title}</h1>
          {topic.description && <p className="lead">{topic.description}</p>}
          {topic.subtopics.length > 0 && (
            <p className="summary">
              <span><b>{topic.subtopics.length}</b> {topic.subtopics.length > 1 ? 'sous-parties' : 'sous-partie'}</span>
              <span><b>{args}</b> {args > 1 ? 'arguments' : 'argument'}</span>
              {gaps > 0 && <Link to={`/trous?topicId=${topic.id}`} className="is-gap"><b>{gaps}</b> {gaps > 1 ? 'trous' : 'trou'} à combler</Link>}
              {trainable > 0 && <span><b>{mastered}/{trainable}</b> répliques maîtrisées</span>}
            </p>
          )}
        </div>
        <div className="actions">
          {trainable > 0 && <Link to={`/entrainement?topicId=${topic.id}`} className="btn btn-primary"><Icon name="target" /> S'entraîner</Link>}
          {gaps > 0 && <Link to={`/trous?topicId=${topic.id}`} className="btn"><Icon name="alert" /> {plural(gaps, 'trou')}</Link>}
          <button className="btn-icon" title="Modifier le sujet" aria-label="Modifier le sujet" onClick={() => setEditing(true)}><Icon name="edit" /></button>
          <button className="btn-icon danger" title="Supprimer le sujet" aria-label="Supprimer le sujet" onClick={() => setDelTopic(true)}><Icon name="trash" /></button>
        </div>
      </header>

      {topic.subtopics.length === 0 && (
        <Empty title="Ce sujet n'a pas encore de sous-partie">
          <p>Une sous-partie est une question précise du débat. Chacune a son propre arbre d'arguments.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nouvelle sous-partie</button>
        </Empty>
      )}

      {topic.subtopics.length > 0 && (
        <>
          <ol className="index">
            {topic.subtopics.map((s, i) => (
              <li key={s.id} className="sub-row">
                <span className="index-num">{String(i + 1).padStart(2, '0')}</span>
                <Link to={`/arbre/${s.id}`} className="sub-link">
                  <h2>{s.title}</h2>
                  {s.description && <p className="muted clamp-2">{s.description}</p>}
                  <div className="sub-facts">
                    <span><b>{s.argCount}</b> {s.argCount > 1 ? 'arguments' : 'argument'}</span>
                    {s.gapCount > 0 && <span className="is-gap"><Icon name="alert" size={13} /> <span><b>{s.gapCount}</b> {s.gapCount > 1 ? 'trous' : 'trou'}</span></span>}
                    {s.trainCount > 0 && <span className="meter"><Progress value={s.masteredCount} total={s.trainCount} /> <span><b>{s.masteredCount}</b>/{s.trainCount} maîtrisées</span></span>}
                  </div>
                </Link>
                <div className="sub-tools">
                  <Link to={`/arbre/${s.id}`} className="btn btn-sm">Ouvrir l'arbre <Icon name="arrow" size={14} /></Link>
                  <Link to={`/entrainement?subtopicId=${s.id}`} className="btn btn-sm btn-quiet"><Icon name="target" size={14} /> S'entraîner</Link>
                  <Link to={`/fiche/${s.id}`} className="btn btn-sm btn-quiet"><Icon name="file" size={14} /> Fiche</Link>
                  <span className="sep" aria-hidden="true" />
                  <button className="btn-icon" title="Modifier" aria-label={`Modifier « ${s.title} »`} onClick={() => setEditSub(s)}><Icon name="edit" size={15} /></button>
                  <button className="btn-icon danger" title="Supprimer" aria-label={`Supprimer « ${s.title} »`} onClick={() => setDelSub(s)}><Icon name="trash" size={15} /></button>
                </div>
              </li>
            ))}
          </ol>
          <button className="row-add" onClick={() => setCreating(true)}><Icon name="plus" /> Nouvelle sous-partie</button>
        </>
      )}

      {editing && <TopicForm initial={topic} onClose={() => setEditing(false)} onSaved={reload} />}
      {creating && <SubForm topicId={topic.id} onClose={() => setCreating(false)} onSaved={(sid) => navigate(`/arbre/${sid}`)} />}
      {editSub && <SubForm topicId={topic.id} initial={editSub} onClose={() => setEditSub(null)} onSaved={reload} />}
      {delSub && (
        <Confirm title="Supprimer cette sous-partie ?" onClose={() => setDelSub(null)}
          message={<>« {delSub.title} » et ses {plural(delSub.argCount, 'argument')} seront supprimés définitivement.</>}
          onConfirm={async () => { await api(`/subtopics/${delSub.id}`, { method: 'DELETE' }); reload(); }} />
      )}
      {delTopic && (
        <Confirm title="Supprimer ce sujet ?" onClose={() => setDelTopic(false)}
          message={<>« {topic.title} », ses sous-parties et tous leurs arguments seront supprimés définitivement.</>}
          onConfirm={async () => { await api(`/topics/${topic.id}`, { method: 'DELETE' }); navigate('/'); }} />
      )}
    </div>
  );
}
