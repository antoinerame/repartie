import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Principle, type PrincipleFull, useData } from '../api';
import { Confirm, Empty, Icon, KindChip, Modal, SideTag, plural } from '../ui';
import { fr } from '../views-ui';

function PrincipleForm({ initial, onClose, onSaved }: {
  initial?: { id: number; title: string; description: string };
  onClose: () => void; onSaved: (id: number) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (initial) { await api(`/principles/${initial.id}`, { method: 'PATCH', body: { title, description } }); onSaved(initial.id); }
      else { const p = await api<{ id: number }>('/principles', { body: { title, description } }); onSaved(p.id); }
      onClose();
    } catch (err: any) { setError(err.message); }
  };
  return (
    <Modal title={initial ? 'Modifier le principe' : 'Nouveau principe'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Nom</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tyrannie de la majorité, Non-nuisance, Qui paie le coût…" autoFocus />
          </label>
          <label className="field">
            <span>Ce que tu entends par là <em>(facultatif)</em></span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Une majorité ne peut pas imposer n'importe quoi à une minorité, même par un vote." />
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!title.trim()}>{initial ? 'Enregistrer' : 'Créer'}</button>
        </footer>
      </form>
    </Modal>
  );
}

export function PrincipleList() {
  const { data: list, reload } = useData<Principle[]>('/principles');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="page page-narrow principles">
      <header className="page-head">
        <div>
          <h1>Mes principes</h1>
          <p className="lead">Les critères qui reviennent d'un sujet à l'autre. Chaque page liste les arguments qui s'en servent, pour vérifier que tu les appliques de façon cohérente.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nouveau principe</button>
      </header>

      {list && list.length === 0 && (
        <Empty title="Aucun principe pour l'instant">
          <p>Ajoute-en un ici, ou rattache un principe à un argument depuis son panneau dans l'arbre. Claude peut aussi les renseigner.</p>
        </Empty>
      )}

      {list && list.length > 0 && (
        <ol className="gap-list principle-list">
          {list.map((p, i) => (
            <li key={p.id} className="gap-row">
              <span className="gap-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <Link to={`/principe/${p.id}`} className="gap-main principle-link">
                <strong className="principle-title">{p.title}</strong>
                {p.description && <span className="muted clamp-2">{p.description}</span>}
              </Link>
              <span className="gap-count">{plural(p.useCount, 'argument')}</span>
            </li>
          ))}
        </ol>
      )}

      {creating && <PrincipleForm onClose={() => setCreating(false)} onSaved={(id) => { reload(); navigate(`/principe/${id}`); }} />}
    </div>
  );
}

export function PrincipleDetail() {
  const { id } = useParams();
  const { data: p, error, reload } = useData<PrincipleFull>(`/principles/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  if (error) return <div className="page"><Empty icon="alert" title={error}><Link to="/principes">Retour aux principes</Link></Empty></div>;
  if (!p) return <div className="page" />;

  const pour = p.uses.filter((u) => u.argument.stance === 'pour');
  const contre = p.uses.filter((u) => u.argument.stance === 'contre');
  const topics = new Set(p.uses.map((u) => u.topic.id));

  const Column = ({ title, hint, items }: { title: string; hint: string; items: PrincipleFull['uses'] }) => (
    <section className="principle-col">
      <h2>{title} <span className="gap-count">{items.length}</span></h2>
      <p className="muted principle-hint">{hint}</p>
      {items.length === 0 && <p className="muted">Aucun.</p>}
      <ul className="principle-uses">
        {items.map(({ argument: a, subtopic, topic }) => (
          <li key={a.id} className={`say say-sm side-${a.side}`}>
            <div className="say-meta"><SideTag side={a.side} /><KindChip kind={a.kind} /></div>
            <Link to={`/arbre/${subtopic.id}?focus=${a.id}`} className="say-title">{fr(a.title)}</Link>
            <small className="muted">{topic.title} › {subtopic.title}</small>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="page principles">
      <nav className="crumbs" aria-label="Fil d'Ariane"><Link to="/principes">Principes</Link><Icon name="chevron" size={13} /><span>{p.title}</span></nav>
      <header className="page-head">
        <div>
          <h1>{p.title}</h1>
          {p.description && <p className="lead">{p.description}</p>}
          <p className="muted principle-sum">{plural(p.uses.length, 'argument')} dans {plural(topics.size, 'sujet')}</p>
        </div>
        <div className="actions">
          <button className="btn-icon" title="Modifier" aria-label="Modifier" onClick={() => setEditing(true)}><Icon name="edit" /></button>
          <button className="btn-icon" title="Supprimer" aria-label="Supprimer" onClick={() => setDeleting(true)}><Icon name="trash" /></button>
        </div>
      </header>

      <p className="notice"><Icon name="swap" size={15} /><span>Test d'inversion : si tu invoques ce principe quand il t'arrange, ton adversaire te l'opposera quand il te dérange. Les deux colonnes doivent tenir ensemble.</span></p>

      <div className="principle-cols">
        <Column title="Je l'invoque" hint="Arguments qui vont dans ton sens" items={pour} />
        <Column title="On me l'oppose" hint="Arguments qui vont contre toi" items={contre} />
      </div>

      {editing && <PrincipleForm initial={p} onClose={() => setEditing(false)} onSaved={reload} />}
      {deleting && (
        <Confirm title="Supprimer ce principe ?" onClose={() => setDeleting(false)}
          message={<>« {p.title} » sera retiré des {plural(p.uses.length, 'argument')} qui s'en servent. Les arguments eux-mêmes restent.</>}
          onConfirm={async () => { await api(`/principles/${p.id}`, { method: 'DELETE' }); navigate('/principes'); }} />
      )}
    </div>
  );
}
