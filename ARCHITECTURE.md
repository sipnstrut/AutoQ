# AutoQ — Standalone Game Architecture

## What Is This

A solo word game based on Quiddler. The player forms words from dealt cards (letters with point values) across 8 hands numbered 3 through 10. Each hand N deals `N+3` cards but caps playable cards at `N` — the player must always discard at least 3 cards. Bot opponents play historical hands from real games.

## Files

| File | Purpose | Dependencies |
|------|---------|-------------|
| `autoq-engine.js` | Pure game logic — deck, dealing, scoring, bots, stars | None (zero imports) |
| `AutoQ.jsx` | React UI component | React 18+, autoq-engine.js, bot-scores.json |
| `autoq.css` | Self-contained styles with CSS custom properties | Google Fonts (Anybody, DM Sans) |
| `bot-scores.json` | 304 historical hand submissions for bot play selection | None (static data) |

## Game Engine (`autoq-engine.js`)

Pure JavaScript, no framework dependency. Can be used with React, Vue, vanilla JS, or anything else.

### Exports

| Function | Signature | Purpose |
|----------|-----------|---------|
| `createGame` | `(opponentCount, historicalScores) => game` | Create a new game. Deals all 8 hands, picks bot names, pre-computes bot plays. |
| `submitHand` | `(game, wordsInput) => { game, error }` | Validate and score a word submission. Auto-picks highest-scoring card breakdown. Returns updated game or error string. |
| `takeMulligan` | `(game) => game` | Redraw cards for current hand (lose 1 card slot per mulligan). |
| `getStandings` | `(game) => [{ name, raw, stars, eff, isPlayer }]` | Sorted standings (descending by effective score). |
| `getUsedCardIndices` | `(input, handSize, dealtCards) => Set<number>` | Which dealt card indices are consumed by the current input. For real-time card graying. |
| `filterOptionsAgainstDealt` | `(input, handSize, dealtCards) => { options, invalid }` | All valid scoring options for an input against a specific dealt hand. |
| `calculateStars` | `(playerScore, botPlays, botNames) => { playerStars, botStars, summary }` | Star calculation (longest word + most words, 3+ players, no ties). |
| `CARD_VALUES` | Object | Card point values: A=2, B=8, ..., QU=9, TH=9, CL=10, etc. |
| `HANDS` | `[3,4,5,6,7,8,9,10]` | The 8 hand numbers in a game. |

### Game State Object

```javascript
{
  status: "playing" | "complete",
  opponentCount: 3,
  botNames: ["Underpants", "Gigglelack", "Krinkle"],
  dealtHands: { 3: ["A","E","T","QU","R","I"], 4: [...], ... },  // per hand
  botPlays: { 3: [{ words, raw_score, word_count, ... }, ...], ... },
  currentHand: 5,               // null when complete
  mulligans: { 3: 0, 5: 1 },   // mulligan count per hand
  handResults: [{ hand, words, raw_score, stars, botScores, starSummary }, ...],
  playerTotal: { raw: 180, stars: 3 },
  botTotals: [{ raw: 160, stars: 2 }, ...],
}
```

### Scoring Rules

- Each card has a point value (A=2, Z=14, QU=9, etc.)
- Words are formed from dealt cards; total score = sum of card values used
- Digraphs (QU, TH, CL, IN, ER) are single cards worth their own value
  - QU=9 vs Q+U=19 — different scores, engine auto-picks highest
  - IN=7 vs I+N=7 — same score, engine auto-picks to fit hand size
- Stars: With 3+ total players, one star for sole longest word (by letter count), one for sole most words. Each star = +10 bonus points.
- Effective score = raw + (stars * 10)

### Card Deck

118 cards total. Frequencies match the physical Quiddler deck:
- Common: A(10), E(12), I(8), O(8), etc.
- Rare: J(2), Q(2), X(2), Z(2)
- Digraphs: QU(2), IN(2), ER(2), TH(2), CL(2)

Deck is shuffled fresh for each hand (not across hands).

### Bot Behavior

Bots select from `bot-scores.json` — real submissions from actual Quiddler games. For each hand:
1. Filter historical scores to matching hand number
2. Shuffle randomly
3. For each bot, find the first historical play whose cards are still available in the remaining deck
4. Each bot's pick depletes the shared card pool
5. Synthetic zero-score entries are injected proportionally to prevent the pool from skewing high

