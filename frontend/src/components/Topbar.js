import React from "react";
import { useNavigate } from "react-router-dom";
export default function Topbar({ title, backTo, right }) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {backTo ? <button className="icon-btn" onClick={() => navigate(backTo)}><i className="ph ph-arrow-left"></i></button> : <span className="spacer"></span>}
      <div className="topbar-title">{title}</div>
      {right || <span className="spacer"></span>}
    </header>
  );
}
