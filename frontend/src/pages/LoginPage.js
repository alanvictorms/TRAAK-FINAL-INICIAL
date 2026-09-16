import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatApiError } from '@/lib/api';
import { LockKeyhole, Mail, ArrowRight, ShieldCheck, Sparkles, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // login | register | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_BACKEND_URL;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        navigate('/command');
      } else if (mode === 'register') {
        await register(email, password, name);
        navigate('/command');
      } else {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        setMessage(data.detail);
      }
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell" data-testid="auth-shell">
      <aside className="auth-story">
        <div className="auth-story-brand">
          <span>TRAKAQUIRE<span className="dot">.</span></span>
        </div>
        <div className="auth-story-copy">
          <div className="auth-eyebrow"><span /> AQUISIÇÃO · ATRIBUIÇÃO · OPERAÇÃO</div>
          <h1>Conecte cada clique ao seu <span className="accent">resultado.</span></h1>
          <p>Tracking, identidade, atendimento e prova financeira em uma única plataforma de iGaming.</p>
        </div>
        <div style={{ marginTop: 'auto', fontSize: '9px', color: 'hsl(155 15% 40%)' }}>
          © 2026 TrakAquire
        </div>
      </aside>

      <section className="auth-main">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {[['login', 'Entrar'], ['register', 'Criar conta'], ['forgot', 'Recuperar']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setMode(key); setError(''); setMessage(''); }}
              style={{
                padding: '8px 14px', borderRadius: '6px', fontSize: '11px', border: 'none', cursor: 'pointer',
                background: mode === key ? 'hsl(148 25% 22%)' : 'transparent',
                color: mode === key ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
              }}
              data-testid={`auth-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="auth-form-wrap">
          <div className="auth-form-symbol">
            {mode === 'login' ? <LockKeyhole size={23} /> : mode === 'register' ? <Sparkles size={24} /> : <KeyRound size={24} />}
          </div>
          <h2>{mode === 'login' ? 'Bem-vindo de volta.' : mode === 'register' ? 'Crie sua conta.' : 'Recupere seu acesso.'}</h2>
          <p className="auth-form-intro">
            {mode === 'login' ? 'Entre e continue de onde parou.' : mode === 'register' ? 'Configure seu workspace e comece a operar.' : 'Informe seu e-mail para redefinir a senha.'}
          </p>

          <form onSubmit={handleSubmit} className="auth-form" data-testid="auth-form">
            {mode === 'register' && (
              <div className="auth-field">
                <Label htmlFor="name">Nome completo</Label>
                <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" required data-testid="auth-name-input" />
              </div>
            )}

            <div className="auth-field">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" required data-testid="auth-email-input" />
            </div>

            {mode !== 'forgot' && (
              <div className="auth-field">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'login' ? 'Sua senha' : 'Mínimo 8 caracteres'} required minLength={8} data-testid="auth-password-input" />
              </div>
            )}

            {error && <p className="auth-error" data-testid="auth-error">{error}</p>}
            {message && <p style={{ fontSize: '11px', color: 'hsl(89 66% 72%)' }} data-testid="auth-message">{message}</p>}

            <Button type="submit" className="auth-submit" disabled={loading} data-testid="auth-submit-btn">
              {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar recuperação'}
              <ArrowRight size={16} />
            </Button>

            <div className="auth-form-switch">
              {mode === 'login' ? (
                <>Não tem conta? <button type="button" onClick={() => setMode('register')} data-testid="switch-to-register">Criar agora</button></>
              ) : mode === 'register' ? (
                <>Já tem conta? <button type="button" onClick={() => setMode('login')} data-testid="switch-to-login">Entrar</button></>
              ) : (
                <button type="button" onClick={() => setMode('login')}>Voltar ao login</button>
              )}
            </div>
          </form>

          <div className="auth-security-note">
            <ShieldCheck size={14} />
            <span>Seus dados estão protegidos.</span>
          </div>
        </div>

        <div className="auth-footer">
          <span>© 2026 TrakAquire</span>
          <span>Plataforma de aquisição iGaming</span>
        </div>
      </section>
    </div>
  );
}
