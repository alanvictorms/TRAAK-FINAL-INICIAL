import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import Topbar from "../components/Topbar";
import { vehicles } from "../data/mock";
import { useToast } from "../context/ToastContext";

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const v = vehicles.find(x => x.id === id) || vehicles[0];

  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Detalhes do produto" backTo="/" />
      <div className="product-hero">
        <img src={v.img} alt={v.code} style={{width:'100%',height:180,objectFit:'cover',borderRadius:16,marginBottom:12,background:'#222'}} />
        <div className="ph-code">{v.code}</div>
        <div className="ph-type">Tipo: {v.type} · Status: {v.status}</div>
        <div className="ph-timer"><i className="ph ph-timer"></i> Tempo restante: {v.timeLeft}</div>
      </div>
      <div className="product-stats">
        <div className="product-stat"><div className="ps-label">Validade</div><div className="ps-value">3D</div></div>
        <div className="product-stat"><div className="ps-label">Preço inicial</div><div className="ps-value">{v.startPrice}</div></div>
        <div className="product-stat"><div className="ps-label">Taxa</div><div className="ps-value">{v.kmRate}</div></div>
        <div className="product-stat"><div className="ps-label">Preço de aluguel</div><div className="ps-value">{v.price}</div></div>
      </div>
      <div className="earnings-card">
        <div className="earnings-row"><span className="e-label">Lucro estimado</span><span className="e-value text-success">{v.profit}</span></div>
        <div className="earnings-row"><span className="e-label">Taxa de retorno total</span><span className="e-value">{v.returnRate}</span></div>
        <div className="earnings-row"><span className="e-label">Renda diária estimada</span><span className="e-value">{v.dailyIncome}</span></div>
      </div>
      <div className="product-desc">
        <h3>Licença de Receita</h3>
        <p>Ao adquirir esta Licença de Receita, você obtém o direito de receber uma parcela das receitas geradas por este veículo autônomo durante o período de {v.cycle}.</p>
        <p>O valor da licença é de {v.price}. Os retornos esperados variam conforme a demanda de corridas na região.</p>
        <h3>Distribuição de Tarifas</h3>
        <p>As tarifas coletadas são distribuídas entre os beneficiários da licença. A Taxinexo retém 30% para despesas operacionais, incluindo carregamento, motoristas de segurança remota, manutenção e limpeza.</p>
        <h3>Riscos</h3>
        <p>Existem riscos relacionados a veículos, software e eventos de força maior. Caso veículos fiquem impossibilitados de operar, o período pode ser estendido. O comprador não possui participação acionária, propriedade dos ativos ou controle operacional.</p>
      </div>
      <div style={{padding:'0 16px 24px'}}>
        <button className="btn btn-primary btn-block" onClick={() => showToast('Aluguel solicitado com sucesso!')}>
          Alugar · {v.price}
        </button>
      </div>
    </main>
  );
}
