import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, type SearchResult, type TopicCard, useData } from './api';
import { Icon, Modal, SideTag } from './ui';
import Home from './pages/Home';
import Topic from './pages/Topic';
import Tree from './pages/Tree';
import Training from './pages/Training';
import Cheatsheet from './pages/Cheatsheet';
import Gaps from './pages/Gaps';
import Settings from './pages/Settings';

interface Me { authRequired: boolean; authed: boolean; mcpTokenSet: boolean }

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const loadMe = useCallback(() => { api<Me>('/me').then(setMe).catch(() => setMe({ authRequired: true, authed: false, mcpTokenSet: false })); }, []);
  useEffect(() => {
    loadMe();
    const lost = () => setMe((m) => (m ? { ...m, authed: false } : m));
    window.addEventListener('auth-lost', lost);
    return () => window.removeEventListener('auth-lost', lost);
  }, [loadMe]);

  if (!me) return <div className="splash" />;
  if (!me.authed) return <Login onDone={loadMe} />;
  return <Shell me={me} onLogout={loadMe} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await api('/login', { body: { password } }); onDone(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <p className="muted">Accès privé. Entre le mot de passe pour ouvrir tes arbres de débat.</p>
        <label className="field">
          <span>Mot de passe</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !password}>Entrer</button>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <span className="logo">
      <svg className="logo-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect className="m-moi" x="0" y="2" width="12" height="6" />
        <rect className="m-autre" x="6" y="10" width="12" height="6" />
      </svg>
      <b className="logo-word">Répartie</b>
    </span>
  );
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: topics } = useData<TopicCard[]>('/overview');
  const gapCount = topics?.reduce((n, t) => n + t.gapCount, 0) ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="logo-link" aria-label="Accueil"><Logo /></Link>
        <nav className="nav">
          <NavLink to="/" end>Sujets</NavLink>
          <NavLink to="/entrainement">Entraînement</NavLink>
          <NavLink to="/trous">Trous{gapCount > 0 && <span className="badge badge-gap">{gapCount}</span>}</NavLink>
        </nav>
        <div className="topbar-right">
          <button className="search-btn" onClick={() => setSearchOpen(true)} aria-label="Rechercher">
            <Icon name="search" /><span>Rechercher</span><kbd>Ctrl K</kbd>
          </button>
          <ThemeToggle />
          <NavLink to="/reglages" className="btn-icon" aria-label="Réglages" title="Réglages"><Icon name="gear" /></NavLink>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sujet/:id" element={<Topic />} />
          <Route path="/arbre/:id" element={<Tree />} />
          <Route path="/entrainement" element={<Training />} />
          <Route path="/fiche/:id" element={<Cheatsheet />} />
          <Route path="/trous" element={<Gaps />} />
          <Route path="/reglages" element={<Settings me={me} onLogout={onLogout} />} />
          <Route path="*" element={<div className="page"><h1>Page introuvable</h1><p className="lead"><Link to="/">Retour aux sujets</Link></p></div>} />
        </Routes>
      </main>
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    setTheme(next);
  };
  return (
    <button className="btn-icon" onClick={toggle} aria-label="Changer de thème" title="Thème clair / sombre">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const seq = useRef(0);

  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api<SearchResult>(`/search?q=${encodeURIComponent(q)}`).then((r) => { if (mine === seq.current) { setRes(r); setActive(0); } }).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const items = res ? [
    ...res.topics.map((t) => ({ key: `t${t.id}`, to: `/sujet/${t.id}`, group: 'Sujet', title: t.title, sub: '', side: null as any })),
    ...res.subtopics.map((s) => ({ key: `s${s.id}`, to: `/arbre/${s.id}`, group: 'Sous-partie', title: s.title, sub: s.topicTitle, side: null as any })),
    ...res.arguments.map((a) => ({ key: `a${a.id}`, to: `/arbre/${a.subtopicId}?focus=${a.id}`, group: 'Argument', title: a.title, sub: `${a.topicTitle} › ${a.subtopicTitle}`, side: a.side })),
  ] : [];

  const go = (to: string) => { navigate(to); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && items[active]) go(items[active].to);
  };

  return (
    <Modal title="Rechercher" onClose={onClose} wide bare>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Un sujet, un argument, un chiffre…" aria-label="Rechercher" autoFocus />
          <kbd>Échap</kbd>
        </div>
        <div className="palette-results">
          {!q.trim() && <p className="muted palette-hint">La recherche porte sur les sujets, les sous-parties, les arguments et leurs sources.</p>}
          {q.trim() && res && items.length === 0 && <p className="muted palette-hint">Aucun résultat pour « {q} ».</p>}
          {items.map((it, i) => (
            <button key={it.key} className={`palette-item ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(it.to)}>
              <span className="palette-group">{it.group}</span>
              <span className="palette-text">
                <strong>{it.title}</strong>
                {it.sub && <small>{it.sub}</small>}
              </span>
              {it.side && <SideTag side={it.side} />}
            </button>
          ))}
        </div>
        <footer className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> parcourir</span>
          <span><kbd>↵</kbd> ouvrir</span>
        </footer>
      </div>
    </Modal>
  );
}
