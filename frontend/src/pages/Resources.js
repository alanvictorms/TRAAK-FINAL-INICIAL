import React, { useState } from "react";
import BottomNav from "../components/BottomNav";

export default function Resources() {
  const [tab, setTab] = useState(0);
  const tabs = ["Meus veículos", "Gerando lucro", "veículo", "Ponto de carregamento"];
  return (
    <main className="app-page scroll page-with-nav" style={{background:'var(--canvas)'}}>
      <header style={{background:'var(--ink)',padding:'16px',borderRadius:'0 0 24px 24px',color:'#fff'}}>
        <div style={{fontSize:10,color:'#c7c9d0',marginBottom:6}}>
          Ao alugar veículos em (Austin.Phoenix), você e seu superior estão aptos a receber bônus no Capital Pool.
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <i className="ph ph-map-pin" style={{color:'var(--accent)'}}></i>
          <span style={{fontSize:12,fontWeight:600}}>Austin</span>
        </div>
      </header>
      <div className="chip-row" style={{padding:'12px 16px'}}>
        {tabs.map((t, i) => (
          <button key={i} className={`chip${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>
      <div className="empty-state">
        <i className="ph ph-car-profile"></i>
        <p>Você ainda não alugou veículos</p>
        <button className="btn btn-primary" style={{marginTop:16,minHeight:42}} onClick={() => window.location.hash = '/'}>
          Comprar veículos
        </button>
      </div>
      <BottomNav />
    </main>
  );
}
