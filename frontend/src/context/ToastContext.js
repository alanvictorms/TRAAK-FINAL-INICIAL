import React, { createContext, useContext, useState, useCallback, useRef } from "react";
const ToastContext = createContext();
export function ToastProvider({ children }) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);
  const showToast = useCallback((msg) => {
    setMessage(msg); setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2200);
  }, []);
  return <ToastContext.Provider value={{ message, visible, showToast }}>{children}</ToastContext.Provider>;
}
export function useToast() { return useContext(ToastContext); }
