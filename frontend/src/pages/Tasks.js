import React, { useState } from "react";
import Topbar from "../components/Topbar";

export default function Tasks() {
  const [tab, setTab] = useState(0);
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Central de Tarefas" backTo="/my" />
      <div className="chip-row" style={{padding:'0 16px 12px'}}>
        <button className={`chip${tab===0?' active':''}`} onClick={()=>setTab(0)}>pessoal</button>
        <button className={`chip${tab===1?' active':''}`} onClick={()=>setTab(1)}>da equipe</button>
      </div>
      {tab === 0 ? (
        <>
          <div className="task-prize">
            <h3>Prêmio da rodada</h3>
            <div className="task-prize-items">
              <div className="task-prize-item"><div className="tp-value">+3</div><div className="tp-label">Bola da Sorte</div></div>
              <div className="task-prize-item"><div className="tp-value">+R$ 20,00</div><div className="tp-label">Saldo em dinheiro</div></div>
            </div>
          </div>
          <div className="task-card">
            <span className="t-status">Expirada</span>
            <div className="t-goal">Convide 3 amigos</div>
            <div style={{fontSize:10,color:'var(--danger)',marginBottom:8}}>Tempo esgotado</div>
            <div className="t-progress">
              <div className="t-progress-bar"><div className="t-progress-fill" style={{width:'33%'}}></div></div>
              <span>1 / 3</span>
            </div>
          </div>
          <div style={{padding:'0 16px'}}>
            <div style={{background:'#fff',borderRadius:16,padding:14,border:'var(--hairline)',fontSize:11,lineHeight:1.7}}>
              <h3 style={{fontSize:13,margin:'0 0 8px'}}>Descrição da recompensa</h3>
              <p>Convide novos usuários pelo link de convite. Alcance a meta dentro do prazo. O primeiro convite válido inicia a contagem regressiva.</p>
              <h3 style={{fontSize:13,margin:'12px 0 8px'}}>Como funciona</h3>
              <p>Cadastros duplicados, inválidos ou fraudulentos não contam. A recompensa precisa ser reivindicada manualmente. Novo convite válido inicia nova contagem.</p>
              <h3 style={{fontSize:13,margin:'12px 0 8px'}}>Recompensas recebidas</h3>
              <p style={{color:'var(--muted)'}}>Nenhuma recompensa recebida</p>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state"><i className="ph ph-flag-banner"></i><p>Nenhuma tarefa da equipe disponível</p></div>
      )}
    </main>
  );
}
