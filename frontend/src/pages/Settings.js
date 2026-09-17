import React from "react";
import { useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar";
import { useToast } from "../context/ToastContext";

export default function Settings() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const items = [
    { label: "Avatar", action: ()=>showToast('Editar avatar'), right: <i className="ph ph-caret-right"></i> },
    { label: "Apelido", action: ()=>showToast('Editar apelido'), value: "85997967804", right: <i className="ph ph-caret-right"></i> },
    { label: "Conta", value: "85997967804" },
    { label: "Alterar senha", action: ()=>showToast('Alterar senha'), right: <i className="ph ph-caret-right"></i> },
    { label: "Política de privacidade", action: ()=>navigate('/about'), right: <i className="ph ph-caret-right"></i> },
    { label: "Limpar cache", action: ()=>showToast('Cache limpo') },
  ];
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Configuração" backTo="/my" />
      <div className="settings-list">
        {items.map((it,i) => (
          <div key={i} className="setting-item" onClick={it.action} style={{cursor:it.action?'pointer':'default'}}>
            <span>{it.label}</span>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              {it.value && <span style={{fontSize:11,color:'var(--muted)'}}>{it.value}</span>}
              {it.right}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'24px 16px'}}>
        <button className="btn btn-block" style={{minHeight:44,color:'var(--danger)',borderColor:'var(--danger)'}} onClick={()=>showToast('Sessão encerrada')}>Sair</button>
      </div>
    </main>
  );
}
