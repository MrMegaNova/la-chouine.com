import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { friendsApi } from '@/api/client';
import type { GameOpts, Difficulty } from '@/game/types';

function BtnGroup<T extends string>({
  options, value, onChange,
}: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="btn-group">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Play() {
  const { startGame } = useGameStore();
  const { user, token } = useAuthStore();
  const navigate = useNavigate();

  // AI config
  const [aiCount, setAiCount]     = useState<2 | 3 | 4>(2);
  const [aiVariant, setAiVariant] = useState<'classic' | 'mondoubleau'>('classic');
  const [diff, setDiff]           = useState<Difficulty>('normal');
  const [aiTarget, setAiTarget]   = useState<3 | 5>(3);

  // Local config
  const [localCount, setLocalCount]     = useState<2 | 3 | 4>(2);
  const [localVariant, setLocalVariant] = useState<'classic' | 'mondoubleau'>('classic');
  const [localNames, setLocalNames]     = useState(['', '', '', '']);
  const [localTarget, setLocalTarget]   = useState<3 | 5>(3);

  const [friends, setFriends] = useState<{ id: string; username: string }[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);

  const launch = (opts: GameOpts) => { startGame(opts); navigate('/jeu'); };

  const startAI = () => {
    const names = [user?.username ?? 'Vous'];
    for (let i = 1; i < aiCount; i++)
      names.push(aiCount > 2 ? `Ordinateur ${i}` : 'Ordinateur');
    launch({ mode: 'ai', variant: aiVariant, playerCount: aiCount, diff, target: aiTarget, names });
  };

  const startLocal = () => {
    const names = Array.from({ length: localCount }, (_, i) =>
      localNames[i].trim() || `Joueur ${i + 1}`
    );
    launch({ mode: 'local', variant: localVariant, playerCount: localCount, target: localTarget, names });
  };

  const loadFriends = async () => {
    if (!token) return;
    const { ok, data } = await friendsApi.list(token);
    if (ok) { setFriends(data); setFriendsLoaded(true); }
  };

  if (!friendsLoaded && user) loadFriends();

  const variantHint = (v: string) => v === 'mondoubleau'
    ? 'Pas de retourne — l\'atout est fixé par la première annonce.'
    : 'La retourne fixe l\'atout dès la donne.';

  return (
    <div className="wrap" style={{ padding: '36px 0 60px' }}>
      <h2 className="section-title">Lancer une partie</h2>
      <p className="section-sub">Choisissez votre mode, votre format et c'est parti.</p>

      <div className="grid2" style={{ marginBottom: 18 }}>
        {/* AI panel */}
        <div className="panel">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 14 }}>🤖 Contre l'ordinateur</h3>

          <div className="field">
            <label>Nombre de joueurs</label>
            <BtnGroup options={[{label:'2',value:'2'},{label:'3',value:'3'},{label:'4',value:'4'}] as any}
              value={String(aiCount) as any} onChange={v => setAiCount(Number(v) as 2|3|4)} />
          </div>

          <div className="field">
            <label>Variante</label>
            <BtnGroup options={[{label:'Classique',value:'classic'},{label:'Mondoubleau',value:'mondoubleau'}]}
              value={aiVariant} onChange={setAiVariant} />
            <p className="field-hint">{variantHint(aiVariant)}</p>
          </div>

          <div className="field">
            <label>Difficulté</label>
            <BtnGroup options={[{label:'Débutant',value:'easy'},{label:'Confirmé',value:'normal'},{label:'Expert',value:'hard'}]}
              value={diff} onChange={setDiff} />
          </div>

          <div className="field">
            <label>Partie en</label>
            <BtnGroup options={[{label:'3 points',value:'3'},{label:'5 points',value:'5'}] as any}
              value={String(aiTarget) as any} onChange={v => setAiTarget(Number(v) as 3|5)} />
          </div>

          <button className="btn btn--gold btn--full" style={{ marginTop: 6 }} onClick={startAI}>
            Commencer
          </button>
          <p className="note" style={{ marginTop: 12 }}>
            Disponible sans inscription. Connecté, le résultat est ajouté à votre historique.
          </p>
        </div>

        {/* Local panel */}
        <div className="panel">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 14 }}>👥 En local</h3>

          <div className="field">
            <label>Nombre de joueurs</label>
            <BtnGroup options={[{label:'2',value:'2'},{label:'3',value:'3'},{label:'4',value:'4'}] as any}
              value={String(localCount) as any} onChange={v => setLocalCount(Number(v) as 2|3|4)} />
          </div>

          <div className="field">
            <label>Variante</label>
            <BtnGroup options={[{label:'Classique',value:'classic'},{label:'Mondoubleau',value:'mondoubleau'}]}
              value={localVariant} onChange={setLocalVariant} />
          </div>

          {Array.from({ length: localCount }, (_, i) => (
            <div className="field" key={i}>
              <label>Nom du joueur {i + 1}</label>
              <input
                maxLength={16}
                placeholder={`Joueur ${i + 1}`}
                value={localNames[i]}
                onChange={e => setLocalNames(n => { const a = [...n]; a[i] = e.target.value; return a; })}
              />
            </div>
          ))}

          <div className="field">
            <label>Partie en</label>
            <BtnGroup options={[{label:'3 points',value:'3'},{label:'5 points',value:'5'}] as any}
              value={String(localTarget) as any} onChange={v => setLocalTarget(Number(v) as 3|5)} />
          </div>

          <button className="btn btn--ghost btn--full" onClick={startLocal}>Commencer</button>
        </div>
      </div>

      {/* Friends panel */}
      <div className="panel">
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 6 }}>🌐 Entre amis (2 joueurs)</h3>
        {!user ? (
          <p className="section-sub">
            <a href="/connexion" style={{ color: 'var(--gold-soft)', textDecoration: 'underline' }}>Connectez-vous</a> pour jouer en ligne.
          </p>
        ) : friends.length === 0 ? (
          <p className="section-sub">Ajoutez des amis depuis l'onglet <b>Amis</b>.</p>
        ) : (
          <div className="list">
            {friends.map(f => (
              <div key={f.id} className="list-row">
                <div className="list-row__avatar">{f.username.slice(0, 2).toUpperCase()}</div>
                <div className="list-row__meta">
                  <b className="list-row__name">{f.username}</b>
                </div>
                <div className="list-row__actions">
                  <button className="btn btn--gold btn--sm" onClick={() =>
                    launch({ mode: 'friend', variant: 'classic', playerCount: 2, diff: 'hard', target: 3, names: [user.username, f.username], oppId: f.id })
                  }>Défier</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
