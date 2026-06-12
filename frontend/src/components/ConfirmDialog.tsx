import { useEffect, useRef } from 'react';

// Modale de confirmation réutilisable (#68) — overlay + panneau bordé or, dans
// le style du site. Échap / clic sur l'overlay = annuler ; le focus va sur
// « Annuler » à l'ouverture pour qu'une action destructrice ne soit jamais le
// choix par défaut.
export function ConfirmDialog({
  title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
  danger = false, onConfirm, onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(8,18,13,.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 420, width: '100%', padding: 24,
          border: '1px solid var(--gold)', borderRadius: 18, background: '#102a20',
        }}
      >
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, margin: '0 0 8px' }}>{title}</h3>
        <p className="note" style={{ marginBottom: 20 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={cancelRef} className="btn btn--ghost btn--sm" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn btn--sm ${danger ? 'btn--wine' : 'btn--gold'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
