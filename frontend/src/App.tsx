import { useEffect } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { useOnlineStore } from '@/store/onlineStore';
import { useNotificationStore } from '@/store/notificationStore';
import { authApi } from '@/api/client';
import { Header } from '@/components/layout/Header';
import { GameTable } from '@/components/game/GameTable';
import { OnlinePvP } from '@/components/game/OnlinePvP';
import Home from '@/pages/Home';
import Play from '@/pages/Play';
import Login from '@/pages/Login';
import Friends from '@/pages/Friends';
import Profile from '@/pages/Profile';
import Rules from '@/pages/Rules';
import '@/styles/main.scss';

function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  useEffect(() => {
    if (!token) return;
    authApi.verifyEmail(token).then(({ ok, data }) => {
      alert(ok ? (data as { message: string }).message : (data as { error?: string }).error ?? 'Erreur de vérification.');
    });
  }, [token]);

  return <Navigate to="/connexion" replace />;
}

export default function App() {
  const { restoreSession, token } = useAuthStore();
  const { game } = useGameStore();
  const onlineStatus = useOnlineStore(s => s.status);
  const { connectPresence, disconnectPresence } = useOnlineStore();

  useEffect(() => { restoreSession(); }, []);

  // Présence (#43) : socket ouvert tant que l'utilisateur est connecté — il
  // alimente le compteur de joueurs en ligne et sert de canal de reprise si
  // une partie était en cours (le serveur repousse l'état à la connexion).
  useEffect(() => {
    if (token) connectPresence(token);
    else disconnectPresence();
  }, [token]);

  // Badge d'invitations ami (#44) : chargé à la connexion et au retour sur
  // l'onglet (les invitations reçues hors ligne n'ont pas de notification WS).
  useEffect(() => {
    const { refresh, reset } = useNotificationStore.getState();
    if (!token) { reset(); return; }
    refresh(token);
    const onFocus = () => refresh(token);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [token]);

  // Le header est masqué dès qu'une table (locale ou en ligne) occupe l'écran.
  const tableActive = !!game || onlineStatus !== 'idle';

  return (
    <>
      {!tableActive && <Header />}
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/jouer" element={<Play />} />
          <Route path="/jeu" element={game ? null : <Navigate to="/jouer" replace />} />
          <Route path="/connexion" element={<Login />} />
          <Route path="/amis" element={<Friends />} />
          <Route path="/profil" element={<Profile />} />
          <Route path="/regles" element={<Rules />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {game && <GameTable />}
      <OnlinePvP />
      <NotificationToast />
    </>
  );
}

// Toast global des notifications (#44) — invitations ami, etc. Disparaît seul.
function NotificationToast() {
  const toast = useNotificationStore(s => s.toast);
  const clearToast = useNotificationStore(s => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(clearToast, 5000);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      role="status"
      onClick={clearToast}
      style={{
        position: 'fixed', top: 14, right: 14, zIndex: 90, cursor: 'pointer',
        padding: '10px 18px', borderRadius: 12, border: '1px solid var(--gold)',
        background: '#102a20', color: 'var(--cream)', fontSize: 14, maxWidth: '88vw',
        boxShadow: '0 10px 30px -10px rgba(0,0,0,.6)',
      }}
    >
      {toast}
    </div>
  );
}
