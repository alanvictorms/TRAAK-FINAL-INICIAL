import React from "react";
import Topbar from "../components/Topbar";

export default function FragmentClaims() {
  return (
    <main className="app-page scroll" style={{background:'var(--canvas)'}}>
      <Topbar title="Meus resgates" backTo="/fragments" />
      <div className="empty-state"><i className="ph ph-package"></i><p>Nenhum resgate realizado</p></div>
    </main>
  );
}
