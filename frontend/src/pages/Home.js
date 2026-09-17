import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import { cities, vehicles } from "../data/mock";

const filters = ["veículo", "Ponto de carregamento", "padrão", "Preço", "Taxa de juros", "Renda", "Filtro"];

export default function Home() {
  const navigate = useNavigate();
  const [activeCity, setActiveCity] = useState(0);
  const [activeFilter, setActiveFilter] = useState(0);

  return (
    <main className="app-page scroll page-with-nav" style={{background:'var(--canvas)'}}>
      <header style={{background:'var(--ink)',padding:'16px 16px 0',borderRadius:'0 0 24px 24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div className="brand" style={{color:'#fff'}}>
            <span className="brand-mark logo-image"><img src="/assets/images/waynest-mark.png" alt="" style={{filter:'invert(1)'}} /></span>
            <span>TaxiNexo</span>
          </div>
          <button className="icon-btn" style={{background:'rgba(255,255,255,.12)',border:0,color:'#fff'}}><i className="ph ph-bell"></i></button>
        </div>
        <div className="city-tabs" style={{padding:'0 0 14px'}}>
          {cities.map((c, i) => (
            <button key={i} className={`city-tab${activeCity === i ? ' active' : ''}`} onClick={() => setActiveCity(i)} style={activeCity === i ? {} : {background:'rgba(255,255,255,.12)',color:'#fff'}}>{c}</button>
          ))}
        </div>
      </header>
      <div className="filter-row" style={{paddingTop:12}}>
        {filters.map((f, i) => (
          <button key={i} className={`filter-chip${activeFilter === i ? ' active' : ''}`} onClick={() => setActiveFilter(i)}>{f}</button>
        ))}
      </div>
      <div className="vehicle-list">
        {vehicles.map(v => (
          <article key={v.id} className="vehicle-item" onClick={() => navigate(`/product/${v.id}`)} style={{cursor:'pointer'}}>
            <img src={v.img} alt={v.code} style={{width:'100%',height:140,objectFit:'cover',borderRadius:12,background:'#f4f3f5',marginBottom:8}} />
            <div className="vehicle-item-header">
              <span className="v-code">{v.code}</span>
              <div className="v-status">
                <span>{v.status}</span>
                <span className="scheduled">{v.scheduled}</span>
              </div>
            </div>
            <div className="vehicle-item-body">
              <div><span className="v-label">Lucro estimado</span></div>
              <div style={{textAlign:'right',color:'var(--success)',fontWeight:600}}>{v.profit}</div>
              <div><span>Tipo: {v.type}</span></div>
              <div style={{textAlign:'right'}}>Ciclo: {v.cycle}</div>
            </div>
            <div className="vehicle-item-footer">
              <div>
                <div className="v-price">{v.price}</div>
                <div className="v-timer"><i className="ph ph-timer"></i> {v.timeLeft}</div>
              </div>
              <button className="btn-rent" onClick={e => { e.stopPropagation(); navigate(`/product/${v.id}`); }}>Alugar</button>
            </div>
          </article>
        ))}
      </div>
      <BottomNav />
    </main>
  );
}
