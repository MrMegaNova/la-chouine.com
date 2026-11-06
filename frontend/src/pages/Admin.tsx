import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type Dashboard } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { BarChart, LineChart, RankedTable, StatTile } from '@/components/admin/charts';

// Tableau de bord administrateur (#311). L'accès est vérifié par le serveur ;
// cette page ne fait qu'afficher sa réponse (403 → message).
const PERIODS = [7, 30, 90, 365] as const;
const DEVICES: Record<string, string> = { mobile: 'Téléphone', tablet: 'Tablette', desktop: 'Ordinateur' };

const countryName = (code: string) => {
  if (code === '??') return 'Inconnu';
  try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};

// Version de l'interface, posée à la construction de l'image.
const UI_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

function Versions({ server }: { server: Dashboard['server'] }) {
  const started = new Date(server.startedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const mismatch = server.version !== UI_VERSION;
  return (
    <div className="admin-versions" aria-label="Versions déployées">
      <span>Serveur <b>{server.version}</b>{server.commit && ` (${server.commit})`} · démarré le {started}</span>
      <span>Interface <b>{UI_VERSION}</b></span>
      {mismatch && (
        <span className="admin-versions__warn" role="note">
          ⚠ Versions différentes : redéployez le frontend, ou rechargez la page sans cache (Ctrl+Maj+R).
        </span>
      )}
    </div>
  );
}

const hours = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;

export default function Admin() {
  const token = useAuthStore(s => s.token);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    adminApi.dashboard(days, token).then(({ ok, status, data: body }) => {
      if (!active) return;
      if (ok) { setData(body); setError(null); }
      else setError(status === 403 ? 'Cette page est réservée aux administrateurs.' : body.error ?? 'Chargement impossible.');
    });
    return () => { active = false; };
  }, [token, days, reload]);

  if (!token) {
    return (
      <div className="wrap" style={{ paddingTop: 40 }}>
        <p>Connectez-vous avec un compte administrateur. <Link to="/connexion">Se connecter</Link></p>
      </div>
    );
  }

  const dayList = data?.daily.map(d => d.day) ?? [];

  return (
    <div className="wrap admin" style={{ paddingTop: 32, paddingBottom: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: 4 }}>Tableau de bord</h1>
          {data && <p className="section-sub" style={{ margin: 0 }}>Mis à jour à {new Date(data.generatedAt).toLocaleTimeString('fr-FR')}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Période">
          {PERIODS.map(p => (
            <button key={p} className={`btn btn--sm ${p === days ? 'btn--gold' : 'btn--ghost'}`} onClick={() => setDays(p)} aria-pressed={p === days}>
              {p === 365 ? '1 an' : `${p} j`}
            </button>
          ))}
          <button className="btn btn--sm btn--ghost" onClick={() => setReload(r => r + 1)}>Actualiser</button>
        </div>
      </div>

      {data && <Versions server={data.server} />}
      {error && <p className="form-error" role="alert" style={{ marginTop: 20 }}>{error}</p>}
      {!data && !error && <p style={{ marginTop: 20 }}>Chargement…</p>}

      {data && (
        <>
          <section className="admin-grid admin-grid--tiles">
            <StatTile label="En ligne" value={data.live?.online ?? '—'} hint={data.live ? `${data.live.inGame} en partie · ${data.live.inQueue} en file` : 'Redis indisponible'} />
            <StatTile label="Comptes" value={data.players.total} hint={`${data.players.verified} vérifiés`} />
            <StatTile label="Joueurs actifs" value={data.players.active7d} hint={`${data.players.active1d} sur 24 h · ${data.players.active30d} sur 30 j`} />
            <StatTile label="Temps de jeu" value={hours(data.playTime.totalMinutes)} hint={data.playTime.averageMinutes !== null ? `${data.playTime.averageMinutes.toLocaleString('fr-FR')} min par partie` : 'aucune partie chronométrée'} />
            <StatTile label="Visites" value={data.visits.totals.visits} hint={`${data.visits.totals.visitor_days} visiteurs-jours`} />
          </section>

          <section className="admin-grid">
            <div className="panel">
              <LineChart title="Visites par jour" days={dayList} series={[
                { key: 'visits', label: 'Pages vues', values: data.visits.byDay.map(d => d.visits) },
                { key: 'visitors', label: 'Visiteurs uniques', values: data.visits.byDay.map(d => d.visitors) },
              ]} />
            </div>
            <div className="panel">
              <LineChart title="Nombre de comptes" days={dayList} series={[
                { key: 'total', label: 'Comptes', values: data.daily.map(d => d.totalUsers) },
              ]} />
            </div>
            <div className="panel">
              <BarChart title="Joueurs actifs par jour" days={dayList} series={[
                { key: 'active', label: 'Joueurs', values: data.daily.map(d => d.activePlayers) },
              ]} />
            </div>
            <div className="panel">
              <BarChart title="Parties par jour" days={dayList} series={[
                { key: 'online', label: 'En ligne', values: data.daily.map(d => d.games.online) },
                { key: 'ai', label: 'Contre l’ordinateur', values: data.daily.map(d => d.games.ai) },
                { key: 'other', label: 'Entre amis (local)', values: data.daily.map(d => d.games.other) },
              ]} />
            </div>
            <div className="panel">
              <BarChart title="Temps de jeu par jour" unit="min" days={dayList} series={[
                { key: 'minutes', label: 'Minutes', values: data.daily.map(d => d.playMinutes) },
              ]} />
            </div>
            <div className="panel">
              <BarChart title="Inscriptions par jour" days={dayList} series={[
                { key: 'signups', label: 'Inscriptions', values: data.daily.map(d => d.signups) },
              ]} />
            </div>
          </section>

          <section className="admin-grid">
            <div className="panel"><RankedTable title="Pays" rows={data.visits.countries} labelOf={countryName} /></div>
            <div className="panel"><RankedTable title="Villes" rows={data.visits.cities} /></div>
            <div className="panel"><RankedTable title="Pages" rows={data.visits.pages} /></div>
            <div className="panel"><RankedTable title="Sites d’origine" rows={data.visits.referrers} /></div>
            <div className="panel"><RankedTable title="Appareils" rows={data.visits.devices} labelOf={l => DEVICES[l] ?? l} /></div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <h2 className="admin-chart-title">Dernières visites</h2>
            <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 8 }}>
              Adresses IP effacées après {data.ipRetentionDays} jours. Localisation : IP Geolocation by{' '}
              <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener" style={{ color: 'var(--gold-soft)' }}>DB-IP</a>.
            </p>
            <div style={{ overflow: 'auto', maxHeight: 520 }}>
              <table className="admin-table">
                <thead>
                  <tr><th>Date</th><th>Page</th><th>Joueur</th><th>IP</th><th>Lieu</th><th>Appareil</th><th>Origine</th></tr>
                </thead>
                <tbody>
                  {data.visits.recent.map((v, i) => (
                    <tr key={`${v.at}-${i}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(v.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{v.path}</td>
                      <td>{v.username ?? '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{v.ip ?? 'effacée'}</td>
                      <td>{[v.city, v.region, v.country && countryName(v.country)].filter(Boolean).join(', ') || '—'}</td>
                      <td>{DEVICES[v.device] ?? v.device}</td>
                      <td>{v.referrer ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
