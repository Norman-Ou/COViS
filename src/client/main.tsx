import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ScoringApp } from "./ScoringApp.js";
import { isScoringPath } from "./appMode.js";
import "./styles.css";

// T2I-Explorer keeps its existing routes at `/`; Scoring lives at `/scoring`.
// Switching modes is a full page navigation, so each mode owns its URL state.
createRoot(document.getElementById("root")!).render(<StrictMode>{isScoringPath(window.location.pathname) ? <ScoringApp /> : <App />}</StrictMode>);
