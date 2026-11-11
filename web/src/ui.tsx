import { useEffect, useRef, type ReactNode } from 'react';
import { KIND_LABEL, type Kind, type Side, SIDE_LABEL } from './api';

const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  gear: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  check: 'M5 12l5 5 9-10',
  reply: 'M9 7l-5 5 5 5M4 12h10a6 6 0 0 1 6 6v1',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  minus: 'M5 12h14',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide, bare }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        {!bare && (
          <header className="modal-head">
            <h2>{title}</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Supprimer', danger = true, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body"><p className="muted">{message}</p></div>
      <footer className="modal-foot">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </footer>
    </Modal>
  );
}

export function SideTag({ side }: { side: Side }) {
  return <span className={`side-tag side-${side}`}>{SIDE_LABEL[side]}</span>;
}

export function KindChip({ kind }: { kind: Kind }) {
  return <span className={`chip kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function Strength({ value }: { value: number }) {
  return (
    <span className="strength" title={`Solidité ${value}/3`} aria-label={`Solidité ${value} sur 3`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}
    </span>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress" title={`${value} / ${total} répliques maîtrisées`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon = 'plus', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={18} /></div>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n > 1 ? many : one}`;
}
