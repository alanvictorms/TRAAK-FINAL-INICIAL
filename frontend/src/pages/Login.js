import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Login() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone || !password) { showToast("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      if (!res.ok) { const err = await res.json(); showToast(err.detail || "Erro"); setLoading(false); return; }
      const user = await res.json();
      localStorage.setItem("taxinexo_user", JSON.stringify(user));
      showToast("Login realizado!");
      setTimeout(() => navigate('/'), 500);
    } catch (e) { showToast("Erro de conexão"); setLoading(false); }
  };

  return (
    <main className="app-page login-page" aria-label="Login">
      <section className="login-brand">
        <div className="brand large">
          <span className="brand-mark logo-image"><img src="/assets/images/waynest-mark.png" alt="" style={{ filter: 'invert(1)' }} /></span>
          <span>TaxiNexo</span>
        </div>
      </section>
      <section className="login-sheet">
        <h1>Bem-vindo ao TaxiNexo<br />faça login agora</h1>
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="phone">Telefone</label>
            <div className="input-wrap"><i className="ph ph-phone"></i><input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Seu número" /></div>
          </div>
          <div className="field"><label htmlFor="password">Senha</label>
            <div className="input-wrap"><i className="ph ph-lock-key"></i><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" /><i className="ph ph-eye-slash"></i></div>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? <><i className="ph ph-circle-notch ph-spin"></i> Entrando</> : 'Login'}
          </button>
        </form>
        <div className="login-meta">Novo no TaxiNexo? <a href="#/register"><strong>Criar uma conta</strong></a></div>
      </section>
    </main>
  );
}
