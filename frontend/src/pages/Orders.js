import React, { useState } from "react";
import Topbar from "../components/Topbar";
import { orders } from "../data/mock";

const tabs = ["veículo", "Ponto de carregamento"];

export default function Orders() {
  const [tab, setTab] = useState(0);
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Meu pedido" backTo="/my" />
      <div className="chip-row" style={{padding:'0 16px 6px'}}>
        {tabs.map((t,i) => <button key={i} className={`chip${tab===i?' active':''}`} onClick={()=>setTab(i)}>{t}</button>)}
      </div>
      <label style={{display:'flex',alignItems:'center',gap:6,padding:'6px 16px',fontSize:10,color:'var(--muted)'}}>
        <input type="checkbox" style={{accentColor:'var(--ink)'}} /> Ver apenas pedidos de Valor da Sorte
      </label>
      <div style={{padding:'8px 16px'}}>
        {orders.map(o => (
          <div key={o.id} className="order-card">
            <div className="o-header"><span className="o-id">#{o.id}</span><span className="o-status">{o.status}</span></div>
            <div className="o-body">
              <div><span className="o-label">Produto</span></div><div style={{textAlign:'right',fontWeight:600}}>{o.product}</div>
              <div><span className="o-label">Valor</span></div><div style={{textAlign:'right'}}>{o.value}</div>
              <div><span className="o-label">Horário</span></div><div style={{textAlign:'right'}}>{o.date}</div>
              <div><span className="o-label">Quantidade</span></div><div style={{textAlign:'right'}}>{o.qty}</div>
              <div><span className="o-label">Valor pago</span></div><div style={{textAlign:'right',fontWeight:600}}>{o.paid}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
