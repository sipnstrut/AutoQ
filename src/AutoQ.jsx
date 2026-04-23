"use client";

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
  createGame, takeMulligan, submitHand, getStandings,
  matchStagedWordGroups,
  canMulligan as engineCanMulligan,
  toggleDiscard,
} from "./autoq-engine";
import botScoresData from "./bot-scores.json";

// ── Staged-word helpers (pure) ─────────────────────────
const removeFromStagedWords = (words, i) => words.map((w) => w.filter((x) => x !== i));
const appendToLastWord = (words, i) => {
  const last = words.length - 1;
  return words.map((w, j) => (j === last ? [...w, i] : w));
};
const insertBeforeCard = (words, i, beforeCardIndex) => (
  words.map((w) => {
    const at = w.indexOf(beforeCardIndex);
    if (at === -1) return w;
    return [...w.slice(0, at), i, ...w.slice(at)];
  })
);
const insertAfterCard = (words, i, afterCardIndex) => (
  words.map((w) => {
    const at = w.indexOf(afterCardIndex);
    if (at === -1) return w;
    return [...w.slice(0, at + 1), i, ...w.slice(at + 1)];
  })
);
// Collapse empty words except the last; always keep at least one.
const cleanupStagedWords = (words) => {
  const keep = words.filter((w, i) => w.length > 0 || i === words.length - 1);
  return keep.length ? keep : [[]];
};

// Pixel threshold before a pointer-down + move becomes a drag (vs. a click).
const DRAG_THRESHOLD_PX = 6;

// Per-word color palette. Max words in a single hand is 5 (hand 10 plays at
// most 10 cards, minimum 2 cards per word), so five well-separated hues
// cover every case. Modulo kept as a belt-and-braces guard.
const WORD_COLORS = [
  { border: "#2563eb", bg: "rgba(37, 99, 235, 0.14)" },   // blue
  { border: "#16a34a", bg: "rgba(22, 163, 74, 0.16)" },   // green
  { border: "#d97706", bg: "rgba(217, 119, 6, 0.16)" },   // amber
  { border: "#9333ea", bg: "rgba(147, 51, 234, 0.16)" },  // purple
  { border: "#db2777", bg: "rgba(219, 39, 119, 0.16)" },  // pink
];

/**
 * @param {object} [props]
 * @param {Array} [props.scores]
 * @param {(input: string) => Promise<{valid: string[], invalid: {word: string}[]}>} [props.validateWords]
 * @param {(game: any) => void} [props.onStateChange] — fires whenever the
 *   internal game state changes (start, mulligan, submit, finish, reset).
 *   Passed the current game object, or null if no game is active.
 */
