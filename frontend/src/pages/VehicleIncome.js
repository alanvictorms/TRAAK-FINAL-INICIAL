import React from "react";
import Topbar from "../components/Topbar";
import { tripRecords } from "../data/mock";

export default function VehicleIncome() {
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Receita de Veículos" backTo="/my" />
      <div style={{padding:'0 16px'}}>
        <div className="earnings-card" style={{margin:0,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:8}}>OJ9B1QCI</div>
          <div className="earnings-row"><span className="e-label">Período</span><span className="e-value">Hoje</span></div>
          <div className="earnings-row"><span className="e-label">Pedidos</span><span className="e-value">0</span></div>
          <div className="earnings-row"><span className="e-label">Renda de comissão</span><span className="e-value">R$ 0</span></div>
        </div>
        <div className="page-section-title" style={{padding:'8px 0'}}>Histórico de corridas</div>
        {tripRecords.map(t => (
          <div key={t.id} className="trip-record">
            <div className="tr-row"><span className="tr-label">ID</span><span>{t.id.slice(-6)}</span></div>
            <div className="tr-row"><span className="tr-label">Pedido</span><span>{t.orderTime}</span></div>
            <div className="tr-row"><span className="tr-label">Término</span><span>{t.endTime}</span></div>
            <div className="tr-row"><span className="tr-label">Duração</span><span>{t.duration}</span></div>
            <div className="tr-row"><span className="tr-label">Distância</span><span>{t.distance}</span></div>
            <div className="tr-row"><span className="tr-label">Valor</span><span style={{fontWeight:600,color:'var(--success)'}}>{t.value}</span></div>
          </div>
        ))}
      </div>
    </main>
  );
}
