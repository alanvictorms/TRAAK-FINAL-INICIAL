import React from "react";
import { useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar";
import { fragments } from "../data/mock";

export default function Fragments() {
  const navigate = useNavigate();
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Coleção de fragmentos" backTo="/my" right={
        <button className="icon-btn" onClick={()=>navigate('/fragment-claims')}><i className="ph ph-list-checks"></i></button>
      } />
      <div className="chip-row" style={{padding:'0 16px 12px'}}>
        <button className="chip active">coleções de Minhas</button>
        <button className="chip" onClick={()=>navigate('/fragment-claims')}>Meus resgates</button>
      </div>
      <div style={{padding:'0 16px'}}>
        {fragments.map(f => (
          <div key={f.id} className="fragment-card" onClick={()=>navigate(`/fragments/${f.id}`)} style={{cursor:'pointer'}}>
            <div className="f-name">{f.name}</div>
            <div className="f-progress-bar"><div className="f-progress-fill" style={{width:`${f.progress}%`}}></div></div>
            <div className="f-meta">
              <span>{f.progress}%</span>
              <span>Disponível para resgate: {f.redeemable}</span>
            </div>
            {f.items.map((it,i) => (
              <div key={i} style={{fontSize:10,padding:'6px 0',borderTop:'var(--hairline)',marginTop:6,display:'flex',justifyContent:'space-between'}}>
                <span>{it.name}</span>
                <span>{it.has}/{it.need}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
