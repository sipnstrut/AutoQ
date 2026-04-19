/**
 * AutoQ — Standalone React component.
 *
 * Usage:
 *   import AutoQ from "./AutoQ";
 *   <AutoQ />
 *
 * Props (all optional):
 *   scores        — Array of historical score objects for bot play selection.
 *                   If omitted, loads from bundled bot-scores.json.
 *   validateWords — async function(wordsInput) => { valid: [], invalid: [{ word }] }.
 *                   If omitted, dictionary validation is skipped.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  CARD_VALUES, HANDS,
  createGame, takeMulligan, submitHand, getStandings, getUsedCardIndices,
} from "./autoq-engine";
import botScoresData from "./bot-scores.json";

/**
 * @param {object} [props]
 * @param {Array} [props.scores]
 * @param {(input: string) => Promise<{valid: string[], invalid: {word: string}[]}>} [props.validateWords]
 * @param {(game: any) => void} [props.onStateChange]
 */
export default function AutoQ({ scores, validateWords, onStateChange } = {}) {
  const historicalScores = scores || botScoresData;
  const [game, setGame] = useState(null);
  const [opponentCount, setOpponentCount] = useState(3);
  const [wordsInput, setWordsInput] = useState("");
  const [error, setError] = useState(null);
  const [showLastResult, setShowLastResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (game?.status === "playing" && !showLastResult && inputRef.current) {
      inputRef.current.focus();
    }
  }, [game?.currentHand, game?.status, showLastResult]);

  useEffect(() => {
    if (onStateChange) onStateChange(game);
  }, [game, onStateChange]);

  const handleStart = useCallback(() => {
    setGame(createGame(opponentCount, historicalScores));
    setWordsInput("");
    setError(null);
    setShowLastResult(false);
  }, [opponentCount, historicalScores]);

  const handleMulligan = useCallback(() => {
    if (!game) return;
    const hand = game.currentHand;
    if ((game.mulligans[hand] || 0) >= hand - 2) return;
    setGame(takeMulligan(game));
    setError(null);
  }, [game]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!game || submitting) return;

    if (wordsInput.trim() && validateWords) {
      setSubmitting(true);
      try {
        const dictCheck = await validateWords(wordsInput);
        if (dictCheck.invalid && dictCheck.invalid.length > 0) {
          const bad = dictCheck.invalid.map((w) => w.word).join(", ");
          setError(`Not in the dictionary: ${bad}`);
          setSubmitting(false);
          return;
        }
      } catch { /* fail-open */ }
      setSubmitting(false);
    }

    const { game: newGame, error: err } = submitHand(game, wordsInput);
    if (err) { setError(err); return; }
    setGame(newGame);
    setWordsInput("");
    setError(null);
    setShowLastResult(true);
  }, [game, wordsInput, submitting, validateWords]);

  const handleContinue = useCallback(() => setShowLastResult(false), []);

  const handleQuit = useCallback(() => {
    setGame(null);
    setWordsInput("");
    setError(null);
    setShowLastResult(false);
  }, []);

  // Card graying
  const dealtCards = game?.status === "playing" ? game.dealtHands[game.currentHand] : [];
  const mulligansForHand = game ? (game.mulligans[game.currentHand] || 0) : 0;
  const maxCardsForHand = game ? Math.max(2, game.currentHand - mulligansForHand) : 0;
  const usedIndices = useMemo(
    () => getUsedCardIndices(wordsInput, maxCardsForHand, dealtCards),
    [wordsInput, maxCardsForHand, dealtCards]
  );

  // ── Idle ───────────────────────────────────────────────
  if (!game) {
    return (
      <section className="autoq-section" id="autoq">
        <h2 className="autoq-title">AutoQ</h2>
        <div className="autoq-start-panel">
          <p className="autoq-description">Solo Quiddler — play 8 hands (3-10 cards) against bot opponents.</p>
          <div className="autoq-start-controls">
            <label className="autoq-label">
              Opponents
              <select value={opponentCount} onChange={(e) => setOpponentCount(Number(e.target.value))} className="autoq-select">
                {[0,1,2,3,4,5,6,7].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "0 (Solo)" : n}</option>
                ))}
              </select>
            </label>
            <button className="autoq-btn autoq-btn-primary" onClick={handleStart}>Start Game</button>
          </div>
        </div>
      </section>
    );
  }

  // ── Active game ────────────────────────────────────────
  const hand = game.currentHand;
  const handIndex = hand ? HANDS.indexOf(hand) : -1;
  const mulligans = mulligansForHand;
  const maxCards = maxCardsForHand;
  const canMulligan = hand ? mulligans < hand - 2 : false;
  const lastResult = game.handResults.length > 0 ? game.handResults[game.handResults.length - 1] : null;
  const standings = getStandings(game);

  let leftContent;

  if (game.status === "complete") {
    leftContent = (
      <div className="autoq-left">
        <HandHistory results={game.handResults} />
        <div className="autoq-actions">
          <button className="autoq-btn autoq-btn-primary" onClick={handleStart}>Play Again</button>
          <button className="autoq-btn" onClick={handleQuit}>Done</button>
        </div>
      </div>
    );
  } else if (showLastResult && lastResult) {
    leftContent = (
      <div className="autoq-left">
        <h3 className="autoq-phase-title">Hand {lastResult.hand} Results</h3>
        <HandResultPanel result={lastResult} />
        <div className="autoq-actions">
          {game.status === "playing" ? (
            <button className="autoq-btn autoq-btn-primary" onClick={handleContinue}>Next Hand (Hand {hand})</button>
          ) : (
            <button className="autoq-btn autoq-btn-primary" onClick={handleContinue}>See Final Standings</button>
          )}
        </div>
      </div>
    );
  } else {
    leftContent = (
      <div className="autoq-left">
        <div className="autoq-hand-info">
          <span className="autoq-hand-badge">Hand {handIndex + 1} of {HANDS.length}</span>
          <span className="autoq-card-count">{maxCards} cards{mulligans > 0 ? ` (${mulligans} mulligan${mulligans > 1 ? "s" : ""})` : ""}</span>
        </div>

        <div className="autoq-cards">
          {dealtCards.map((card, i) => (
            <div key={`${card}-${i}`} className={`autoq-card${usedIndices.has(i) ? " autoq-card-used" : ""}`}>
              <span className="autoq-card-letter">{card.toLowerCase()}</span>
              <span className="autoq-card-value">{CARD_VALUES[card]}</span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="autoq-input-row">
          <input
            ref={inputRef}
            type="text"
            value={wordsInput}
            onChange={(e) => { setWordsInput(e.target.value); setError(null); }}
            placeholder="Enter words (e.g. cat dog)"
            className="autoq-input"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="autoq-btn autoq-btn-primary" disabled={submitting}>{submitting ? "Checking..." : "Submit"}</button>
          <button type="button" className="autoq-btn" onClick={handleMulligan} disabled={!canMulligan} title="Redraw cards (lose 1 card slot)">Mulligan</button>
          <button type="button" className="autoq-btn autoq-btn-danger" onClick={handleQuit}>Quit</button>
        </form>

        {error && <p className="autoq-error">{error}</p>}
        <p className="autoq-hint">Separate words with spaces. Hyphens for explicit card splits (e.g. qu-i-z). Blank submit = 0 points.</p>
      </div>
    );
  }

  const titleSuffix = game.status === "complete" ? "Game Complete" : `Hand ${hand}`;

  return (
    <section className="autoq-section" id="autoq">
      <h2 className="autoq-title">AutoQ — {titleSuffix}</h2>
      <div className="autoq-layout">
        {leftContent}
        <div className="autoq-right">
          <StandingsTable standings={standings} isComplete={game.status === "complete"} handResults={game.handResults} />
        </div>
      </div>
    </section>
  );
}

// ── Sub-components ──────────────────────────────────────

function StandingsTable({ standings, isComplete, handResults }) {
  const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
  return (
    <div className="autoq-standings">
      <h3 className="autoq-standings-title">{isComplete ? "Final Standings" : "Standings"}</h3>
      <table className="autoq-table">
        <thead>
          <tr><th></th><th>Player</th><th>Raw</th><th>Stars</th><th>Bonus</th><th>Final</th></tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr key={s.name} className={s.isPlayer ? "autoq-player-row" : ""}>
              <td className="autoq-rank">{medals[i] || `${i + 1}.`}</td>
              <td className={s.isPlayer ? "autoq-you" : ""}>{s.name}</td>
              <td>{s.raw}</td>
              <td>{s.stars > 0 ? "\u2605".repeat(s.stars) + ` (${s.stars})` : "\u2014"}</td>
              <td>+{s.stars * 10}</td>
              <td className="autoq-final">{s.eff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {handResults.length > 0 && <HandHistory results={handResults} />}
    </div>
  );
}

function HandResultPanel({ result }) {
  const allScores = [
    { name: "You", raw: result.raw_score, stars: result.stars, words: result.words || "(no words)", isPlayer: true },
    ...result.botScores.map((bs) => ({ name: bs.name, raw: bs.raw_score, stars: bs.stars, words: bs.words || "(no words)", isPlayer: false })),
  ];
  return (
    <div className="autoq-result-panel">
      <table className="autoq-table autoq-result-table">
        <thead><tr><th>Player</th><th>Words</th><th>Raw</th><th>Stars</th><th>Eff</th></tr></thead>
        <tbody>
          {allScores.map((s) => (
            <tr key={s.name} className={s.isPlayer ? "autoq-player-row" : ""}>
              <td className={s.isPlayer ? "autoq-you" : ""}>{s.name}</td>
              <td className="autoq-words-cell">{s.words || "\u2014"}</td>
              <td>{s.raw}</td>
              <td>{s.stars > 0 ? "\u2605".repeat(s.stars) : "\u2014"}</td>
              <td className="autoq-final">{s.raw + s.stars * 10}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="autoq-star-summary">{result.starSummary}</p>
    </div>
  );
}

function HandHistory({ results }) {
  if (!results.length) return null;
  return (
    <details className="autoq-history">
      <summary>Hand-by-Hand Results</summary>
      <div className="autoq-history-grid">
        {results.map((r) => (
          <div key={r.hand} className="autoq-history-hand">
            <strong>Hand {r.hand}</strong>
            <span className="autoq-history-you">You: {r.words || "\u2014"} ({r.raw_score}{r.stars > 0 ? ` +${"\u2605".repeat(r.stars)}` : ""})</span>
            {r.botScores.map((bs) => (
              <span key={bs.name} className="autoq-history-bot">{bs.name}: {bs.words || "\u2014"} ({bs.raw_score}{bs.stars > 0 ? ` +${"\u2605".repeat(bs.stars)}` : ""})</span>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
