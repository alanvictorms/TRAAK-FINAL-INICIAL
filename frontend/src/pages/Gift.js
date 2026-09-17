import React, { useState } from "react";
import Topbar from "../components/Topbar";
import { useToast } from "../context/ToastContext";

export default function Gift() {
  const { showToast } = useToast();
  const [codes, setCodes] = useState(['','','']);
  const handleChange = (i, val) => {
    const next = [...codes]; next[i] = val.slice(0,4); setCodes(next);
  };
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Resgatar" backTo="/my" />
      <div style={{padding:'20px 16px'}}>
        <div style={{background:'#fff',borderRadius:16,padding:16,border:'var(--hairline)'}}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:4}}>Resgatar</div>
          <p style={{fontSize:10,color:'var(--muted)',marginBottom:16}}>Por favor, obtenha o código de resgate na página do evento. As regras de resgate seguem as instruções da página.</p>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {codes.map((c,i) => (
              <input key={i} className="redeem-input" value={c} onChange={e=>handleChange(i,e.target.value)} style={{flex:1,height:52,border:'1px solid var(--line)',borderRadius:12,textAlign:'center',fontSize:18,fontWeight:700,background:'#fff'}} />
            ))}
          </div>
          <button className="btn btn-primary btn-block" style={{minHeight:44}} onClick={()=>showToast('Código inválido ou expirado')}>Resgatar agora</button>
        </div>
        <button className="btn btn-block" style={{marginTop:12,minHeight:42}} onClick={()=>showToast('Histórico vazio')}>Histórico de troca</button>
      </div>
    </main>
  );
}
