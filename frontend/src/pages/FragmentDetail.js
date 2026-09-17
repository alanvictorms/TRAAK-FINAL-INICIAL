import React from "react";
import { useParams } from "react-router-dom";
import Topbar from "../components/Topbar";
import { fragments } from "../data/mock";

export default function FragmentDetail() {
  const { id } = useParams();
  const f = fragments.find(x => x.id === id) || fragments[0];
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Coleção de fragmentos" backTo="/fragments" />
      <div style={{padding:16}}>
        <div className="fragment-card" style={{marginBottom:0}}>
          <div className="f-name">{f.name}</div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--muted)',margin:'8px 0'}}>
            <span>Disponível para resgate: {f.redeemable}</span>
            <span>Resgates realizados: 0</span>
          </div>
          <div className="f-progress-bar"><div className="f-progress-fill" style={{width:`${f.progress}%`}}></div></div>
          <div className="f-meta"><span>{f.progress}%</span></div>
          {f.items.map((it,i) => (
            <div key={i} style={{marginTop:12,padding:12,background:'var(--subtle)',borderRadius:12}}>
              <div style={{fontSize:11,fontWeight:500,marginBottom:6}}>{it.name}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--muted)'}}>
                <span>Possui: {it.has} / Necessário: {it.need}</span>
                <span>{it.progress}%</span>
              </div>
              <div className="f-progress-bar" style={{marginTop:6,marginBottom:0}}>
                <div className="f-progress-fill" style={{width:`${it.progress}%`}}></div>
              </div>
            </div>
          ))}
          {f.progress < 100 && <p style={{textAlign:'center',fontSize:11,color:'var(--muted)',margin:'16px 0 0'}}>Você ainda não completou esta coleção</p>}
        </div>
      </div>
    </main>
  );
}
