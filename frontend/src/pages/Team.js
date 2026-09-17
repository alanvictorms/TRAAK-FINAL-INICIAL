import React, { useState, useEffect } from "react";
import Topbar from "../components/Topbar";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Team() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ members: [], total_earnings: 0, today_earnings: 0, total_members: 0 });

  useEffect(() => {
    const u = localStorage.getItem("taxinexo_user");
    if (u) {
      const user = JSON.parse(u);
      fetch(`${API}/users/${user.id}/team`).then(r => r.json()).then(setData).catch(() => {});
    }
  }, []);

  const filtered = tab === 0
    ? data.members.filter(m => (m.total_earnings || 0) > 0)
    : data.members.filter(m => (m.total_earnings || 0) === 0);

  return (
    <main className="app-page scroll" style={{ background: 'var(--canvas)' }}>
      <Topbar title="Minha Equipe" backTo="/my" />
      <div className="team-stats">
        <div className="team-stat"><div className="ts-value">R$ {(data.total_earnings || 0).toFixed(2)}</div><div className="ts-label">Benefícios da Equipe</div></div>
        <div className="team-stat"><div className="ts-value">{data.total_members || 0}</div><div className="ts-label">Membros da Equipe</div></div>
        <div className="team-stat"><div className="ts-value">R$ {(data.today_earnings || 0).toFixed(2)}</div><div className="ts-label">Lucro da equipe hoje</div></div>
        <div className="team-stat"><div className="ts-value">R$ 0</div><div className="ts-label">Recargas de Hoje</div></div>
      </div>
      <div className="chip-row" style={{ padding: '0 16px 12px' }}>
        <button className={`chip${tab === 0 ? ' active' : ''}`} onClick={() => setTab(0)}>Eficiente</button>
        <button className={`chip${tab === 1 ? ' active' : ''}`} onClick={() => setTab(1)}>Inválido</button>
      </div>
      <div className="page-section-title">Equipe — B ({filtered.length})</div>
      <div className="member-list">
        {filtered.length === 0 ? <div className="empty-state"><p>Nenhum membro nesta categoria</p></div> :
          filtered.map((m, i) => (
            <div key={i} className="member-card">
              <div><div className="m-info">{m.phone}</div><div className="m-date">{m.created_at?.slice(0, 16).replace('T', ' ')}</div></div>
              <div><div className="m-value">R$ {(m.total_earnings || 0).toFixed(2)}</div><div className="m-label">Ganhos</div></div>
            </div>
          ))}
      </div>
    </main>
  );
}