export default function AutoQ({ scores, validateWords, onStateChange } = {}) {
  const historicalScores = scores || botScoresData;
  const [game, setGame] = useState(null);
  const [opponentCount, setOpponentCount] = useState(3);
  const [wordsInput, setWordsInput] = useState("");
  // Staged cards grouped by word — always at least one (possibly empty) word.
  // Primary source of truth for blue highlighting and the badge numbering.
  // The text box is kept in sync; it can drift red when typed text can't be
  // matched back against available cards.
  const [stagedWords, setStagedWords] = useState([[]]);
  // Player-controlled ordering of the hand. A permutation of all dealt-card
  // indices for the current hand; the rendered hand is this list filtered to
  // cards that are neutral (not staged, not discarded). Reset when the dealt
  // cards themselves change (new hand / mulligan).
  const [handOrder, setHandOrder] = useState([]);
  // Which staged word subsequent click-stages go into. Changes when the
  // player clicks a word divider, adds a new word, or edits the text input.
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Which hand's result popup is open, and whether it auto-opened from a
  // just-completed hand (8s auto-close) vs. a manual click on the
  // scoreboard (stays open until dismissed). null = closed.
  const [popupHand, setPopupHand] = useState(null);
  const lastResultCountRef = useRef(0);
  // Active drag state, or null when nothing is being dragged.
  // { index, startX, startY, x, y, zone, beforeCardIndex }
  const [drag, setDrag] = useState(null);
  const inputRef = useRef(null);
  const pointerStartRef = useRef(null);
  const stagedRowRef = useRef(null);
  const handRowRef = useRef(null);
  const discardRowRef = useRef(null);
  const newWordBarRef = useRef(null);

  useEffect(() => {
    if (game?.status === "playing" && !popupHand && inputRef.current) {
      inputRef.current.focus();
    }
  }, [game?.currentHand, game?.status, popupHand]);

  // Auto-open the hand-result popup whenever a new result lands (submit,
  // not when loading from scratch). Uses a ref counter so initial mount
  // with any existing results doesn't pop.
  useEffect(() => {
    const count = game?.handResults?.length ?? 0;
    if (count > lastResultCountRef.current) {
      const latest = game.handResults[count - 1];
      if (latest) setPopupHand({ hand: latest.hand, auto: true });
    }
    lastResultCountRef.current = count;
  }, [game?.handResults]);

  useEffect(() => {
    if (onStateChange) onStateChange(game);
  }, [game, onStateChange]);

  const handleStart = useCallback(() => {
    setGame(createGame(opponentCount, historicalScores));
    setWordsInput("");
    setStagedWords([[]]);
    setActiveWordIndex(0);
    setError(null);
    setPopupHand(null);
    lastResultCountRef.current = 0;
  }, [opponentCount, historicalScores]);

  const handleMulligan = useCallback(() => {
    if (!engineCanMulligan(game)) return;
    setGame(takeMulligan(game));
    setWordsInput("");
    setStagedWords([[]]);
    setActiveWordIndex(0);
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
    setStagedWords([[]]);
    setActiveWordIndex(0);
    setError(null);
  }, [game, wordsInput, submitting, validateWords]);

  const handleQuit = useCallback(() => {
    setGame(null);
    setWordsInput("");
    setStagedWords([[]]);
    setActiveWordIndex(0);
    setError(null);
    setPopupHand(null);
    lastResultCountRef.current = 0;
  }, []);

  const dealtCards = game?.status === "playing" ? game.dealtHands[game.currentHand] : [];
  const mulligansForHand = game ? (game.mulligans[game.currentHand] || 0) : 0;
  const maxCardsForHand = game ? Math.max(2, game.currentHand - mulligansForHand) : 0;
  // Each word needs at least 2 cards, so the most words you could play in
  // a hand is half the playable-card count. (Hand 3 → 1 word; hand 4/5 → 2;
  // hand 6/7 → 3; hand 8/9 → 4; hand 10 → 5.) Enforced silently.
  const maxWordsForHand = Math.floor(maxCardsForHand / 2);
  const discardedIndices = useMemo(
    () => new Set(game?.status === "playing" ? (game.discards?.[game.currentHand] || []) : []),
    [game]
  );
  const stagedIndices = useMemo(() => stagedWords.flat(), [stagedWords]);
  const stagedSet = useMemo(() => new Set(stagedIndices), [stagedIndices]);
  const nonEmptyWordCount = useMemo(
    () => stagedWords.reduce((n, w) => n + (w.length > 0 ? 1 : 0), 0),
    [stagedWords],
  );
  const canAddWord = nonEmptyWordCount < maxWordsForHand;
  // Card index -> 1-based word number, drives the circled-number badge.
  const stagedWordNums = useMemo(() => {
    const m = new Map();
    stagedWords.forEach((word, wi) => {
      for (const i of word) m.set(i, wi + 1);
    });
    return m;
  }, [stagedWords]);

  // The last card in each word — only these get a visible point-total badge,
  // so the badge reads as a label at the end of the word rather than on every
  // card.
  const wordEndIndices = useMemo(() => {
    const s = new Set();
    for (const word of stagedWords) {
      if (word.length > 0) s.add(word[word.length - 1]);
    }
    return s;
  }, [stagedWords]);

  // Raw point total per word (sum of dealt-card values), indexed by word.
  const wordPointTotals = useMemo(() => (
    stagedWords.map((word) => word.reduce(
      (sum, i) => sum + (CARD_VALUES[dealtCards[i]] || 0),
      0,
    ))
  ), [stagedWords, dealtCards]);

  // When dealtCards changes (new hand, mulligan, new game) reset handOrder
  // to the default identity permutation so a fresh deal doesn't inherit the
  // previous hand's custom ordering.
  useEffect(() => {
    setHandOrder(dealtCards.map((_, i) => i));
  }, [dealtCards]);

  // Keep activeWordIndex within bounds whenever cleanup drops word groups.
  useEffect(() => {
    if (activeWordIndex >= stagedWords.length) {
      setActiveWordIndex(Math.max(0, stagedWords.length - 1));
    }
  }, [stagedWords, activeWordIndex]);

  // True when typed text contains letters that can't be mapped to the
  // available (non-discarded) cards, OR when the player has typed more
  // words than this hand allows. Box turns red; highlights are preserved.
  const isInputInvalid = useMemo(() => {
    if (!wordsInput.trim()) return false;
    const groups = matchStagedWordGroups(wordsInput, maxCardsForHand, dealtCards, discardedIndices);
    if (groups === null) return true;
    const nonEmpty = groups.reduce((n, w) => n + (w.length > 0 ? 1 : 0), 0);
    return nonEmpty > maxWordsForHand;
  }, [wordsInput, maxCardsForHand, dealtCards, discardedIndices, maxWordsForHand]);

  // Concat staged word groups back into a single space-separated text value;
  // `.join(" ")` naturally preserves a trailing empty word as a trailing space.
  const stagedToText = useCallback((words) => (
    words.map((w) => w.map((i) => (dealtCards[i] || "").toLowerCase()).join("")).join(" ")
  ), [dealtCards]);

  // Click semantics (no double-click anywhere): clicking always moves the
  // card one step *toward neutral* or *into the active word*:
  //   neutral    -> staged (appended to activeWordIndex)
  //   staged     -> neutral (removed from staged)
  //   discarded  -> neutral (un-discarded)
  // The "active word" defaults to the last word and can be changed by the
  // player clicking a word divider. Every other transition (discard,
  // reorder, cross-word move) is by drag.
  const handleCardClick = useCallback((i) => {
    const wasStaged = stagedSet.has(i);
    const wasDiscarded = discardedIndices.has(i);
    if (wasDiscarded) {
      setGame((g) => toggleDiscard(g, i));
    } else if (wasStaged) {
      // Remember which word the card came from so focus follows the
      // interaction (un-staging from word 2 should leave word 2 selected).
      const fromWord = stagedWords.findIndex((w) => w.includes(i));
      const next = cleanupStagedWords(removeFromStagedWords(stagedWords, i));
      setStagedWords(next);
      setWordsInput(stagedToText(next));
      if (fromWord >= 0) {
        setActiveWordIndex(Math.min(fromWord, Math.max(0, next.length - 1)));
      }
    } else {
      // Placing into the active word keeps active where it is — self-
      // consistent, so no setActiveWordIndex call needed here.
      const target = Math.min(activeWordIndex, stagedWords.length - 1);
      const next = cleanupStagedWords(
        stagedWords.map((w, j) => (j === target ? [...w, i] : w)),
      );
      setStagedWords(next);
      setWordsInput(stagedToText(next));
    }
    setError(null);
    inputRef.current?.focus();
  }, [stagedSet, discardedIndices, stagedWords, activeWordIndex, stagedToText]);

  // Apply a drop. `fromIndex` is the dragged dealt-card index; `zone` is the
  // zone the drop landed in; `beforeCardIndex` / `afterCardIndex` describe
  // a per-card insertion slot (mutually exclusive); `hoveredWordIndex` lets
  // a row-level drop append to a specific word's row.
  const applyDrop = useCallback((fromIndex, zone, beforeCardIndex, afterCardIndex, hoveredWordIndex) => {
    if (!zone) return;
    const wasStaged = stagedSet.has(fromIndex);
    const wasDiscarded = discardedIndices.has(fromIndex);

    if (zone === "staged") {
      let newWords = removeFromStagedWords(stagedWords, fromIndex);
      if (beforeCardIndex != null && beforeCardIndex !== fromIndex) {
        newWords = insertBeforeCard(newWords, fromIndex, beforeCardIndex);
      } else if (afterCardIndex != null && afterCardIndex !== fromIndex) {
        // Append in the target card's word, just after it — the main path
        // for extending a word past its last card.
        newWords = insertAfterCard(newWords, fromIndex, afterCardIndex);
      } else if (hoveredWordIndex != null && hoveredWordIndex < newWords.length) {
        // Dropped in the empty part of a word's row — append to that word.
        newWords = newWords.map((w, j) =>
          j === hoveredWordIndex ? [...w, fromIndex] : w,
        );
        newWords = cleanupStagedWords(newWords);
      } else {
        // No specific target — fall back to the active word. Starting a
        // new word is reserved for the + bar / space / new-word zone.
        newWords = cleanupStagedWords(newWords);
        const target = Math.min(
          Math.max(0, activeWordIndex),
          Math.max(0, newWords.length - 1),
        );
        newWords = newWords.map((w, j) => (j === target ? [...w, fromIndex] : w));
      }
      newWords = cleanupStagedWords(newWords);
      setStagedWords(newWords);
      setWordsInput(stagedToText(newWords));
      // Focus follows the dragged card to whichever word it landed in.
      const landed = newWords.findIndex((w) => w.includes(fromIndex));
      if (landed >= 0) setActiveWordIndex(landed);
      if (wasDiscarded) setGame((g) => toggleDiscard(g, fromIndex));
    } else if (zone === "hand") {
      if (wasStaged) {
        const fromWord = stagedWords.findIndex((w) => w.includes(fromIndex));
        const newWords = cleanupStagedWords(removeFromStagedWords(stagedWords, fromIndex));
        setStagedWords(newWords);
        setWordsInput(stagedToText(newWords));
        if (fromWord >= 0) {
          setActiveWordIndex(Math.min(fromWord, Math.max(0, newWords.length - 1)));
        }
      }
      if (wasDiscarded) setGame((g) => toggleDiscard(g, fromIndex));
      // Reorder or insert in the hand. Left half of a card → before, right
      // half → after; no target → append to end.
      setHandOrder((prev) => {
        const without = prev.filter((x) => x !== fromIndex);
        if (beforeCardIndex != null && beforeCardIndex !== fromIndex) {
          const at = without.indexOf(beforeCardIndex);
          if (at !== -1) return [...without.slice(0, at), fromIndex, ...without.slice(at)];
        }
        if (afterCardIndex != null && afterCardIndex !== fromIndex) {
          const at = without.indexOf(afterCardIndex);
          if (at !== -1) return [...without.slice(0, at + 1), fromIndex, ...without.slice(at + 1)];
        }
        return [...without, fromIndex];
      });
    } else if (zone === "discard") {
      if (wasDiscarded) return;
      if (wasStaged) {
        const newWords = cleanupStagedWords(removeFromStagedWords(stagedWords, fromIndex));
        setStagedWords(newWords);
        setWordsInput(stagedToText(newWords));
      }
      setGame((g) => toggleDiscard(g, fromIndex));
    } else if (zone === "new-word") {
      // Start a fresh word with the dragged card. Fills a trailing empty if
      // one already exists (no word-count change); otherwise silently
      // refuses when the hand's cap is reached.
      let newWords = removeFromStagedWords(stagedWords, fromIndex);
      newWords = cleanupStagedWords(newWords);
      const last = newWords.length - 1;
      if (newWords[last] && newWords[last].length === 0) {
        newWords = newWords.map((w, j) => (j === last ? [fromIndex] : w));
      } else {
        const currentNonEmpty = newWords.reduce((n, w) => n + (w.length > 0 ? 1 : 0), 0);
        if (currentNonEmpty >= maxWordsForHand) return;
        newWords = [...newWords, [fromIndex]];
      }
      setStagedWords(newWords);
      setWordsInput(stagedToText(newWords));
      const landed = newWords.findIndex((w) => w.includes(fromIndex));
      if (landed >= 0) setActiveWordIndex(landed);
      if (wasDiscarded) setGame((g) => toggleDiscard(g, fromIndex));
    }
    setError(null);
  }, [stagedSet, discardedIndices, stagedWords, stagedToText, maxWordsForHand, activeWordIndex]);

  // Click the + bar to open a trailing empty word (same effect as pressing
  // space in the text box) and make it the active word so the next click
  // starts filling it. If a trailing empty already exists, just activate it.
  // Silently no-ops when the hand's word cap is already reached.
  const handleAddWord = useCallback(() => {
    const last = stagedWords.length - 1;
    if (stagedWords[last] && stagedWords[last].length === 0) {
      setActiveWordIndex(last);
      inputRef.current?.focus();
      return;
    }
    if (!canAddWord) return;
    const next = [...stagedWords, []];
    setStagedWords(next);
    setWordsInput(stagedToText(next));
    setActiveWordIndex(next.length - 1);
    setError(null);
    inputRef.current?.focus();
  }, [stagedWords, stagedToText, canAddWord]);

  // Which drop zone (if any) contains the given viewport point. The "+ new
  // word" bar lives inside the staged row, so it has to be checked first or
  // it gets swallowed by the staged-row rect.
  const getZoneAtPoint = useCallback((x, y) => {
    const bar = newWordBarRef.current?.getBoundingClientRect();
    if (bar && x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom) return "new-word";
    const zones = [
      ["staged", stagedRowRef.current],
      ["hand", handRowRef.current],
      ["discard", discardRowRef.current],
    ];
    for (const [name, el] of zones) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return name;
    }
    return null;
  }, []);

  // If the pointer is over a card, return its dealt-card index plus whether
  // the pointer is on the left or right half — which applyDrop uses to
  // decide whether to insert *before* or *after* the target.
  const getCardDropInfo = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    const cardEl = el?.closest?.("[data-card-index]");
    if (!cardEl) return null;
    const idx = Number(cardEl.dataset.cardIndex);
    if (!Number.isFinite(idx)) return null;
    const rect = cardEl.getBoundingClientRect();
    const side = x > rect.left + rect.width / 2 ? "after" : "before";
    return { index: idx, side };
  }, []);

  // If the pointer is anywhere inside a staged word's row (but not on a
  // specific card), return that word's index. Lets the player drop a card
  // into empty space within a word's row and have it append to that word.
  const getWordIndexAtPoint = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    const wordEl = el?.closest?.("[data-word-index]");
    if (!wordEl) return null;
    const idx = Number(wordEl.dataset.wordIndex);
    return Number.isFinite(idx) ? idx : null;
  }, []);

  const onCardPointerDown = useCallback((e, i) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    pointerStartRef.current = {
      index: i,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerId: e.pointerId,
      target: e.currentTarget,
      activated: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }, []);

  const onCardPointerMove = useCallback((e) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    if (!start.activated && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    start.activated = true;
    const zone = getZoneAtPoint(e.clientX, e.clientY);
    // Hand and staged both support "drop near this card" positioning; left
    // half of card = before, right half = after. Other zones (discard,
    // new-word) ignore sub-targets.
    const info = (zone === "staged" || zone === "hand")
      ? getCardDropInfo(e.clientX, e.clientY)
      : null;
    let beforeCardIndex = null;
    let afterCardIndex = null;
    let hoveredWordIndex = null;
    if (info && info.index !== start.index) {
      if (info.side === "before") beforeCardIndex = info.index;
      else afterCardIndex = info.index;
    } else if (zone === "staged") {
      // No specific card under pointer — check if it's inside a word's row,
      // so applyDrop can append to that word instead of the active word.
      hoveredWordIndex = getWordIndexAtPoint(e.clientX, e.clientY);
    }
    setDrag({
      index: start.index,
      offsetX: start.offsetX,
      offsetY: start.offsetY,
      x: e.clientX,
      y: e.clientY,
      zone,
      beforeCardIndex,
      afterCardIndex,
      hoveredWordIndex,
    });
  }, [getZoneAtPoint, getCardDropInfo, getWordIndexAtPoint]);

  const onCardPointerUp = useCallback((e) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerId !== e.pointerId) return;
    try { start.target.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (start.activated && drag) {
      applyDrop(drag.index, drag.zone, drag.beforeCardIndex, drag.afterCardIndex, drag.hoveredWordIndex);
    } else {
      handleCardClick(start.index);
    }
    setDrag(null);
  }, [drag, applyDrop, handleCardClick]);

  const onCardPointerCancel = useCallback(() => {
    pointerStartRef.current = null;
    setDrag(null);
  }, []);

  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    setWordsInput(value);
    setError(null);
    // Empty / whitespace-only input with no trailing space: clear staging.
    if (!value.trim() && !value.endsWith(" ")) {
      setStagedWords([[]]);
    setActiveWordIndex(0);
      return;
    }
    const groups = matchStagedWordGroups(value, maxCardsForHand, dealtCards, discardedIndices);
    // null = letters don't resolve; keep last staged state so highlights
    // persist while the box is red.
    if (groups !== null) {
      const nonEmpty = groups.reduce((n, w) => n + (w.length > 0 ? 1 : 0), 0);
      // Too many real words for this hand — silently refuse to update
      // staged. isInputInvalid will paint the box red as a cue.
      if (nonEmpty > maxWordsForHand) return;
      let next = groups.length ? groups : [[]];
      // Already at the cap with a trailing empty-word placeholder (e.g. a
      // typed trailing space after filling the last allowed word). Drop
      // the placeholder so it doesn't tempt the player into a 6th click.
      if (nonEmpty >= maxWordsForHand) {
        const trimmed = next.filter((w) => w.length > 0);
        next = trimmed.length ? trimmed : [[]];
      }
      setStagedWords(next);
      setActiveWordIndex(next.length - 1);
    }
  }, [maxCardsForHand, dealtCards, discardedIndices, maxWordsForHand]);

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
              <select value={opponentCount} onChange={(e) => setOpponentCount(Number(e.target.value))} className="autoq-select" data-tour="opponents">
                {[0,1,2,3,4,5,6,7].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "0 (Solo)" : n}</option>
                ))}
              </select>
            </label>
            <button className="autoq-btn autoq-btn-primary" onClick={handleStart} data-tour="start">Start Game</button>
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
  const canMulligan = engineCanMulligan(game);
  let leftContent;

  if (game.status === "complete") {
    leftContent = (
      <div className="autoq-left">
        <div className="autoq-actions">
          <button className="autoq-btn autoq-btn-primary" onClick={handleStart}>Play Again</button>
          <button className="autoq-btn" onClick={handleQuit}>Done</button>
        </div>
      </div>
    );
  } else {
    leftContent = (
      <div className="autoq-left">
        <div className="autoq-hand-info">
          <span className="autoq-hand-badge" data-tour="hand-badge">Hand {handIndex + 1} of {HANDS.length}</span>
          <span className="autoq-card-count" data-tour="card-count">{maxCards} cards{mulligans > 0 ? ` (${mulligans} mulligan${mulligans > 1 ? "s" : ""})` : ""}</span>
        </div>

        {(() => {
          // Card renderer shared by all three zones. Keeps a single source of
          // truth for drag visuals, pointer wiring, and state-derived classes.
          const renderCard = (i) => {
            const card = dealtCards[i];
            const wordNum = stagedWordNums.get(i);
            const wordIdx = wordNum != null ? wordNum - 1 : -1;
            const wordColor = wordIdx >= 0 ? WORD_COLORS[wordIdx % WORD_COLORS.length] : null;
            const isDragged = drag?.index === i;
            const state = stagedSet.has(i) ? "used" : discardedIndices.has(i) ? "discarded" : "neutral";

            // Drop-preview shift: only the two cards bracketing the insertion
            // slot nudge outward — the one just before the slot goes left, the
            // one just after goes right, opening a gap.
            let dropShift = 0;
            if (drag && !isDragged) {
              const zoneOfThis = stagedSet.has(i) ? "staged"
                : discardedIndices.has(i) ? "discard" : "hand";
              if (zoneOfThis === drag.zone) {
                const order = zoneOfThis === "staged" ? stagedIndices : neutralIndices;
                const thisPos = order.indexOf(i);
                if (thisPos !== -1) {
                  if (drag.beforeCardIndex != null) {
                    const t = order.indexOf(drag.beforeCardIndex);
                    if (thisPos === t) dropShift = 10;          // at slot, goes right
                    else if (thisPos === t - 1) dropShift = -10; // before slot, goes left
                  } else if (drag.afterCardIndex != null) {
                    const t = order.indexOf(drag.afterCardIndex);
                    if (thisPos === t) dropShift = -10;          // before slot (target), goes left
                    else if (thisPos === t + 1) dropShift = 10;  // at slot, goes right
                  }
                }
              }
            }

            const style = {
              // Dragged in-slot card stays put as a faded "afterimage"; the
              // live floating clone is rendered separately at the viewport.
              ...(isDragged ? {
                opacity: 0.32,
                filter: "saturate(0.4)",
                pointerEvents: "none",
              } : dropShift ? {
                transform: `translateX(${dropShift}px)`,
              } : {}),
              ...(wordColor ? {
                "--word-color": wordColor.border,
                "--word-color-bg": wordColor.bg,
              } : {}),
            };
            return (
              <div
                key={`card-${i}`}
                data-card-index={i}
                className={`autoq-card autoq-card-${state}${isDragged ? " autoq-card-ghost" : ""}`}
                style={style}
                onPointerDown={(e) => onCardPointerDown(e, i)}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                onPointerCancel={onCardPointerCancel}
                title="Click to move · Drag between rows to stage, un-stage, or discard"
              >
                {wordEndIndices.has(i) && wordIdx >= 0 && (
                  <span className="autoq-card-word-badge">{wordPointTotals[wordIdx]}</span>
                )}
                <span className="autoq-card-letter">{card.toLowerCase()}</span>
                <span className="autoq-card-value">{CARD_VALUES[card]}</span>
              </div>
            );
          };

          // Floating clone — rendered once per drag, positioned at the pointer.
          // Separated from the in-slot ghost so the original slot stays visible
          // as an afterimage that the player can drop back onto.
          const renderFloatingClone = () => {
            if (!drag) return null;
            const i = drag.index;
            const card = dealtCards[i];
            if (card == null) return null;
            const wordNum = stagedWordNums.get(i);
            const wordIdx = wordNum != null ? wordNum - 1 : -1;
            const wordColor = wordIdx >= 0 ? WORD_COLORS[wordIdx % WORD_COLORS.length] : null;
            const state = stagedSet.has(i) ? "used" : discardedIndices.has(i) ? "discarded" : "neutral";
            const style = {
              position: "fixed",
              left: drag.x - drag.offsetX,
              top: drag.y - drag.offsetY,
              pointerEvents: "none",
              zIndex: 1000,
              transform: "scale(1.06)",
              // Anchor the scale to the pointer grip point so the 1.06x
              // doesn't drift the card relative to the pointer.
              transformOrigin: `${drag.offsetX}px ${drag.offsetY}px`,
              transition: "none",
              ...(wordColor ? {
                "--word-color": wordColor.border,
                "--word-color-bg": wordColor.bg,
              } : {}),
            };
            return (
              <div
                className={`autoq-card autoq-card-${state} autoq-card-dragging`}
                style={style}
              >
                {wordEndIndices.has(i) && wordIdx >= 0 && (
                  <span className="autoq-card-word-badge">{wordPointTotals[wordIdx]}</span>
                )}
                <span className="autoq-card-letter">{card.toLowerCase()}</span>
                <span className="autoq-card-value">{CARD_VALUES[card]}</span>
              </div>
            );
          };

          const neutralIndices = handOrder.filter(
            (i) => i < dealtCards.length && !stagedSet.has(i) && !discardedIndices.has(i),
          );
          const discardedList = dealtCards
            .map((_, i) => i)
            .filter((i) => discardedIndices.has(i));
          const overClass = (zone) => (drag?.zone === zone ? " autoq-drop-over" : "");

          return (
            <>
              <div className="autoq-play-area">
                <div
                  ref={stagedRowRef}
                  className={`autoq-staged-row${overClass("staged")}`}
                  data-tour="staged"
                >
                  {stagedIndices.length === 0 && (
                    <span className="autoq-zone-empty">Click or drop a card to start a word</span>
                  )}
                  {stagedWords.map((word, wi) => {
                    if (word.length === 0) return null;
                    const isActive = activeWordIndex === wi;
                    const wc = WORD_COLORS[wi % WORD_COLORS.length];
                    const wordColorStyle = {
                      "--word-color": wc.border,
                      "--word-color-bg": wc.bg,
                    };
                    // Group bar + word as a single flex item so they stay
                    // together on the same line when the row wraps.
                    return (
                      <div
                        key={`group-${wi}`}
                        className="autoq-word-group"
                        style={wordColorStyle}
                      >
                        <button
                          type="button"
                          className={`autoq-word-divider${isActive ? " autoq-word-divider-active" : ""}`}
                          onClick={() => { setActiveWordIndex(wi); inputRef.current?.focus(); }}
                          aria-label={`Select word ${wi + 1} · click cards will add here`}
                          title={`Select word ${wi + 1}`}
                        />
                        <div
                          data-word-index={wi}
                          className={`autoq-staged-word${isActive ? " autoq-staged-word-active" : ""}${
                            drag?.zone === "staged" &&
                            drag?.hoveredWordIndex === wi &&
                            drag?.beforeCardIndex == null &&
                            drag?.afterCardIndex == null
                              ? " autoq-staged-word-drop-target"
                              : ""
                          }`}
                          onClick={(e) => {
                            // Clicks that hit a card inside the word are
                            // handled by the card's pointer handlers; only
                            // the bare wrapper should activate the word.
                            if (e.target.closest?.("[data-card-index]")) return;
                            setActiveWordIndex(wi);
                            inputRef.current?.focus();
                          }}
                          title={`Select word ${wi + 1}`}
                        >
                          {word.map(renderCard)}
                        </div>
                      </div>
                    );
                  })}
                  {canAddWord && (
                    <div className="autoq-word-group">
                      <span
                        className="autoq-word-divider autoq-word-divider-neutral"
                        aria-hidden="true"
                      />
                      <button
                        ref={newWordBarRef}
                        type="button"
                        className={`autoq-new-word-bar${drag?.zone === "new-word" ? " autoq-new-word-bar-over" : ""}`}
                        onClick={handleAddWord}
                        title="Start a new word (or drag a card here)"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>

                <div
                  ref={discardRowRef}
                  className={`autoq-discard-row${overClass("discard")}`}
                  data-tour="discards"
                >
                  <span className="autoq-zone-label">Discard</span>
                  {discardedList.map(renderCard)}
                </div>
              </div>

              <div
                ref={handRowRef}
                className={`autoq-hand-row${overClass("hand")}`}
                data-tour="cards"
              >
                {neutralIndices.length === 0 ? (
                  <span className="autoq-zone-empty">Hand is empty — every card is either staged or discarded</span>
                ) : (
                  neutralIndices.map(renderCard)
                )}
              </div>

              {renderFloatingClone()}
            </>
          );
        })()}

        <form onSubmit={handleSubmit} className="autoq-input-row">
          <input
            ref={inputRef}
            type="text"
            value={wordsInput}
            onChange={handleInputChange}
            placeholder="Enter words (e.g. cat dog)"
            className={`autoq-input${isInputInvalid ? " autoq-input-invalid" : ""}`}
            autoComplete="off"
            spellCheck={false}
            data-tour="word-input"
          />
          <button type="submit" className="autoq-btn autoq-btn-primary" disabled={submitting} data-tour="submit">{submitting ? "Checking..." : "Submit"}</button>
          <button type="button" className="autoq-btn" onClick={handleMulligan} disabled={!canMulligan} title="Redraw cards (lose 1 card slot)" data-tour="mulligan">Mulligan</button>
          <button type="button" className="autoq-btn autoq-btn-danger" onClick={handleQuit}>Quit</button>
        </form>

        {error && <p className="autoq-error">{error}</p>}
        <p className="autoq-hint">Click a card to stage it, click again to un-stage. Drag between rows to discard or reorder. Space in the text field starts a new word. Blank submit = 0 points.</p>
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
          <StandingsTable
            game={game}
            isComplete={game.status === "complete"}
            onHandClick={(h) => setPopupHand({ hand: h, auto: false })}
          />
          {popupHand != null && (
            <HandResultPopup
              key={`popup-${popupHand.hand}-${popupHand.auto ? "auto" : "manual"}`}
              handNumber={popupHand.hand}
              autoClose={popupHand.auto}
              result={game.handResults.find((r) => r.hand === popupHand.hand)}
              onClose={() => setPopupHand(null)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// ── Sub-components ──────────────────────────────────────

// Per-hand standings grid. Each row is a player; each cell is that player's
// effective hand score with stars appended inline. Clicking any cell (or the
// hand-number column header) opens that hand's result popup.
function StandingsTable({ game, isComplete, onHandClick }) {
  const medals = ["🥇", "🥈", "🥉"];
  const playedHands = new Set(game.handResults.map((r) => r.hand));

  const playerByHand = {};
  for (const r of game.handResults) {
    playerByHand[r.hand] = { eff: r.raw_score + r.stars * 10, stars: r.stars };
  }
  const rows = [{
    name: "You",
    isPlayer: true,
    byHand: playerByHand,
    total: game.playerTotal.raw + game.playerTotal.stars * 10,
  }];
  game.botNames.forEach((botName, bi) => {
    const byHand = {};
    for (const r of game.handResults) {
      const bs = r.botScores[bi];
      if (bs) byHand[r.hand] = { eff: bs.raw_score + bs.stars * 10, stars: bs.stars };
    }
    const bt = game.botTotals[bi];
    rows.push({
      name: botName,
      isPlayer: false,
      byHand,
      total: bt.raw + bt.stars * 10,
    });
  });
  rows.sort((a, b) => b.total - a.total);

  return (
    <div className="autoq-standings">
      <h3 className="autoq-standings-title">{isComplete ? "Final Standings" : "Standings"}</h3>
      <table className="autoq-table autoq-standings-grid">
        <thead>
          <tr>
            <th aria-hidden="true"></th>
            <th className="autoq-standings-name-col">Player</th>
            {HANDS.map((h) => (
              <th
                key={`h-${h}`}
                className={`autoq-standings-hand-col${playedHands.has(h) ? " is-clickable" : ""}`}
                onClick={() => playedHands.has(h) && onHandClick(h)}
                title={playedHands.has(h) ? `View hand ${h} details` : undefined}
              >
                {h}
              </th>
            ))}
            <th className="autoq-standings-total-col">Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={r.isPlayer ? "autoq-player-row" : ""}>
              <td className="autoq-rank">{medals[i] || `${i + 1}.`}</td>
              <td className={r.isPlayer ? "autoq-you" : ""}>{r.name}</td>
              {HANDS.map((h) => {
                const cell = r.byHand[h];
                const clickable = playedHands.has(h);
                return (
                  <td
                    key={`${r.name}-${h}`}
                    className={`autoq-standings-hand-cell${clickable ? " is-clickable" : ""}`}
                    onClick={() => clickable && onHandClick(h)}
                  >
                    {cell ? (
                      <>
                        {cell.eff}
                        {cell.stars > 0 && (
                          <span className="autoq-cell-star" aria-label={`${cell.stars} star${cell.stars > 1 ? "s" : ""}`}>
                            {"★".repeat(cell.stars)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="autoq-cell-empty">·</span>
                    )}
                  </td>
                );
              })}
              <td className="autoq-final">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Slides down from the top of the standings column when a hand completes or
// the player clicks a hand column. Dismissed via the close button.
function HandResultPopup({ handNumber, result, onClose, autoClose }) {
  // Auto-close after 8s, but only when the popup opened on its own after a
  // hand completed. Manual opens (clicking the scoreboard) stay put until
  // the player dismisses them. Ref-held onClose so a new inline arrow from
  // the parent on each render doesn't reset the timer.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!autoClose) return undefined;
    const t = setTimeout(() => onCloseRef.current(), 8000);
    return () => clearTimeout(t);
  }, [autoClose]);

  const rows = result
    ? [
        { name: "You", raw: result.raw_score, stars: result.stars, words: result.words, isPlayer: true },
        ...result.botScores.map((bs) => ({ name: bs.name, raw: bs.raw_score, stars: bs.stars, words: bs.words, isPlayer: false })),
      ]
    : [];
  return (
    <div className="autoq-hand-popup" role="dialog" aria-label={`Hand ${handNumber} results`}>
      {autoClose && <div className="autoq-hand-popup-progress" aria-hidden="true" />}
      <button
        type="button"
        className="autoq-hand-popup-close"
        onClick={onClose}
        aria-label="Close"
      >
        {"×"}
      </button>
      <h3 className="autoq-hand-popup-title">Hand {handNumber}</h3>
      {!result ? (
        <p className="autoq-hand-popup-empty">No results recorded for this hand yet.</p>
      ) : (
        <>
          <table className="autoq-table autoq-result-table">
            <thead>
              <tr><th>Player</th><th>Words</th><th className="autoq-final">Score</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.name} className={s.isPlayer ? "autoq-player-row" : ""}>
                  <td className={s.isPlayer ? "autoq-you" : ""}>{s.name}</td>
                  <td className="autoq-words-cell">{s.words || "—"}</td>
                  <td className="autoq-final">
                    {s.raw + s.stars * 10}
                    {s.stars > 0 && (
                      <span className="autoq-cell-star">{"★".repeat(s.stars)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
