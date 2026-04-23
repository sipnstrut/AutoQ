/**
 * AutoQ game engine — client-side Quiddler solo game logic.
 *
 * Ported from qbim-bot's autoq-deck.mjs, autoq-bots.mjs, cards.mjs, and autoq.mjs.
 * Runs entirely in the browser using historical scores already loaded by the dashboard.
 */

// ── Card Data ──────────────────────────────────────────

export const CARD_VALUES = {
  A: 2, B: 8, C: 8, D: 5, E: 2, F: 6, G: 6, H: 7,
  I: 2, J: 13, K: 8, L: 3, M: 5, N: 5, O: 2, P: 6,
  Q: 15, R: 5, S: 3, T: 3, U: 4, V: 11, W: 10, X: 12,
  Y: 4, Z: 14,
  ER: 7, CL: 10, IN: 7, TH: 9, QU: 9,
};

const DIGRAPHS = ["QU", "IN", "ER", "TH", "CL"];

// Normalize user-typed input: any run of non-letter characters collapses to a
// single space, then trim. Digits, punctuation, and symbols are stripped;
// words are always space-separated afterwards.
function cleanInput(input) {
  return (input || "").replace(/[^a-zA-Z]+/g, " ").trim();
}

// Word-game rule: every submitted word must consume at least this many cards.
// Digraph cards (QU, TH, CL, IN, ER) count as one card each, so "qu" alone is
// rejected even though it fits in two card slots when split as Q+U.
const MIN_CARDS_PER_WORD = 2;

const CARD_FREQUENCIES = {
  A: 10, B: 2, C: 2, D: 4, E: 12, F: 2, G: 4, H: 2, I: 8, J: 2,
  K: 2, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 2, R: 6, S: 4, T: 6,
  U: 6, V: 2, W: 2, X: 2, Y: 4, Z: 2, QU: 2, IN: 2, ER: 2, CL: 2, TH: 2,
};

const QUIDDLER_DECK = [];
for (const [card, count] of Object.entries(CARD_FREQUENCIES)) {
  for (let i = 0; i < count; i++) QUIDDLER_DECK.push(card);
}

export const HANDS = [3, 4, 5, 6, 7, 8, 9, 10];

const BOT_NAMES = [
  "Underpants", "Unterdaria", "Gigglelack", "Lololol", "Bumblebee",
  "Bindlemeg", "Gapplesap", "Gravelsap", "Fffffffff", "Flippinbird",
  "Anglebottom", "Boarsend", "Krinkle", "Latesun", "Glitterfall",
  "Highmount", "Indigum", "Jamshire", "Craw", "Dent", "Egg", "Flappingcap",
];

// ── Deck / Dealing ─────────────────────────────────────

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealForHand(playerCount, handSize) {
  const deck = shuffleDeck([...QUIDDLER_DECK]);
  const hands = [];
  for (let p = 0; p < playerCount; p++) hands.push(deck.splice(0, handSize));
  return hands;
}

// ── Word Parsing / Scoring ─────────────────────────────

function allBreakdowns(upper) {
  const clean = upper.replace(/[^A-Z]/g, "");
  if (!clean) return [];
  const results = [];
  function dfs(pos, cards) {
    if (pos === clean.length) { results.push([...cards]); return; }
    if (pos + 1 < clean.length) {
      const pair = clean.slice(pos, pos + 2);
      if (DIGRAPHS.includes(pair)) { cards.push(pair); dfs(pos + 2, cards); cards.pop(); }
    }
    const ch = clean[pos];
    if (CARD_VALUES[ch] !== undefined) { cards.push(ch); dfs(pos + 1, cards); cards.pop(); }
  }
  dfs(0, []);
  return results;
}

function scoreCards(cards) {
  return cards.reduce((sum, c) => sum + (CARD_VALUES[c] || 0), 0);
}

