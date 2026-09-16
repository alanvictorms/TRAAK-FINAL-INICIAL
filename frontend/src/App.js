import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from 'sonner';
import Shell from '@/components/Shell';
import LoginPage from '@/pages/LoginPage';
import CommandPage from '@/pages/CommandPage';
import IntegrationsPage from '@/pages/IntegrationsPage';
import LedgerPage from '@/pages/LedgerPage';
import PlayersPage from '@/pages/PlayersPage';
import SettingsPage from '@/pages/SettingsPage';
import TrackingPage from '@/pages/TrackingPage';
import InboxPage from '@/pages/InboxPage';
import RevenuePage from '@/pages/RevenuePage';
import PlatformPage from '@/pages/PlatformPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import GenericPage from '@/pages/GenericPage';
import '@/App.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'hsl(174 76% 4.9%)' }}><div className="text-xs text-muted-foreground">Carregando...</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/command" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route index element={<Navigate to="/command" replace />} />
        <Route path="command" element={<CommandPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="analytics/atendimento" element={<AnalyticsPage tab="atendimento" />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="integrations/:id" element={<IntegrationsPage />} />
        <Route path="domains" element={<GenericPage title="Domínios" module="domains" />} />
        <Route path="domains/:id" element={<GenericPage title="Domínio" module="domains" />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="tracking/sources" element={<GenericPage title="Fontes de tráfego" module="sources" />} />
        <Route path="tracking/:id" element={<TrackingPage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="ledger/:id" element={<LedgerPage />} />
        <Route path="monitoring" element={<GenericPage title="Monitoramento" module="monitoring" />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:id" element={<PlayersPage />} />
        <Route path="identity" element={<GenericPage title="Identity Graph" module="identity" />} />
        <Route path="identity/:id" element={<GenericPage title="Identidade" module="identity" />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:id" element={<InboxPage />} />
        <Route path="automations" element={<GenericPage title="Automações" module="automations" />} />
        <Route path="automations/:id" element={<GenericPage title="Editor de fluxo" module="automations" />} />
        <Route path="segments" element={<GenericPage title="Segmentos" module="segments" />} />
        <Route path="disparos" element={<GenericPage title="Disparos" module="disparos" />} />
        <Route path="media" element={<GenericPage title="Campanhas" module="campaigns" />} />
        <Route path="media/:id" element={<GenericPage title="Campanha" module="campaigns" />} />
        <Route path="revenue" element={<RevenuePage />} />
        <Route path="reports" element={<GenericPage title="Relatórios" module="reports" />} />
        <Route path="governance" element={<GenericPage title="Governança" module="governance" />} />
        <Route path="approvals" element={<GenericPage title="Aprovações" module="approvals" />} />
        <Route path="settings/general" element={<SettingsPage />} />
        <Route path="settings/team" element={<SettingsPage />} />
        <Route path="settings/api" element={<SettingsPage />} />
        <Route path="settings/billing" element={<GenericPage title="Faturamento" module="billing" />} />
        <Route path="settings/notifications" element={<GenericPage title="Notificações" module="notifications" />} />
        <Route path="settings/audit" element={<SettingsPage />} />
        <Route path="platform" element={<PlatformPage />} />
        <Route path="platform/tenants" element={<PlatformPage />} />
        <Route path="platform/plans" element={<PlatformPage />} />
        <Route path="platform/ai" element={<PlatformPage />} />
        <Route path="roadmap" element={<GenericPage title="Roadmap" module="roadmap" />} />
      </Route>
      <Route path="*" element={<Navigate to="/command" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </AuthProvider>
    </BrowserRouter>
  );
}
