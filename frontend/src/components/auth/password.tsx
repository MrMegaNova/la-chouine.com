// Outils mot de passe partagés : règles de la politique, bouton œil (#78) et
// liste des règles. Réutilisés par la connexion/inscription, la page de
// réinitialisation (#107) et le changement de mot de passe au profil (#108).

export const pwdRules = [
  { label: '8 caractères minimum', test: (p: string) => p.length >= 8 },
  { label: 'Une majuscule', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Une minuscule', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Un chiffre', test: (p: string) => /[0-9]/.test(p) },
  { label: 'Un caractère spécial', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

/** Le mot de passe respecte-t-il toutes les règles de la politique ? */
export const passwordValid = (p: string) => pwdRules.every(r => r.test(p));

// Bouton œil (#78) : bascule l'affichage du mot de passe en clair.
export function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      aria-pressed={shown}
      title={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      onClick={onToggle}
      style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
        color: 'var(--gold-soft)', fontSize: 16, lineHeight: 1,
      }}
    >
      {shown ? '🙈' : '👁'}
    </button>
  );
}

// Liste de contrôle des règles, mise à jour à la frappe.
export function PasswordChecklist({ password }: { password: string }) {
  if (password.length === 0) return null;
  return (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {pwdRules.map(r => (
        <li key={r.label} style={{ fontSize: 12, color: r.test(password) ? 'var(--green, #4caf50)' : 'var(--muted, #888)' }}>
          {r.test(password) ? '✓' : '○'} {r.label}
        </li>
      ))}
    </ul>
  );
}
