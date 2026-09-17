import React, { useState, useEffect } from "react";
import Topbar from "../components/Topbar";
import { useToast } from "../context/ToastContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Invite() {
  const { showToast } = useToast();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const u = localStorage.getItem("taxinexo_user");
    if (u) setUser(JSON.parse(u));
  }, []);

  if (!user) return (
    <main className="app-page scroll" style={{ background: 'var(--canvas)' }}>
      <Topbar title="Convidar" backTo="/my" />
      <div className="empty-state"><p>Faça login para ver seu código de convite</p></div>
    </main>
  );

  const link = `${window.location.origin}/#/register?inviteCode=${user.invite_code}`;

  return (
    <main className="app-page scroll" style={{ background: 'var(--canvas)' }}>
      <Topbar title="Convidar" backTo="/my" />
      <div className="invite-card">
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Conta: {user.phone}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Código de convite:</div>
        <div className="invite-code">{user.invite_code}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Link de convite:</div>
        <div className="invite-link">{link}</div>
        <div className="invite-actions">
          <button className="btn btn-primary" style={{ minHeight: 42 }} onClick={() => { navigator.clipboard?.writeText(user.invite_code); showToast('Código copiado!'); }}>Copiar código</button>
          <button className="btn btn-soft" style={{ minHeight: 42 }} onClick={() => { navigator.clipboard?.writeText(link); showToast('Link copiado!'); }}>Copiar link</button>
        </div>
      </div>
    </main>
  );
}
