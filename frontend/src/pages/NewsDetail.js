import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar";
import { news, aboutInfo } from "../data/mock";

export default function NewsDetail() {
  const { id } = useParams();
  const n = news.find(x => x.id === id) || news[0];
  const isAbout = n.type === "institutional";
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Conteúdo Informativo" backTo="/news" />
      <div style={{padding:16}}>
        <h1 style={{fontSize:18,margin:'0 0 12px'}}>{n.title}</h1>
        <p style={{fontSize:10,color:'var(--muted)',marginBottom:16}}>{n.date}</p>
        {isAbout ? (
          <div style={{background:'#fff',borderRadius:16,padding:16,border:'var(--hairline)'}}>
            <p style={{fontSize:12,lineHeight:1.7}}>A Taxinexo é uma empresa ligada a carros autônomos, fundada por {aboutInfo.founder}, com sede em {aboutInfo.hq}.</p>
            <h3 style={{fontSize:14,margin:'16px 0 8px'}}>Estrutura de Gestão</h3>
            <div className="about-team">
              {aboutInfo.team.map((t,i) => <div key={i} className="about-team-row"><span style={{fontWeight:600}}>{t.role}</span><span>{t.name}</span></div>)}
            </div>
            <h3 style={{fontSize:14,margin:'16px 0 8px'}}>Informações Legais</h3>
            <p style={{fontSize:11}}>CNPJ: {aboutInfo.cnpj}</p>
            <p style={{fontSize:11}}>Endereço: {aboutInfo.address}</p>
            <h3 style={{fontSize:14,margin:'16px 0 8px'}}>Contato</h3>
            {aboutInfo.emails.map((e,i) => <p key={i} style={{fontSize:11}}>{e}</p>)}
            <h3 style={{fontSize:14,margin:'16px 0 8px'}}>Canais Sociais</h3>
            <div style={{display:'flex',gap:12,fontSize:20}}>
              <i className="ph ph-telegram-logo"></i>
              <i className="ph ph-facebook-logo"></i>
              <i className="ph ph-x-logo"></i>
              <i className="ph ph-linkedin-logo"></i>
              <i className="ph ph-youtube-logo"></i>
            </div>
          </div>
        ) : (
          <div style={{background:'#fff',borderRadius:16,padding:16,border:'var(--hairline)',fontSize:12,lineHeight:1.7}}>
            <p>A TaxiNexo continua sua expansão com o objetivo de transformar o transporte urbano através de veículos autônomos. Com operações já ativas em múltiplas cidades dos Estados Unidos, a empresa planeja ampliar sua presença no mercado brasileiro.</p>
            <p>Investimentos contínuos em tecnologia de ponta e parcerias estratégicas garantem a qualidade e segurança das operações.</p>
          </div>
        )}
      </div>
    </main>
  );
}
