import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "../context/ToastContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Admin() {
  const { showToast } = useToast();
  const [tab, setTab] = useState("levels");
  const [levels, setLevels] = useState([]);
  const [users, setUsers] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [stats, setStats] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [network, setNetwork] = useState([]);

  const load = useCallback(async () => {
    try {
      const [lRes, uRes, cRes, sRes] = await Promise.all([
        fetch(`${API}/admin/commission-levels`).then(r => r.json()),
        fetch(`${API}/admin/users`).then(r => r.json()),
        fetch(`${API}/admin/commissions`).then(r => r.json()),
        fetch(`${API}/admin/stats`).then(r => r.json()),
      ]);
      setLevels(lRes); setUsers(uRes); setCommissions(cRes); setStats(sRes);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveLevels = async () => {
    try {
      await fetch(`${API}/admin/commission-levels`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      showToast("Níveis salvos!");
      load();
    } catch (e) { showToast("Erro ao salvar"); }
  };

  const addLevel = () => {
    setLevels([...levels, { level: levels.length + 1, name: `Nível ${levels.length + 1}`, percentage: 1 }]);
  };

  const removeLevel = (i) => {
    const next = levels.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, level: idx + 1 }));
    setLevels(next);
  };

  const updateLevel = (i, field, val) => {
    const next = [...levels];
    next[i] = { ...next[i], [field]: field === "percentage" ? parseFloat(val) || 0 : val };
    setLevels(next);
  };

  const viewNetwork = async (userId) => {
    setSelectedUser(userId);
    try {
      const res = await fetch(`${API}/admin/user/${userId}/network`);
      setNetwork(await res.json());
    } catch (e) { setNetwork([]); }
  };

  const renderTree = (nodes, depth = 0) => {
    if (!nodes || nodes.length === 0) return <div style={{ paddingLeft: depth * 16, fontSize: 10, color: 'var(--muted)', padding: '4px 0 4px ' + (depth * 16) + 'px' }}>Sem sub-rede</div>;
    return nodes.map((n, i) => (
      <div key={i}>
        <div style={{ paddingLeft: depth * 20, padding: '6px 0 6px ' + (depth * 20) + 'px', fontSize: 11, borderBottom: 'var(--hairline)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, flexShrink: 0 }}>N{n.level}</span>
          <span style={{ fontWeight: 500 }}>{n.user.phone}</span>
          <span style={{ color: 'var(--muted)', fontSize: 9 }}>Código: {n.user.invite_code}</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--success)' }}>R$ {(n.user.total_earnings || 0).toFixed(2)}</span>
        </div>
        {n.children && n.children.length > 0 && renderTree(n.children, depth + 1)}
      </div>
    ));
  };

  const tabs = [
    { id: "levels", label: "Níveis de Comissão" },
    { id: "users", label: "Usuários" },
    { id: "commissions", label: "Comissões" },
    { id: "network", label: "Rede Multinível" },
  ];

  return (
    <main className="app-page scroll" style={{ background: 'var(--canvas)', minHeight: '100vh' }}>
      <header style={{ background: 'var(--ink)', padding: '16px', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Admin TaxiNexo</div>
            <div style={{ fontSize: 10, color: '#c7c9d0' }}>Sistema Multinível</div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700 }}>{stats.total_users || 0}</div>Usuários</div>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700 }}>R$ {(stats.total_paid || 0).toFixed(2)}</div>Comissões pagas</div>
          </div>
        </div>
      </header>

      <div className="chip-row" style={{ padding: '12px 16px' }}>
        {tabs.map(t => (
          <button key={t.id} className={`chip${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ===== NÍVEIS ===== */}
      {tab === "levels" && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: 'var(--hairline)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>Configurar Profundidade e Comissão</h2>
              <button className="btn btn-sm" onClick={addLevel} style={{ minHeight: 32, gap: 4 }}><i className="ph ph-plus"></i> Nível</button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--muted)', margin: '0 0 14px' }}>
              Defina quantos níveis de profundidade e a % de comissão para cada nível. Nível 1 = referência direta.
            </p>
            {levels.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{l.level}</span>
                <input value={l.name} onChange={e => updateLevel(i, 'name', e.target.value)}
                  style={{ flex: 1, height: 38, border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px', fontSize: 11 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={l.percentage} onChange={e => updateLevel(i, 'percentage', e.target.value)}
                    style={{ width: 60, height: 38, border: '1px solid var(--line)', borderRadius: 10, padding: '0 8px', fontSize: 12, fontWeight: 700, textAlign: 'center' }} min="0" max="100" step="0.5" />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>%</span>
                </div>
                <button onClick={() => removeLevel(i)} style={{ width: 28, height: 28, borderRadius: 8, background: '#fdeaea', color: 'var(--danger)', border: 0, cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center' }}>
                  <i className="ph ph-trash"></i>
                </button>
              </div>
            ))}
            <button className="btn btn-primary btn-block" style={{ marginTop: 14, minHeight: 44 }} onClick={saveLevels}>Salvar Níveis</button>
          </div>
        </div>
      )}

      {/* ===== USUÁRIOS ===== */}
      {tab === "users" && (
        <div style={{ padding: '0 16px' }}>
          {users.length === 0 ? <div className="empty-state"><p>Nenhum usuário cadastrado</p></div> :
            users.map(u => (
              <div key={u.id} style={{ background: '#fff', borderRadius: 14, padding: 12, border: 'var(--hairline)', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{u.phone}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>Código: {u.invite_code} · {u.level} · {u.type}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>R$ {(u.total_earnings || 0).toFixed(2)}</div>
                    <div style={{ fontSize: 8, color: 'var(--muted)' }}>Ganhos totais</div>
                  </div>
                </div>
                {u.referred_by && <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 4 }}>Indicado por: {u.referred_by.slice(0, 8)}...</div>}
                <button className="btn btn-sm" style={{ marginTop: 6, minHeight: 28, fontSize: 9 }} onClick={() => { setTab("network"); viewNetwork(u.id); }}>
                  <i className="ph ph-tree-structure"></i> Ver rede
                </button>
              </div>
            ))}
        </div>
      )}

      {/* ===== COMISSÕES ===== */}
      {tab === "commissions" && (
        <div style={{ padding: '0 16px' }}>
          {commissions.length === 0 ? <div className="empty-state"><p>Nenhuma comissão registrada</p></div> :
            commissions.map((c, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 12, padding: 10, border: 'var(--hairline)', marginBottom: 6, fontSize: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>+R$ {c.amount.toFixed(2)}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 6, background: 'var(--subtle)', fontSize: 8 }}>{c.level_name}</span>
                </div>
                <div style={{ color: 'var(--muted)', marginTop: 2, fontSize: 9 }}>
                  Nível {c.level} · {c.percentage}% · {c.created_at?.slice(0, 16).replace('T', ' ')}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* ===== REDE ===== */}
      {tab === "network" && (
        <div style={{ padding: '0 16px' }}>
          {!selectedUser ? (
            <div>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>Selecione um usuário para ver a rede:</p>
              {users.map(u => (
                <button key={u.id} className="btn btn-block" style={{ minHeight: 40, marginBottom: 6, justifyContent: 'flex-start', fontSize: 11 }} onClick={() => viewNetwork(u.id)}>
                  <i className="ph ph-user"></i> {u.phone} ({u.invite_code})
                </button>
              ))}
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 16, padding: 14, border: 'var(--hairline)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontSize: 13, margin: 0 }}>Rede de {users.find(u => u.id === selectedUser)?.phone || '...'}</h3>
                <button className="btn btn-sm" style={{ minHeight: 28, fontSize: 9 }} onClick={() => setSelectedUser(null)}>Voltar</button>
              </div>
              {network.length === 0 ? <p style={{ fontSize: 11, color: 'var(--muted)' }}>Nenhum membro na rede</p> : renderTree(network)}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: 16, textAlign: 'center' }}>
        <button className="btn" style={{ minHeight: 36, fontSize: 10 }} onClick={() => window.location.hash = '/'}>
          <i className="ph ph-arrow-left"></i> Voltar ao app
        </button>
      </div>
    </main>
  );
}
