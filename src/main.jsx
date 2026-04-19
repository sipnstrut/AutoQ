import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AutoQ from "./AutoQ";
import "./autoq.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <section className="autoq-section">
      <AutoQ />
    </section>
  </StrictMode>,
);