function cartesian(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

function validateCardsAgainstDealt(usedCards, dealtCards, excludedIndices) {
  const available = new Map();
  for (let i = 0; i < dealtCards.length; i++) {
    if (excludedIndices && excludedIndices.has(i)) continue;
    const c = dealtCards[i];
    available.set(c, (available.get(c) || 0) + 1);
  }
  for (const c of usedCards) {
    const count = available.get(c) || 0;
    if (count <= 0) return false;
    available.set(c, count - 1);
  }
  return true;
}

/**
 * Parse words input and return scoring options filtered against the dealt hand.
 * `excludedIndices` (optional Set) blocks specific dealt-card slots from being
 * matched — used for cards the player has marked as discards.
 */
export function filterOptionsAgainstDealt(input, handSize, dealtCards, excludedIndices) {
  const cleaned = cleanInput(input);
  if (!cleaned) return { options: [], invalid: [], tooShort: [] };
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return { options: [], invalid: [], tooShort: [] };

  const allInvalid = [];
  const allTooShort = [];
  const perWord = wordTokens.map((token) => {
    const upper = token.toUpperCase().trim();
    if (!upper) return [{ cards: [], raw: token }];
    if (upper.includes("-")) {
      const cards = []; const invalid = [];
      for (const t of upper.split("-")) {
        if (!t) continue;
        if (CARD_VALUES[t] !== undefined) cards.push(t); else invalid.push(t);
      }
      allInvalid.push(...invalid);
      return [{ cards, raw: token }];
    }
    const rawBreakdowns = allBreakdowns(upper);
    if (rawBreakdowns.length === 0) { allInvalid.push(token); return [{ cards: [], raw: token }]; }
    const breakdowns = rawBreakdowns.filter((cards) => cards.length >= MIN_CARDS_PER_WORD);
    if (breakdowns.length === 0) { allTooShort.push(token); return [{ cards: [], raw: token }]; }
    return breakdowns.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) return { options: [], invalid: allInvalid, tooShort: allTooShort };
  if (allTooShort.length) return { options: [], invalid: [], tooShort: allTooShort };

  const combos = cartesian(perWord);
  const rawOptions = [];
  for (const combo of combos) {
    const allCards = combo.flatMap((w) => w.cards);
    if (allCards.length > handSize) continue;
    if (!validateCardsAgainstDealt(allCards, dealtCards, excludedIndices)) continue;
    const totalScore = scoreCards(allCards);
    const breakdown = combo.map((w) => w.cards.join("-")).join("  ");
    rawOptions.push({ score: totalScore, cards: allCards.length, breakdown });
  }

  const byScore = new Map();
  for (const opt of rawOptions) {
    const existing = byScore.get(opt.score);
    if (!existing) { byScore.set(opt.score, opt); }
    else {
      if (Math.abs(handSize - opt.cards) < Math.abs(handSize - existing.cards))
        byScore.set(opt.score, opt);
    }
  }

  const options = [...byScore.values()].sort((a, b) => b.score - a.score);
  return { options, invalid: [], tooShort: [] };
}

/**
 * Match typed input to specific dealt-card indices, preserving the order the
 * letters appear in the input. Returns:
 *   - []    — input was empty / whitespace only
 *   - array — ordered dealt-card indices consumed by the input (best-scoring
 *             combo wins when multiple breakdowns are possible)
 *   - null  — the input contains letters that can't be matched against the
 *             available (non-discarded) dealt cards
 *
 * `excludedIndices` (optional Set) blocks discarded slots from being matched.
 */
export function matchInputIndices(input, handSize, dealtCards, excludedIndices) {
  const cleaned = cleanInput(input);
  if (!cleaned) return [];
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return [];

  const perWord = wordTokens.map((token) => {
    const upper = token.toUpperCase().trim();
    if (!upper) return [[]];
    if (upper.includes("-")) {
      const cards = [];
      for (const t of upper.split("-")) {
        if (t && CARD_VALUES[t] !== undefined) cards.push(t);
      }
      return [cards];
    }
    const bk = allBreakdowns(upper).filter((cards) => cards.length >= MIN_CARDS_PER_WORD);
    return bk.length > 0 ? bk : [[]];
  });

  const combos = cartesian(perWord);
  let bestOrdered = null;
  let bestScore = -1;
  for (const combo of combos) {
    const allCards = combo.flat();
    if (allCards.length > handSize) continue;

    const usedSet = new Set();
    const ordered = [];
    let valid = true;
    for (const needed of allCards) {
      const pos = dealtCards.findIndex((c, i) =>
        c === needed && !usedSet.has(i) && !(excludedIndices && excludedIndices.has(i))
      );
      if (pos === -1) { valid = false; break; }
      usedSet.add(pos);
      ordered.push(pos);
    }
    if (valid) {
      const score = allCards.reduce((sum, c) => sum + (CARD_VALUES[c] || 0), 0);
      if (score > bestScore) { bestScore = score; bestOrdered = ordered; }
    }
  }
  return bestOrdered; // null = no valid match
}

/**
 * Given typed input and dealt cards, return a Set of dealt-card indices that are "used".
 * Wrapper over `matchInputIndices` that preserves the older Set-returning shape.
 */
export function getUsedCardIndices(input, handSize, dealtCards, excludedIndices) {
  const result = matchInputIndices(input, handSize, dealtCards, excludedIndices);
  return new Set(result || []);
}

// Find dealt-card indices for a single in-progress word (any length ≥ 1, since
// the player may still be workshopping). Returns the highest-scoring breakdown
// that fits, or null if any letter can't be satisfied from the remaining cards.
function matchSingleWordGreedy(word, dealtCards, alreadyUsed, excludedIndices) {
  const upper = word.toUpperCase();
  const breakdowns = allBreakdowns(upper);
  if (breakdowns.length === 0) return null;
  let best = null;
  let bestScore = -1;
  for (const cards of breakdowns) {
    const localUsed = new Set();
    const indices = [];
    let valid = true;
    for (const c of cards) {
      const pos = dealtCards.findIndex((dc, i) =>
        dc === c &&
        !alreadyUsed.has(i) &&
        !localUsed.has(i) &&
        !(excludedIndices && excludedIndices.has(i))
      );
      if (pos === -1) { valid = false; break; }
      localUsed.add(pos);
      indices.push(pos);
    }
    if (valid) {
      const score = indices.reduce((s, i) => s + (CARD_VALUES[dealtCards[i]] || 0), 0);
      if (score > bestScore) { bestScore = score; best = indices; }
    }
  }
  return best;
}

/**
 * Parse staging input into per-word groups of dealt-card indices.
 *
 * Unlike `matchInputIndices`, this is permissive: single-character words like
 * `"d"` are fine (the player is still building word 2), and trailing spaces
 * produce an empty trailing group as a placeholder for the next word.
 *
 * Returns:
 *   - []          — empty input
 *   - [[i,…], …]  — one group per space-separated word token, in order
 *   - null        — some letter can't be matched against available cards, or
 *                   total card count exceeds `handSize`
 */
export function matchStagedWordGroups(input, handSize, dealtCards, excludedIndices) {
  const sanitized = (input || "").replace(/[^a-zA-Z ]/g, "").replace(/ {2,}/g, " ").replace(/^ +/, "");
  if (!sanitized) return [];
  const tokens = sanitized.split(" ");

  const used = new Set();
  const groups = [];
  for (const token of tokens) {
    if (!token) { groups.push([]); continue; }
    const matched = matchSingleWordGreedy(token, dealtCards, used, excludedIndices);
    if (matched === null) return null;
    for (const i of matched) used.add(i);
    groups.push(matched);
  }
  let total = 0;
  for (const g of groups) total += g.length;
  if (total > handSize) return null;
  return groups;
}

/**
 * Score a words input without dealt-card filtering (for card-count check).
 */
export function getScoreOptions(input, handSize) {
  const cleaned = cleanInput(input);
  if (!cleaned) return { options: [], invalid: [], tooShort: [] };
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return { options: [], invalid: [], tooShort: [] };

  const allInvalid = [];
  const allTooShort = [];
  const perWord = wordTokens.map((token) => {
    const upper = token.toUpperCase().trim();
    if (!upper) return [{ cards: [], raw: token }];
    if (upper.includes("-")) {
      const cards = []; const invalid = [];
      for (const t of upper.split("-")) {
        if (!t) continue;
        if (CARD_VALUES[t] !== undefined) cards.push(t); else invalid.push(t);
      }
      allInvalid.push(...invalid);
      return [{ cards, raw: token }];
    }
    const rawBreakdowns = allBreakdowns(upper);
    if (rawBreakdowns.length === 0) { allInvalid.push(token); return [{ cards: [], raw: token }]; }
    const breakdowns = rawBreakdowns.filter((cards) => cards.length >= MIN_CARDS_PER_WORD);
    if (breakdowns.length === 0) { allTooShort.push(token); return [{ cards: [], raw: token }]; }
    return breakdowns.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) return { options: [], invalid: allInvalid, tooShort: allTooShort };
  if (allTooShort.length) return { options: [], invalid: [], tooShort: allTooShort };
  const combos = cartesian(perWord);
  const rawOptions = [];
  for (const combo of combos) {
    const allCards = combo.flatMap((w) => w.cards);
    if (allCards.length > handSize) continue;
    rawOptions.push({ score: scoreCards(allCards), cards: allCards.length, breakdown: combo.map((w) => w.cards.join("-")).join("  ") });
  }
  const byScore = new Map();
  for (const opt of rawOptions) {
    const existing = byScore.get(opt.score);
    if (!existing) byScore.set(opt.score, opt);
    else if (Math.abs(handSize - opt.cards) < Math.abs(handSize - existing.cards)) byScore.set(opt.score, opt);
  }
  return { options: [...byScore.values()].sort((a, b) => b.score - a.score), invalid: [], tooShort: [] };
}

// ── Bot Logic ──────────────────────────────────────────

function buildPool(cards) {
  const pool = new Map();
  for (const c of cards) pool.set(c, (pool.get(c) || 0) + 1);
  return pool;
}

function tryConsume(usedCards, pool) {
  const needed = new Map();
  for (const c of usedCards) needed.set(c, (needed.get(c) || 0) + 1);
  for (const [c, n] of needed) { if ((pool.get(c) || 0) < n) return false; }
  for (const [c, n] of needed) pool.set(c, pool.get(c) - n);
  return true;
}

function selectBotPlays(botCount, hand, remainingPool, allScores) {
  // seed_valid === false means the entry contains a word rejected by the new
  // dictionary rules (slang, proper noun, etc.) — exclude from seeding.
  // null/undefined (unannotated) and true both remain eligible.
  const handScores = allScores.filter((s) => s.hand === hand && s.seed_valid !== false);
  const shuffled = handScores.sort(() => Math.random() - 0.5);
  const plays = [];
  const usedWords = new Set();

  for (let b = 0; b < botCount; b++) {
    let found = false;
    for (const s of shuffled) {
      const wordsKey = (s.words || "").toLowerCase();

      // Zero-score entry — bot plays nothing (no cards consumed)
      if (!wordsKey && (s.raw_score || 0) === 0) {
        plays.push({ words: "", raw_score: 0, word_count: 0, longest_word_letters: 0, breakdown: "" });
        found = true;
        break;
      }

      if (!wordsKey || usedWords.has(wordsKey)) continue;
      const usedCards = (s.breakdown || "").split(/\s+/).flatMap((word) =>
        word.split("-").filter(Boolean).map((c) => c.toUpperCase())
      );
      if (usedCards.length === 0) continue;
      if (tryConsume(usedCards, remainingPool)) {
        plays.push({
          words: wordsKey,
          raw_score: s.raw_score || 0,
          word_count: s.word_count || 1,
          longest_word_letters: s.longest_word_letters || 0,
          breakdown: s.breakdown || "",
        });
        usedWords.add(wordsKey);
        found = true;
        break;
      }
    }
    if (!found) {
      plays.push({ words: "", raw_score: 0, word_count: 0, longest_word_letters: 0, breakdown: "" });
    }
  }
  return plays;
}

// ── Star Calculation ───────────────────────────────────

export function calculateStars(playerScore, botPlays, botNames) {
  const totalPlayers = 1 + botPlays.length;
  const skipStars = totalPlayers < 3;

  const allScores = [
    { id: "player", longest_word_letters: playerScore.longest_word_letters, word_count: playerScore.word_count },
    ...botPlays.map((bp, i) => ({ id: `bot-${i}`, longest_word_letters: bp.longest_word_letters || 0, word_count: bp.word_count || 0 })),
  ];

  let maxLetters = 0;
  for (const s of allScores) if (s.longest_word_letters > maxLetters) maxLetters = s.longest_word_letters;
  const longestWinners = maxLetters > 0 ? allScores.filter((s) => s.longest_word_letters === maxLetters) : [];

  let maxWords = 0;
  for (const s of allScores) if (s.word_count > maxWords) maxWords = s.word_count;
  const mostWordsWinners = maxWords > 0 ? allScores.filter((s) => s.word_count === maxWords) : [];

  const longestWinner = !skipStars && longestWinners.length === 1 ? longestWinners[0].id : null;
  const mostWordsWinner = !skipStars && mostWordsWinners.length === 1 ? mostWordsWinners[0].id : null;

  const playerStars = (longestWinner === "player" ? 1 : 0) + (mostWordsWinner === "player" ? 1 : 0);
  const botStars = botPlays.map((_, i) => {
    const id = `bot-${i}`;
    return (longestWinner === id ? 1 : 0) + (mostWordsWinner === id ? 1 : 0);
  });

  const parts = [];
  if (longestWinner) {
    const name = longestWinner === "player" ? "You" : (botNames[Number(longestWinner.split("-")[1])] || longestWinner);
    parts.push(`Longest word: ${name} (${maxLetters} letters)`);
  }
  if (mostWordsWinner) {
    const name = mostWordsWinner === "player" ? "You" : (botNames[Number(mostWordsWinner.split("-")[1])] || mostWordsWinner);
    parts.push(`Most words: ${name} (${maxWords})`);
  }
  const summary = parts.length > 0 ? parts.join("  |  ") : (skipStars ? "No stars (fewer than 3 players)" : "No stars — tied!");

  return { playerStars, botStars, summary };
}

// ── Game Creation ──────────────────────────────────────

/**
 * Create a new AutoQ game. Deals all hands and pre-computes bot plays.
 * @param {number} opponentCount — 0-7 bots
 * @param {Array} historicalScores — all scores from the dashboard (with words + breakdown)
 */
export function createGame(opponentCount, historicalScores) {
  const shuffledNames = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const botNames = shuffledNames.slice(0, opponentCount);

  // Filter to scores that have words and breakdowns (for bot play selection).
  // Historical data sometimes uses "+" as a word separator in `words` and "++"
  // in `breakdown`. Normalize both to the canonical forms (space / double space)
  // so they never surface in the UI and the breakdown parser works right.
  const withWords = historicalScores
    .filter((s) => s.words && s.breakdown)
    .map((s) => ({
      ...s,
      words: String(s.words).replace(/\+/g, " ").replace(/\s+/g, " ").trim(),
      breakdown: String(s.breakdown).replace(/\++/g, "  ").replace(/ {3,}/g, "  ").trim(),
    }));

  // The pool skews high because zero-score hands have no words recorded.
  // Inject synthetic zero-score entries per hand to match the real zero rate.
  const usableScores = [...withWords];
  for (const h of HANDS) {
    const allForHand = historicalScores.filter((s) => s.hand === h);
    const zeroCount = allForHand.filter((s) => (s.raw_score || 0) === 0).length;
    if (zeroCount > 0 && allForHand.length > 0) {
      // Scale zeros relative to the pool size for this hand
      const poolForHand = withWords.filter((s) => s.hand === h).length;
      const syntheticCount = Math.max(1, Math.round(zeroCount / allForHand.length * (poolForHand + zeroCount)));
      for (let i = 0; i < syntheticCount; i++) {
        usableScores.push({ hand: h, words: "", breakdown: "", raw_score: 0, word_count: 0, longest_word_letters: 0 });
      }
    }
  }

  const dealtHands = {};
  const botPlays = {};

  for (const hand of HANDS) {
    const dealt = dealForHand(1, hand + 3);
    dealtHands[hand] = dealt[0]; // human's cards

    if (opponentCount > 0) {
      const remainingPool = buildPool(QUIDDLER_DECK);
      for (const c of dealt[0]) remainingPool.set(c, (remainingPool.get(c) || 0) - 1);
      botPlays[hand] = selectBotPlays(opponentCount, hand, remainingPool, usableScores);
    } else {
      botPlays[hand] = [];
    }
  }

  return {
    status: "playing",
    opponentCount,
    botNames,
    dealtHands,
    botPlays,
    currentHand: HANDS[0],
    mulligans: {},
    mulliganDiscards: {},
    discards: {},
    handResults: [],
    playerTotal: { raw: 0, stars: 0 },
    botTotals: botNames.map(() => ({ raw: 0, stars: 0 })),
  };
}

// Build the redeal pool for a mulligan: the 118-card deck minus cards already
// out of circulation for the current hand — the player's current (about-to-be-
// discarded) hand, previous mulligan discards for this hand, and all cards
// the bots played for this hand.
function mulliganPool(game) {
  const pool = buildPool(QUIDDLER_DECK);
  const hand = game.currentHand;
  if (hand == null) return pool;
  const toRemove = [
    ...(game.dealtHands[hand] || []),
    ...(game.mulliganDiscards?.[hand] || []),
  ];
  for (const bp of (game.botPlays[hand] || [])) {
    const botCards = (bp.breakdown || "").split(/\s+/).flatMap((w) =>
      w.split("-").filter(Boolean).map((c) => c.toUpperCase())
    );
    toRemove.push(...botCards);
  }
  for (const c of toRemove) {
    const n = pool.get(c) || 0;
    if (n > 0) pool.set(c, n - 1);
  }
  return pool;
}

/**
 * Whether a mulligan is currently possible for the active hand.
 * Returns false if the game isn't playing, the max mulligan count for this
 * hand has been reached, or the remaining pool has fewer cards than the
 * next redeal would require.
 */
export function canMulligan(game) {
  if (!game || game.status !== "playing") return false;
  const hand = game.currentHand;
  if (hand == null) return false;
  const currentCount = game.mulligans[hand] || 0;
  // Each mulligan shaves one card off BOTH the deal and the max-play:
  //   dealt      = hand + 3 - mulligans
  //   maxPlay    = hand     - mulligans
  //   minDiscard = 3                       (invariant)
  // Floor maxPlay at 2 so shortest words remain possible.
  if (currentCount >= hand - 2) return false;

  const newHandSize = hand + 3 - (currentCount + 1);
  let available = 0;
  for (const count of mulliganPool(game).values()) available += count;
  return available >= newHandSize;
}

/**
 * Take a mulligan — redeal cards for the current hand (losing 1 card slot).
 * Refuses (returns the game unchanged) whenever `canMulligan(game)` is false.
 */
export function takeMulligan(game) {
  if (!canMulligan(game)) return game;

  const hand = game.currentHand;
  const newCount = (game.mulligans[hand] || 0) + 1;
  const newHandSize = hand + 3 - newCount;

  const available = [];
  for (const [card, count] of mulliganPool(game)) {
    for (let i = 0; i < count; i++) available.push(card);
  }
  shuffleDeck(available);
  const redealt = available.slice(0, newHandSize);

  return {
    ...game,
    mulligans: { ...game.mulligans, [hand]: newCount },
    dealtHands: { ...game.dealtHands, [hand]: redealt },
    mulliganDiscards: {
      ...(game.mulliganDiscards || {}),
      [hand]: [
        ...(game.mulliganDiscards?.[hand] || []),
        ...(game.dealtHands[hand] || []),
      ],
    },
    // Redeal invalidates any card indices the player had marked for this hand.
    discards: { ...(game.discards || {}), [hand]: [] },
  };
}

/**
 * Toggle the "discarded" state of a dealt-card slot for the current hand.
 * Red-marked cards are excluded from word-matching and will be recorded as
 * discards on submit.
 */
export function toggleDiscard(game, cardIndex) {
  if (!game || game.status !== "playing") return game;
  const hand = game.currentHand;
  if (hand == null) return game;
  const current = game.discards?.[hand] || [];
  const at = current.indexOf(cardIndex);
  const next = at === -1 ? [...current, cardIndex] : current.filter((i) => i !== cardIndex);
  return {
    ...game,
    discards: { ...(game.discards || {}), [hand]: next },
  };
}

/**
 * Submit a score for the current hand. Returns { game, error }.
 * Cards the player explicitly marked as discards (via toggleDiscard) are
 * excluded from word-matching, and any remaining non-played cards are
 * recorded as discards in the hand result as well.
 */
export function submitHand(game, wordsInput) {
  const hand = game.currentHand;
  const mulligans = game.mulligans[hand] || 0;
  // Hand number = max playable cards. Deal is hand + 3, so capping play at
  // `hand` guarantees the 3-discard minimum. Mulligans trim further.
  const maxCards = Math.max(2, hand - mulligans);
  const dealtCards = game.dealtHands[hand];
  const excludedIndices = new Set(game.discards?.[hand] || []);

  // Empty submission = 0 points
  if (!wordsInput.trim()) {
    return applyScore(game, hand, "", { score: 0, cards: 0, breakdown: "" }, excludedIndices);
  }

  const { options, invalid, tooShort } = filterOptionsAgainstDealt(wordsInput, maxCards, dealtCards, excludedIndices);

  if (invalid.length) return { game, error: `Invalid cards: ${invalid.join(", ")}` };
  if (tooShort.length) return { game, error: `Words must be at least 2 cards: ${tooShort.join(", ")}` };

  if (options.length === 0) {
    const unconstrained = getScoreOptions(wordsInput, maxCards);
    if (unconstrained.options.length === 0) return { game, error: `Too many cards — you can only play ${maxCards} cards this hand.` };
    return { game, error: "Those cards aren't in your dealt hand." };
  }

  // Auto-pick highest score
  return applyScore(game, hand, wordsInput, options[0], excludedIndices);
}

function applyScore(game, hand, wordsInput, chosen, excludedIndices) {
  const wordTokens = cleanInput(wordsInput).split(" ").filter(Boolean);
  const wordCount = wordTokens.length;
  let longestWordLetters = 0;
  for (const w of wordTokens) {
    const letters = w.replace(/[-]/g, "").length;
    if (letters > longestWordLetters) longestWordLetters = letters;
  }

  const playerScore = { raw_score: chosen.score, word_count: wordCount, longest_word_letters: longestWordLetters };
  const bots = game.botPlays[hand] || [];
  const starResult = calculateStars(playerScore, bots, game.botNames);

  const botScoresWithStars = bots.map((bp, i) => ({
    name: game.botNames[i],
    words: bp.words,
    raw_score: bp.raw_score,
    stars: starResult.botStars[i] || 0,
  }));

  // Every dealt card not in the played breakdown (including explicit red
  // discards) goes into the hand's discard record.
  const dealtCards = game.dealtHands[hand];
  const maxCards = Math.max(2, hand - (game.mulligans[hand] || 0));
  const usedIndices = getUsedCardIndices(wordsInput, maxCards, dealtCards, excludedIndices);
  const discards = dealtCards.filter((_, i) => !usedIndices.has(i));

  const handResult = {
    hand,
    words: wordsInput,
    raw_score: chosen.score,
    breakdown: chosen.breakdown,
    stars: starResult.playerStars,
    starSummary: starResult.summary,
    botScores: botScoresWithStars,
    discards,
  };

  const newPlayerTotal = {
    raw: game.playerTotal.raw + chosen.score,
    stars: game.playerTotal.stars + starResult.playerStars,
  };
  const newBotTotals = game.botTotals.map((bt, i) => ({
    raw: bt.raw + (bots[i]?.raw_score || 0),
    stars: bt.stars + (starResult.botStars[i] || 0),
  }));

  const handIdx = HANDS.indexOf(hand);
  const isLastHand = handIdx === HANDS.length - 1;

  return {
    game: {
      ...game,
      currentHand: isLastHand ? null : HANDS[handIdx + 1],
      status: isLastHand ? "complete" : "playing",
      handResults: [...game.handResults, handResult],
      playerTotal: newPlayerTotal,
      botTotals: newBotTotals,
    },
    error: null,
  };
}

/**
 * Build final standings sorted by effective score descending.
 */
export function getStandings(game) {
  const standings = [
    { name: "You", raw: game.playerTotal.raw, stars: game.playerTotal.stars, eff: game.playerTotal.raw + game.playerTotal.stars * 10, isPlayer: true },
    ...game.botNames.map((name, i) => {
      const bt = game.botTotals[i];
      return { name, raw: bt.raw, stars: bt.stars, eff: bt.raw + bt.stars * 10, isPlayer: false };
    }),
  ];
  return standings.sort((a, b) => b.eff - a.eff);
}
