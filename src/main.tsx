import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { reloadForUpdate } from "./platform/update";

// After a new deploy, a page (or home-screen shortcut) opened earlier still references the previous build's
// chunks, which no longer exist. Reload once to pick up the new build instead of failing.
window.addEventListener("vite:preloadError", (e) => { if (reloadForUpdate()) e.preventDefault(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
