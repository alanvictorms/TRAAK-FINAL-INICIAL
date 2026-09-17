import React from "react";
import Topbar from "../components/Topbar";

export default function Contract() {
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Contrato semanal" backTo="/my" />
      <div style={{padding:16}}>
        <div className="contract-body">
          <h2 style={{fontSize:16,margin:'0 0 12px'}}>Contrato de Assinar</h2>
          <p>Este contrato semanal estabelece os termos e condições para a participação no programa de receita de veículos autônomos da TaxiNexo.</p>
          <p>Período: 7 dias corridos a partir da data de assinatura.</p>
          <p>O participante reconhece que os retornos estimados são baseados em projeções de demanda e podem variar conforme as condições de mercado.</p>
          <p>A TaxiNexo se reserva o direito de ajustar os termos com aviso prévio de 48 horas.</p>
          <p>Ao assinar este contrato, o participante declara estar ciente dos riscos envolvidos e concorda com todos os termos apresentados.</p>
        </div>
      </div>
    </main>
  );
}
