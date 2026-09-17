import React from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
const quickActions = [
  { icon: "ph-arrow-circle-up", label: "Recarregar" },
  { icon: "ph-arrow-circle-down", label: "Sacar dinheiro" },
  { icon: "ph-arrows-left-right", label: "Transferir" },
  { icon: "ph-swap", label: "Intercâmbio" },
];
const menuItems = [
  { icon: "ph-user-plus", label: "Convidar", path: "/invite" },
  { icon: "ph-credit-card", label: "PIX", path: "/cards" },
  { icon: "ph-users-three", label: "Equipe", path: "/team" },
  { icon: "ph-calendar-check", label: "Salário semanal", path: "/contract" },
  { icon: "ph-chart-line-up", label: "Rendimento do veículo", path: "/vehicle-income" },
  { icon: "ph-ticket", label: "Cupom", path: "/coupons" },
  { icon: "ph-gift", label: "Recompensas por convite", path: "/invite-rewards" },
  { icon: "ph-flag-banner", label: "Central de tarefas", path: "/tasks" },
  { icon: "ph-puzzle-piece", label: "Coleção de fragmentos", path: "/fragments" },
  { icon: "ph-receipt", label: "Registros de pedidos", path: "/orders" },
  { icon: "ph-shield-check", label: "Política", path: "/about" },
  { icon: "ph-info", label: "Sobre nós", path: "/about" },
  { icon: "ph-headset", label: "Atendimento ao Cliente", path: "#" },
  { icon: "ph-gear", label: "Configurações", path: "/settings" },
  { icon: "ph-shield-star", label: "Admin", path: "/admin" },
];

export default function MyProfile() {
  const navigate = useNavigate();
  const stored = localStorage.getItem("taxinexo_user");
  const u = stored ? JSON.parse(stored) : { phone: "Visitante", level: "LV1", invite_code: "------", type: "comum", balance: 0, earnings_balance: 0, today_earnings: 0, total_earnings: 0 };
  return (
    <main className="app-page scroll page-with-nav" style={{background:'var(--canvas)'}}>
      <div className="profile-header">
        <div className="profile-user">
          <div className="profile-avatar"><i className="ph ph-user"></i></div>
          <div className="profile-info">
            <div className="p-phone">{u.phone}</div>
            <div className="p-meta">
              <span>{u.level || "LV1"}</span>
              <span>Código: {u.invite_code || "---"}</span>
              <span>{u.type || "comum"}</span>
            </div>
          </div>
        </div>
        <div style={{fontSize:10,color:'#c7c9d0',cursor:'pointer'}}>Direitos de membro &gt;</div>
      </div>

      <div className="balance-section">
        <div className="balance-row">
          <div className="balance-card"><div className="b-label">Saldo de Recarga</div><div className="b-value">{u.balance || 0}</div></div>
          <div className="balance-card"><div className="b-label">Valor da Sorte</div><div className="b-value">0</div></div>
        </div>
      </div>

      <div className="balance-actions">
        {quickActions.map((a, i) => (
          <button key={i} className="balance-action"><i className={`ph ${a.icon}`}></i><span>{a.label}</span></button>
        ))}
      </div>

      <div className="earnings-card" style={{marginTop:12}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Renda da conta</div>
        <div className="earnings-row"><span className="e-label">Saldo Ganhos</span><span className="e-value">{u.earnings_balance || 0}</span></div>
        <div className="earnings-row"><span className="e-label">Ganhos de hoje</span><span className="e-value">{u.today_earnings || 0}</span></div>
        <div className="earnings-row"><span className="e-label">Ganhos totais</span><span className="e-value">{u.total_earnings || 0}</span></div>
        <div className="earnings-row"><span className="e-label">Dica</span><span className="e-value">0</span></div>
        <div className="earnings-row"><span className="e-label">Valor da renda</span><span className="e-value">0</span></div>
        <div className="earnings-row"><span className="e-label">A transferir</span><span className="e-value">0</span></div>
      </div>

      <div className="menu-grid">
        {menuItems.map((m, i) => (
          <button key={i} className="menu-item" onClick={() => m.path !== '#' && navigate(m.path)}>
            <i className={`ph ${m.icon}`}></i>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <BottomNav />
    </main>
  );
}
