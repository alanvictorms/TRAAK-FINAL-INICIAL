import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
const tabs = [
  { path: "/", icon: "ph-house", label: "Lar" },
  { path: "/resources", icon: "ph-car-profile", label: "Recursos" },
  { path: "/news", icon: "ph-newspaper", label: "Notícias", badge: "99+" },
  { path: "/my", icon: "ph-user", label: "Minha", badge: "99+" },
];
export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button key={t.path} className={`nav-item${location.pathname === t.path ? " active" : ""}`} onClick={() => navigate(t.path)}>
          {t.badge && <span className="nav-badge">{t.badge}</span>}
          <i className={`ph ${t.icon}`}></i>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
