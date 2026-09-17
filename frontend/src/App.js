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
import DomainsPage from '@/pages/DomainsPage';
import SegmentsPage from '@/pages/SegmentsPage';
import DisparosPage from '@/pages/DisparosPage';
import CampaignsPage from '@/pages/CampaignsPage';
import AutomationsPage from '@/pages/AutomationsPage';
import ReportsPage from '@/pages/ReportsPage';
import GovernancePage from '@/pages/GovernancePage';
import MonitoringPage from '@/pages/MonitoringPage';
import IdentityPage from '@/pages/IdentityPage';
import SourcesPage from '@/pages/SourcesPage';
import RoadmapPage from '@/pages/RoadmapPage';
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
        <Route path="domains" element={<DomainsPage />} />
        <Route path="domains/:id" element={<DomainsPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="tracking/sources" element={<SourcesPage />} />
        <Route path="tracking/:id" element={<TrackingPage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="ledger/:id" element={<LedgerPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:id" element={<PlayersPage />} />
        <Route path="identity" element={<IdentityPage />} />
        <Route path="identity/:id" element={<IdentityPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:id" element={<InboxPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/:id" element={<AutomationsPage />} />
        <Route path="segments" element={<SegmentsPage />} />
        <Route path="disparos" element={<DisparosPage />} />
        <Route path="media" element={<CampaignsPage />} />
        <Route path="media/:id" element={<CampaignsPage />} />
        <Route path="revenue" element={<RevenuePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="approvals" element={<GovernancePage />} />
        <Route path="settings/general" element={<SettingsPage />} />
        <Route path="settings/team" element={<SettingsPage />} />
        <Route path="settings/api" element={<SettingsPage />} />
        <Route path="settings/billing" element={<SettingsPage />} />
        <Route path="settings/notifications" element={<SettingsPage />} />
        <Route path="settings/audit" element={<SettingsPage />} />
        <Route path="platform" element={<PlatformPage />} />
        <Route path="platform/tenants" element={<PlatformPage />} />
        <Route path="platform/plans" element={<PlatformPage />} />
        <Route path="platform/ai" element={<PlatformPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
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
