import React, { useState } from "react";
import Topbar from "../components/Topbar";

export default function Coupons() {
  const [tab, setTab] = useState(0);
  const tabs = ["Recebido", "usado", "Expirado"];
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Meu cupom" backTo="/my" />
      <div className="coupon-tabs">
        {tabs.map((t,i) => <button key={i} className={`coupon-tab${tab===i?' active':''}`} onClick={()=>setTab(i)}>{t}</button>)}
      </div>
      <div className="empty-state"><i className="ph ph-ticket"></i><p>Ainda não há dados</p></div>
    </main>
  );
}
