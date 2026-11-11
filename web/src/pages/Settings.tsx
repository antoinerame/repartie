import { useRef, useState } from 'react';
import { api } from '../api';
import { Confirm, Icon } from '../ui';

export default function Settings({ me, onLogout }: { me: { authRequired: boolean; mcpTokenSet: boolean }; onLogout: () => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [pending, setPending] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(''); setMessage('');
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'repartie') throw new Error("Ce fichier n'est pas un export Répartie.");
      if (mode === 'replace') setPending(data);
      else await doImport(data);
    } catch (err: any) { setError(err.message || 'Fichier illisible'); }
    e.target.value = '';
  };
  const doImport = async (data: any) => {
    try {
      const r = await api<{ topics: number; subtopics: number; arguments: number }>('/import', { body: { data, mode } });
      setMessage(`Import terminé : ${r.topics} sujet(s), ${r.subtopics} sous-partie(s), ${r.arguments} argument(s).`);
    } catch (err: any) { setError(err.message); }
  };

  const claudeCode = `claude mcp add --transport http repartie ${mcpUrl} --header "Authorization: Bearer TON_MCP_TOKEN"`;

  return (
    <div className="page">
      <header className="page-head"><div><h1>Réglages</h1></div></header>

      <section className="set set-first">
        <header className="set-side">
          <h2>Brancher Claude</h2>
          <p className="muted">Par MCP. Une fois branché, Claude lit tes arbres et y ajoute les arguments vus ensemble. Le site se met à jour en direct.</p>
        </header>
        <div className="set-body">
          {!me.mcpTokenSet && (
            <div className="notice notice-warn"><Icon name="alert" size={15} /><span>La variable <code>MCP_TOKEN</code> n'est pas définie sur le serveur{me.authRequired ? ' : le point d’accès MCP est désactivé.' : ' : le point d’accès MCP est ouvert sans jeton.'}</span></div>
          )}
          <h3>Claude (claude.ai, appli bureau et mobile)</h3>
          <p className="muted">Réglages → Connecteurs → Ajouter un connecteur personnalisé, avec cette adresse (remplace <code>TON_MCP_TOKEN</code> par la valeur de ton fichier <code>.env</code>) :</p>
          <div className="code-row">
            <code>{mcpUrl}/TON_MCP_TOKEN</code>
            <button className="btn btn-sm" onClick={() => copy(`${mcpUrl}/TON_MCP_TOKEN`, 'url')}><Icon name={copied === 'url' ? 'check' : 'copy'} size={14} /> {copied === 'url' ? 'Copié' : 'Copier'}</button>
          </div>
          <h3>Claude Code</h3>
          <div className="code-row">
            <code>{claudeCode}</code>
            <button className="btn btn-sm" onClick={() => copy(claudeCode, 'cc')}><Icon name={copied === 'cc' ? 'check' : 'copy'} size={14} /> {copied === 'cc' ? 'Copié' : 'Copier'}</button>
          </div>
          <h3>Ce que tu peux lui demander</h3>
          <ul className="examples">
            <li>« Enregistre dans Répartie l'arbre de ce qu'on vient de voir sur les retraites. »</li>
            <li>« Trouve les trous dans mon sujet Nucléaire et propose-moi des réponses. »</li>
            <li>« Joue l'adversaire sur la semaine de 4 jours, puis ajoute ce qu'on a découvert. »</li>
          </ul>
        </div>
      </section>

      <section className="set">
        <header className="set-side">
          <h2>Sauvegarde</h2>
          <p className="muted">Tout le contenu tient dans un seul fichier JSON.</p>
        </header>
        <div className="set-body">
          <h3>Exporter</h3>
          <div className="settings-row">
            <a className="btn" href="/api/export" download><Icon name="download" /> Exporter tout</a>
          </div>
          <h3>Importer</h3>
          <div className="segmented narrow" role="group" aria-label="Mode d'import">
            <button type="button" aria-pressed={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>Ajouter à l'existant</button>
            <button type="button" aria-pressed={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Tout remplacer</button>
          </div>
          <div className="settings-row">
            <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" /> Choisir un fichier…</button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={onFile} />
          </div>
          {message && <p className="ok" role="status">{message}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </section>

      {me.authRequired && (
        <section className="set">
          <header className="set-side"><h2>Session</h2></header>
          <div className="set-body">
            <div className="settings-row">
              <button className="btn" onClick={async () => { await api('/logout', { body: {} }); onLogout(); }}><Icon name="logout" /> Se déconnecter</button>
            </div>
          </div>
        </section>
      )}

      {pending && (
        <Confirm title="Tout remplacer ?" confirmLabel="Remplacer" onClose={() => setPending(null)}
          message="Tous tes sujets et arguments actuels seront supprimés et remplacés par le contenu du fichier. Pense à exporter d'abord."
          onConfirm={() => doImport(pending)} />
      )}
    </div>
  );
}
