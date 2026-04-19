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

function validateCardsAgainstDealt(usedCards, dealtCards) {
  const available = new Map();
  for (const c of dealtCards) available.set(c, (available.get(c) || 0) + 1);
  for (const c of usedCards) {
    const count = available.get(c) || 0;
    if (count <= 0) return false;
    available.set(c, count - 1);
  }
  return true;
}

/**
 * Parse words input and return scoring options filtered against the dealt hand.
 */
export function filterOptionsAgainstDealt(input, handSize, dealtCards) {
  const cleaned = (input || "").replace(/[\s,+]+/g, " ").trim();
  if (!cleaned) return { options: [], invalid: [] };
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return { options: [], invalid: [] };

  const allInvalid = [];
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
    const breakdowns = allBreakdowns(upper);
    if (breakdowns.length === 0) { allInvalid.push(token); return [{ cards: [], raw: token }]; }
    return breakdowns.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) return { options: [], invalid: allInvalid };

  const combos = cartesian(perWord);
  const rawOptions = [];
  for (const combo of combos) {
    const allCards = combo.flatMap((w) => w.cards);
    if (allCards.length > handSize) continue;
    if (!validateCardsAgainstDealt(allCards, dealtCards)) continue;
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
  return { options, invalid: [] };
}

/**
 * Given typed input and dealt cards, return a Set of dealt-card indices that are "used".
 * Used for graying out cards in real time as the player types.
 */
export function getUsedCardIndices(input, handSize, dealtCards) {
  const cleaned = (input || "").replace(/[\s,+]+/g, " ").trim();
  if (!cleaned) return new Set();
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return new Set();

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
    const bk = allBreakdowns(upper);
    return bk.length > 0 ? bk : [[]];
  });

  // Try each combination, keep the highest-scoring valid one (matches submit behavior)
  const combos = cartesian(perWord);
  let bestUsed = null;
  let bestScore = -1;
  for (const combo of combos) {
    const allCards = combo.flat();
    if (allCards.length > handSize) continue;

    const used = new Set();
    let valid = true;
    for (const needed of allCards) {
      const pos = dealtCards.findIndex((c, i) => c === needed && !used.has(i));
      if (pos === -1) { valid = false; break; }
      used.add(pos);
    }
    if (valid) {
      const score = allCards.reduce((sum, c) => sum + (CARD_VALUES[c] || 0), 0);
      if (score > bestScore) { bestScore = score; bestUsed = used; }
    }
  }
  return bestUsed || new Set();
}

/**
 * Score a words input without dealt-card filtering (for card-count check).
 */
export function getScoreOptions(input, handSize) {
  const cleaned = (input || "").replace(/[\s,+]+/g, " ").trim();
  if (!cleaned) return { options: [], invalid: [] };
  const wordTokens = cleaned.split(" ").filter(Boolean);
  if (!wordTokens.length) return { options: [], invalid: [] };

  const allInvalid = [];
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
    const breakdowns = allBreakdowns(upper);
    if (breakdowns.length === 0) { allInvalid.push(token); return [{ cards: [], raw: token }]; }
    return breakdowns.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) return { options: [], invalid: allInvalid };
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
  return { options: [...byScore.values()].sort((a, b) => b.score - a.score), invalid: [] };
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
  const handScores = allScores.filter((s) => s.hand === hand);
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

  // Filter to scores that have words and breakdowns (for bot play selection)
  const withWords = historicalScores.filter((s) => s.words && s.breakdown);

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
    handResults: [],
    playerTotal: { raw: 0, stars: 0 },
    botTotals: botNames.map(() => ({ raw: 0, stars: 0 })),
  };
}

/**
 * Take a mulligan — redeal cards for the current hand (losing 1 card slot).
 */
export function takeMulligan(game) {
  const hand = game.currentHand;
  const currentCount = game.mulligans[hand] || 0;
  if (currentCount >= hand - 2) return game; // can't reduce below 2 playable cards

  const newMulligans = { ...game.mulligans, [hand]: currentCount + 1 };
  const maxCards = hand + 3 - (currentCount + 1);
  const dealt = dealForHand(1, maxCards);

  return {
    ...game,
    mulligans: newMulligans,
    dealtHands: { ...game.dealtHands, [hand]: dealt[0] },
  };
}

/**
 * Submit a score for the current hand. Returns { game, error }.
 */
export function submitHand(game, wordsInput) {
  const hand = game.currentHand;
  const mulligans = game.mulligans[hand] || 0;
  const maxCards = Math.max(2, (hand + 3) - mulligans);
  const dealtCards = game.dealtHands[hand];

  // Empty submission = 0 points
  if (!wordsInput.trim()) {
    return applyScore(game, hand, "", { score: 0, cards: 0, breakdown: "" });
  }

  const { options, invalid } = filterOptionsAgainstDealt(wordsInput, maxCards, dealtCards);

  if (invalid.length) return { game, error: `Invalid cards: ${invalid.join(", ")}` };

  if (options.length === 0) {
    const unconstrained = getScoreOptions(wordsInput, maxCards);
    if (unconstrained.options.length === 0) return { game, error: `Too many cards — you can only play ${maxCards} cards this hand.` };
    return { game, error: "Those cards aren't in your dealt hand." };
  }

  // Auto-pick highest score
  return applyScore(game, hand, wordsInput, options[0]);
}

function applyScore(game, hand, wordsInput, chosen) {
  const wordTokens = wordsInput ? wordsInput.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean) : [];
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

  const handResult = {
    hand,
    words: wordsInput,
    raw_score: chosen.score,
    breakdown: chosen.breakdown,
    stars: starResult.playerStars,
    starSummary: starResult.summary,
    botScores: botScoresWithStars,
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
