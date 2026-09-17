import React from "react";
import { useToast } from "../context/ToastContext";
export default function Toast() {
  const { message, visible } = useToast();
  return <div className={`toast${visible ? " show" : ""}`}><i className="ph ph-check-circle"></i><span>{message}</span></div>;
}
