import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PublicPortal } from "./PublicPortal";
import "./styles.css";

const isPublicPortal = window.location.pathname.replace(/\/+$/, "") === "/estado";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPublicPortal ? <PublicPortal /> : <App />}
  </React.StrictMode>,
);
