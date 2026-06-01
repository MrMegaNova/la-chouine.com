import { useEffect } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { authApi } from '@/api/client';
import { Header } from '@/components/layout/Header';
import { GameTable } from '@/components/game/GameTable';
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
  const { restoreSession } = useAuthStore();
  const { game } = useGameStore();

  useEffect(() => { restoreSession(); }, []);

  return (
    <>
      {!game && <Header />}
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
    </>
  );
}
