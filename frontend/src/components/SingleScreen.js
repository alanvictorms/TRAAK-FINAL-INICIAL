import React, { useEffect } from "react";
export default function SingleScreen({ children }) {
  useEffect(() => { document.body.classList.add("single-screen"); return () => document.body.classList.remove("single-screen"); }, []);
  return <>{children}</>;
}
