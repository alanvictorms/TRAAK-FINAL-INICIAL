import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../context/ToastContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Register() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(params.get('inviteCode') || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone || !password) { showToast("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password, invite_code: inviteCode || null }),
      });
      if (!res.ok) { const err = await res.json(); showToast(err.detail || "Erro"); setLoading(false); return; }
      const user = await res.json();
      localStorage.setItem("taxinexo_user", JSON.stringify(user));
      showToast("Conta criada com sucesso!");
      setTimeout(() => navigate('/'), 500);
    } catch (e) { showToast("Erro de conexão"); setLoading(false); }
  };

  return (
    <main className="app-page login-page" aria-label="Register">
      <section className="login-brand">
        <div className="brand large">
          <span className="brand-mark logo-image"><img src="/assets/images/waynest-mark.png" alt="" style={{ filter: 'invert(1)' }} /></span>
          <span>TaxiNexo</span>
        </div>
      </section>
      <section style={{ marginTop: 'auto', background: '#fff', borderRadius: '34px 34px 0 0', padding: '28px 20px 30px', boxShadow: '0 -8px 28px rgba(17,18,22,.04)' }}>
        <h1 style={{ textAlign: 'center', margin: '0 0 27px', fontSize: 20, fontWeight: 500 }}>Criar conta TaxiNexo</h1>
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="r-phone">Telefone</label>
            <div className="input-wrap"><i className="ph ph-phone"></i><input id="r-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Seu número" /></div>
          </div>
          <div className="field"><label htmlFor="r-pass">Senha</label>
            <div className="input-wrap"><i className="ph ph-lock-key"></i><input id="r-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Criar senha" /></div>
          </div>
          <div className="field"><label htmlFor="r-invite">Código de convite</label>
            <div className="input-wrap"><i className="ph ph-user-plus"></i><input id="r-invite" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Código (opcional)" /></div>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{ marginTop: 20 }}>
            {loading ? <><i className="ph ph-circle-notch ph-spin"></i> Criando</> : 'Criar conta'}
          </button>
        </form>
        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>Já tem conta? <a href="#/login"><strong>Fazer login</strong></a></div>
      </section>
    </main>
  );
}