## React Component (`AutoQ.jsx`)

### Props

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `scores` | `Array` | `bot-scores.json` | Historical scores for bot play selection. Omit to use bundled data. |
| `validateWords` | `async (words) => { valid, invalid }` | `undefined` (skip) | Optional dictionary validation function. If provided, called before each submit. |

### Usage

```jsx
import AutoQ from "./AutoQ";
import "./autoq.css";

// Minimal — bundled bot data, no dictionary validation
<AutoQ />

// With dictionary validation
const validate = async (words) => {
  const res = await fetch(`/api/validate?words=${encodeURIComponent(words)}`);
  return res.json();  // { valid: [...], invalid: [{ word: "xyzzy" }] }
};
<AutoQ validateWords={validate} />
```

### UI Layout

Two-column grid (1/3 + 2/3), collapses to single column under 900px.

- **Left column**: Game controls — start panel, dealt cards (gray out as you type), word input, hand results with star summary
- **Right column**: Persistent standings table + expandable hand-by-hand history

### Game Flow

1. **Idle**: Opponent count selector + Start button
2. **Playing**: For each of 8 hands:
   - See dealt cards, type words, submit
   - Cards gray out in real-time to show which are consumed
   - After submit: see hand results (your score vs bots, stars)
   - Click "Next Hand" to continue
3. **Complete**: Final standings with medals, hand history, Play Again

## Styles (`autoq.css`)

Self-contained — no external CSS dependencies (fonts are loaded via Google Fonts import).

All colors use CSS custom properties prefixed `--aq-*` scoped to `.autoq-section`. Override them for theming:

```css
.autoq-section {
  --aq-bg-base: #ffffff;
  --aq-text: #1a1d27;
  --aq-accent: #2563eb;
  /* etc. */
}
```

Add class `autoq-light` to `.autoq-section` for the built-in light mode preset.

### Fonts

- **Anybody** (headings, card letters, input): Bold display font
- **DM Sans** (body text, labels): Clean sans-serif

Both loaded from Google Fonts. Replace by overriding `font-family` on `.autoq-section` and `.autoq-card-letter`.

## Integration Notes

### React App (Next.js, CRA, Vite)

1. Copy all 4 files into your project
2. Import component and CSS
3. Render `<AutoQ />` wherever you want it
4. JSON import works out of the box with all modern bundlers

### Non-React (vanilla JS, WordPress)

The game engine (`autoq-engine.js`) is pure JS. You'd need to:
1. Build your own UI layer (plain HTML/JS, Vue, Svelte, etc.) using the engine functions
2. The engine exports are the complete API — `createGame`, `submitHand`, `takeMulligan`, `getStandings`

### Dictionary Validation (Optional)

To validate words, provide an async function that accepts a space-separated word string and returns `{ valid: [...], invalid: [{ word }] }`. The component calls it before each submit and blocks on invalid words.

Options:
- **Merriam-Webster API** (free tier, 1,000 queries/day): Register at dictionaryapi.com, build a small server endpoint
- **Static word list**: Bundle a dictionary file, check client-side
- **Skip it**: Omit the `validateWords` prop — all words are accepted

### Updating Bot Data

To refresh `bot-scores.json` with newer game data, export from the QBIM scores API (CORS-open, read-only, no auth required):

```bash
curl -s "https://jqoyoafk29.execute-api.us-east-1.amazonaws.com/prod/stats/scores" | node -e "
  const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const pool = s.filter(x => x.words && x.breakdown && x.hand);
  const slim = pool.map(x => ({
    hand: x.hand, words: x.words, raw_score: x.raw_score,
    word_count: x.word_count || 1, longest_word_letters: x.longest_word_letters || 0,
    breakdown: x.breakdown
  }));
  process.stdout.write(JSON.stringify(slim));
" > bot-scores.json
```

Or just add entries manually — the format per entry is:
```json
{ "hand": 5, "words": "quick fox", "raw_score": 42, "word_count": 2, "longest_word_letters": 5, "breakdown": "QU-I-C-K  F-O-X" }
```

## Cost

Zero. Everything runs client-side in the browser. No server, no database, no API keys required for the base game. Dictionary validation is the only optional server dependency.
