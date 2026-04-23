import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AutoQ from "./AutoQ";
import "./autoq.css";

// When this bundle is served from sipnstrut (e.g. as the "More Magic" iframe
// under /games/autoq-more-magic/), /api/dictionary is same-origin and usable.
// On the Vite dev server that endpoint doesn't exist, so the catch/branch
// fail-opens and every composable word is accepted — same behavior this
// entry had before the wiring.
async function validateWords(wordsInput) {
  const words = (wordsInput || "")
    .replace(/[\s,+]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return { valid: [], invalid: [] };
  try {
    const res = await fetch("/api/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words }),
    });
    if (!res.ok) return { valid: words, invalid: [] };
    return await res.json();
  } catch {
    return { valid: words, invalid: [] };
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <section className="autoq-section">
      <AutoQ validateWords={validateWords} />
    </section>
  </StrictMode>,
);
