import React from "react";
import Topbar from "../components/Topbar";
import { aboutInfo } from "../data/mock";

export default function About() {
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Sobre a Taxinexo" backTo="/my" />
      <div className="about-section">
        <div style={{background:'#fff',borderRadius:16,padding:16,border:'var(--hairline)'}}>
          <h2>Sobre a Taxinexo</h2>
          <p style={{fontSize:12,lineHeight:1.7}}>A Taxinexo é uma empresa ligada a carros autônomos, fundada por {aboutInfo.founder}, com sede em {aboutInfo.hq}.</p>
          <h2 style={{marginTop:16}}>Estrutura de Gestão</h2>
          <div className="about-team">
            {aboutInfo.team.map((t,i) => <div key={i} className="about-team-row"><span style={{fontWeight:600}}>{t.role}</span><span>{t.name}</span></div>)}
          </div>
          <h2 style={{marginTop:16}}>Informações Legais</h2>
          <p style={{fontSize:11,lineHeight:1.8}}>CNPJ: {aboutInfo.cnpj}</p>
          <p style={{fontSize:11}}>Endereço filial EUA: {aboutInfo.address}</p>
          <h2 style={{marginTop:16}}>Contato</h2>
          {aboutInfo.emails.map((e,i) => <p key={i} style={{fontSize:11}}>{e}</p>)}
          <h2 style={{marginTop:16}}>Canais Sociais</h2>
          <div style={{display:'flex',gap:14,fontSize:24,marginTop:8}}>
            <i className="ph ph-telegram-logo"></i>
            <i className="ph ph-facebook-logo"></i>
            <i className="ph ph-x-logo"></i>
            <i className="ph ph-linkedin-logo"></i>
            <i className="ph ph-youtube-logo"></i>
          </div>
          <h2 style={{marginTop:16}}>Verificação</h2>
          <a href="https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpjreva_solicitacao.asp" target="_blank" rel="noreferrer" style={{fontSize:11,color:'var(--accent)',display:'block',marginTop:4}}>Receita Federal</a>
          <a href="https://apps.dos.ny.gov/publicInquiry/" target="_blank" rel="noreferrer" style={{fontSize:11,color:'var(--accent)',display:'block',marginTop:4}}>NY Public Inquiry</a>
        </div>
      </div>
    </main>
  );
}
