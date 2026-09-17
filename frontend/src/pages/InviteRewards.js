import React from "react";
import Topbar from "../components/Topbar";
import { inviteRewards } from "../data/mock";

export default function InviteRewards() {
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Recompensa(R$)" backTo="/my" />
      <div style={{padding:'0 16px'}}>
        {inviteRewards.map((r,i) => (
          <div key={i} className="reward-card">
            <div className="r-header">
              <span className="r-product">{r.product} {r.multiplier}</span>
              <span className="r-value">{r.value}</span>
            </div>
            <div className="r-meta">
              <span>{r.user}</span>
              <span>{r.date}</span>
            </div>
            <div style={{marginTop:6,fontSize:9}}><span style={{padding:'2px 8px',borderRadius:6,background:'#e8f5e9',color:'var(--success)'}}>{r.status}</span></div>
          </div>
        ))}
      </div>
    </main>
  );
}
