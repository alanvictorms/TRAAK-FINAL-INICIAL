import { useState } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  LayoutDashboard, BarChart3, Link2, Globe, Radar, Activity, Users, Fingerprint,
  MessageSquare, Workflow, Target, Send, Megaphone, DollarSign, FileText, Shield, CheckSquare,
  Settings, UsersRound, Key, Receipt, Bell, ClipboardList, Building2, CreditCard, Bot, Search,
  Menu, LogOut, ChevronRight, User, Sparkles
} from 'lucide-react';

const navGroups = [
  {
    label: 'OVERVIEW', items: [
      { to: '/command', icon: LayoutDashboard, label: 'Comando' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    ]
  },
  {
    label: 'CONNECT', items: [
      { to: '/integrations', icon: Radar, label: 'Integrações' },
      { to: '/domains', icon: Globe, label: 'Domínios' },
      { to: '/tracking', icon: Link2, label: 'Links' },
      { to: '/tracking/sources', icon: Radar, label: 'Fontes' },
    ]
  },
  {
    label: 'OBSERVE', items: [
      { to: '/ledger', icon: Activity, label: 'Signal Ledger' },
      { to: '/monitoring', icon: Radar, label: 'Monitoramento' },
      { to: '/players', icon: Users, label: 'Players' },
      { to: '/identity', icon: Fingerprint, label: 'Identity Graph' },
    ]
  },
  {
    label: 'OPERATE', items: [
      { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
      { to: '/automations', icon: Workflow, label: 'Automações' },
      { to: '/segments', icon: Target, label: 'Segmentos' },
      { to: '/disparos', icon: Send, label: 'Disparos' },
      { to: '/media', icon: Megaphone, label: 'Campanhas' },
    ]
  },
  {
    label: 'PROVE', items: [
      { to: '/revenue', icon: DollarSign, label: 'Receita' },
      { to: '/reports', icon: FileText, label: 'Relatórios' },
      { to: '/governance', icon: Shield, label: 'Governança' },
      { to: '/approvals', icon: CheckSquare, label: 'Aprovações' },
    ]
  },
];

const settingsItems = [
  { to: '/settings/general', icon: Settings, label: 'Operação' },
  { to: '/settings/team', icon: UsersRound, label: 'Equipe' },
  { to: '/settings/api', icon: Key, label: 'API' },
  { to: '/settings/billing', icon: Receipt, label: 'Faturamento' },
  { to: '/settings/notifications', icon: Bell, label: 'Notificações' },
  { to: '/settings/audit', icon: ClipboardList, label: 'Auditoria' },
];

const platformItems = [
  { to: '/platform', icon: Building2, label: 'Visão geral' },
  { to: '/platform/tenants', icon: Building2, label: 'Tenants' },
  { to: '/platform/plans', icon: CreditCard, label: 'Planos' },
  { to: '/platform/ai', icon: Bot, label: 'Provedores IA' },
];

function SidebarNav({ onNavigate }) {
  const { user } = useAuth();
  const location = useLocation();

  const allTargets = [...navGroups.flatMap(g => g.items), ...settingsItems, ...platformItems].map(i => i.to);
  // Ativo = o item de rota mais específica que casa com a URL.
  const best = allTargets
    .filter(to => location.pathname === to || location.pathname.startsWith(to + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (to) => to === best;

  return (
    <>
      <div className="sidebar-brand" data-testid="sidebar-brand">
        <span>TRAKAQUIRE<span className="dot">.</span></span>
      </div>
      <div className="sidebar-edition">WORKSPACE</div>

      {navGroups.map(group => (
        <div key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          <div className="nav-group">
            {group.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={`nav-link ${isActive(item.to) ? 'active' : ''}`}
                onClick={onNavigate}
                data-testid={`nav-${item.to.replace(/\//g, '-').slice(1)}`}
              >
                <item.icon size={14} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}

      <div className="nav-group-label">CONFIGURAÇÕES</div>
      <div className="nav-group">
        {settingsItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`nav-link ${isActive(item.to) ? 'active' : ''}`}
            onClick={onNavigate}
            data-testid={`nav-${item.to.replace(/\//g, '-').slice(1)}`}
          >
            <item.icon size={14} />
            {item.label}
          </NavLink>
        ))}
      </div>

      {user?.is_platform_admin && (
        <>
          <div className="nav-group-label">PLATAFORMA</div>
          <div className="nav-group">
            {platformItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={`nav-link ${isActive(item.to) ? 'active' : ''}`}
                onClick={onNavigate}
                data-testid={`nav-${item.to.replace(/\//g, '-').slice(1)}`}
              >
                <item.icon size={14} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = (user?.name || user?.email || 'U').slice(0, 2).toUpperCase();

  // Get current page title
  const allItems = [...navGroups.flatMap(g => g.items), ...settingsItems, ...platformItems];
  const current = allItems
    .filter(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <SidebarNav onNavigate={() => {}} />
        <div className="sidebar-bottom">
          <div className="sidebar-user" data-testid="sidebar-user">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-[10px] bg-[hsl(130_25%_22%)] text-[hsl(90_60%_85%)]">{initials}</AvatarFallback>
            </Avatar>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || 'Usuário'}</div>
              <div className="sidebar-user-email">{user?.email}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mobile-menu-btn" data-testid="mobile-menu-btn">
                <Menu size={20} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0 bg-[hsl(174_80%_3.5%)]">
              <SheetHeader className="sr-only"><SheetTitle>Navegação</SheetTitle></SheetHeader>
              <div className="p-4">
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="topbar-breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={12} />
            <span className="current">{current?.label || 'TrakAquire'}</span>
          </div>

          <div className="topbar-actions">
            <div className="topbar-search">
              <Search size={14} />
              <input placeholder="Buscar..." data-testid="global-search" />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" data-testid="notifications-btn">
                  <Bell size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <p className="text-sm font-medium mb-2">Notificações</p>
                <p className="text-xs text-muted-foreground">Sem notificações pendentes.</p>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="copilot-btn">
                  <Sparkles size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <p className="text-sm font-medium mb-2">Copiloto TrakAquire</p>
                <p className="text-xs text-muted-foreground mb-3">Pergunte sobre métricas, campanhas ou integrações.</p>
                <input
                  className="w-full h-8 text-xs rounded-md border border-border bg-muted px-3"
                  placeholder="Qual o CPFTD desta semana?"
                  data-testid="copilot-input"
                />
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="user-menu-btn">
                  <User size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-xs font-medium">{user?.name}</DropdownMenuItem>
                <DropdownMenuItem className="text-xs text-muted-foreground">{user?.email}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><NavLink to="/settings/general" className="text-xs">Configurações</NavLink></DropdownMenuItem>
                <DropdownMenuItem asChild><NavLink to="/roadmap" className="text-xs">Roadmap</NavLink></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-xs text-destructive" data-testid="logout-btn">
                  <LogOut size={14} className="mr-2" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
