import React from "react";
import Topbar from "../components/Topbar";
import { pixAccounts } from "../data/mock";
import { useToast } from "../context/ToastContext";

export default function Cards() {
  const { showToast } = useToast();
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Gerenciamento de cartão bancário" backTo="/my" />
      <div style={{padding:'12px 0'}}>
        {pixAccounts.map((p,i) => (
          <div key={i} className="pix-card">
            <div className="pix-info">
              <div className="pix-type">PIX Conta ({p.type})</div>
              <div className="pix-name">{p.name}</div>
              <div className="pix-key">{p.key}</div>
            </div>
            <button className="btn btn-sm" style={{color:'var(--danger)',minHeight:34}} onClick={()=>showToast('PIX excluído')}>Excluir</button>
          </div>
        ))}
      </div>
      <div style={{padding:'0 16px'}}>
        <button className="btn btn-primary btn-block" style={{minHeight:44}} onClick={()=>showToast('Adicionar chave PIX')}>Chave PIX</button>
      </div>
    </main>
  );
}
