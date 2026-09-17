import React from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import { news } from "../data/mock";

export default function NewsList() {
  const navigate = useNavigate();
  return (
    <main className="app-page scroll page-with-nav" style={{background:'var(--canvas)'}}>
      <header className="topbar" style={{background:'var(--ink)',color:'#fff'}}>
        <span className="spacer"></span>
        <div className="topbar-title" style={{color:'#fff'}}>Notícias e informações</div>
        <span className="spacer"></span>
      </header>
      <div className="news-list" style={{paddingTop:12}}>
        {news.map(n => (
          <article key={n.id} className="news-card" onClick={() => navigate(`/news/${n.id}`)}>
            <h3>{n.title}</h3>
            <span className="n-date">{n.date}</span>
          </article>
        ))}
      </div>
      <div style={{textAlign:'center',padding:20,fontSize:11,color:'var(--muted)'}}>Carregando mais</div>
      <BottomNav />
    </main>
  );
}
