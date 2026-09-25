import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Trophy, X } from 'lucide-react';
import { GUEST_HUMAN_RESERVED_STAKE, type AvatarId, type GameEvent, type GameMeta, type OpenChallenge, type Outcome, type SettlementSummary } from '@rapidclash/shared';
import type { GameView } from '../App.js';
import { api } from '../api.js';
import { formatClock } from '../format.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { ChatSheet } from '../components/hub-chrome/ChatSheet.js';
import { useChat } from '../components/hub-chrome/useChat.js';
import { hubShellClass } from '../components/hub-chrome/layout.js';
import { TILE_ART, titleCase } from '../components/hub-shared/tiles.js';
import { relatedGamesFor } from '../components/hub-shared/gameSort.js';
import { OriginalsIcon } from '../components/hub-shared/categoryIcons.js';
import { GamesCarousel, displayHostName } from '../components/hub-shared/GamesCarousel.js';
import { GuestBotWaiters } from '../guest/GuestBotWaiters.js';
import { BringARival } from '../components/hub-shared/BringARival.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { Avatar, avatarIdForName } from '../components/hub-shared/Avatar.js';
import { Credits, RcIcon } from '../components/hub-shared/RcIcon.js';
import { CurrencyIcon } from '../components/hub-chrome/CurrencyPicker.js';
import { useCurSel } from '../lib/currency.js';
import { useTheme } from '../lib/theme.js';
import { play, installUnlockOnFirstGesture } from '../lib/sound.js';
import { outlineClasses, outlineForOutcome, replaysOf, useDelayedFlag, useWinReveal, WIN_FILL_IN_MS, WIN_HOLD_MS, WIN_FADE_OUT_MS, type Verdict } from './hub-shared/slotReveal.js';

/** How long after the result phase starts before the own-bar verdict lights (ms). */
const BAR_VERDICT_BEAT_MS = 250;

/** Draw→rematch beat (#161): how long the orange "push — replaying" outline holds on BOTH bars
 *  after a tie before the fresh round shows and the pick timer restarts. Tunable; shared by every
 *  tie-replay game (the universal tie rule is game-agnostic). */
const DRAW_REMATCH_HOLD_MS = 2000;

/** Bet presets within the shared 1–100 demo range (every demo game's BetRules). Rendered with the
 *  RC-icon credits display, not a text currency symbol (issue #324). */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];

/** T5: the "VS" match-found label's font stack — the prototype's explicit override
 *  (`Full Spec.html:433`), not the app's default sans, matching the same idiom other migrated
 *  screens use for prototype-exact text (AffiliateHub.tsx / ProfileHub.tsx's own `ARIAL` consts). */
const ARIAL = 'Arial, Helvetica, sans-serif';

/** Ticket 2026-09-11#8/A: the bet-panel value row + preset-track labels use the prototype's
 *  second font stack (`Full Spec.html:706,709,721` all set `font-family:'Space Grotesk', Arial,
 *  Helvetica, sans-serif`) — same const-extraction idiom as `AffiliateHub.tsx`/`DiceHub.tsx`'s own
 *  `SPACE_GROTESK`. */
const SPACE_GROTESK = "'Space Grotesk', Arial, Helvetica, sans-serif";

/** Ticket 2026-09-11#8/A — bet-panel colors cited 1:1 from `Full Spec.html`'s `getState()`
 *  (`:3734` `betTrackBg`, `:3607` `provablyFg`), same `{light, dark}` pair + `useTheme()` idiom
 *  `MinesHub.tsx`'s `MINES_BOARD_BG` etc. already establish for this exact situation (a
 *  prototype-literal hex pair with no matching `--rc-*` token). */
const BET_TRACK_BG = { light: '#D7D7E2', dark: '#12121A' }; // Full Spec.html:3734 (`betTrackBg`)
const PROVABLY_FG = { light: '#0B0B0B', dark: '#FFFFFF' }; // Full Spec.html:3607 (`provablyFg`)
/** The sliding bet-indicator pill + PLAY/Play-a-Friend's pressable-ledge shadow: fixed in both
 *  themes (`Full Spec.html:716`'s indicator `background:#8B45F0`; `:3823`'s `playBtnShadow`
 *  baseline `'0 5px 0 #5F27B8'`). */
const BET_INDICATOR_BG = '#8B45F0';
const PLAY_BTN_SHADOW = '0 5px 0 #5F27B8'; // Full Spec.html:3823 (`playBtnShadow`, non-fundsWarn case)

/** Presets withheld from a guest's bet grid (issue #353): `GUEST_HUMAN_RESERVED_STAKE` (1) is
 *  reserved for human-to-human testing inside the isolated guest world
 *  (`packages/shared/src/guest.ts`) — no guest bot ever rests at or claims it, so a guest must
 *  never be able to select or post it through this control either. Withheld by construction (the
 *  preset is never rendered as an option for a guest session), not merely disabled-with-a-label. */
const GUEST_EXCLUDED_STAKES: readonly number[] = [GUEST_HUMAN_RESERVED_STAKE];

/** Two-line time-control labelling (data-driven from the meta option). The big line is the
 *  duration derived from `baseMs`; the small line is the mode name parsed from `"Name · X min"`. */
const tcDuration = (baseMs: number): string => {
  const mins = baseMs / 60_000;
  if (mins >= 1 && Number.isInteger(mins)) return `${mins} min`;
  const secs = Math.round(baseMs / 1_000);
  return `${secs} sec`;
};
const tcName = (label: string): string => label.split('·')[0]!.trim();

export type Phase = 'idle' | 'waiting' | 'in-match' | 'result';

/** Args the per-game play-panel slot receives — everything it needs to render the in-match
 *  (and greyed-idle) game area while preserving server-authoritative redaction. */
export interface GameAreaArgs {
  phase: Phase;
  gameState: GameView | null;
  /** The last match.state broadcast's raw GameEvent[] (2026-09-11#9 item 2) — usually empty (most
   *  broadcasts carry none). Per GAME_MODULE_INTERFACE.md's "nothing secret in an event" rule,
   *  anything a module puts here is already safe to hand straight to a game area component; GameHub
   *  is purely a passthrough — interpreting a specific event type is that game's own job (only
   *  RpsHub.tsx's RpsBoard reads it today, for RPS's tied-round reveal). */
  events?: GameEvent[];
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
  /** OPT-IN draw offers (games declaring the capability, e.g. chess — CHESS_DRAW_OFFER.md rev 3).
   *  Send/withdraw your own offer, or accept the opponent's; the server records/resolves/clears it.
   *  Undefined for games without it. */
  onDrawOffer?(): void;
  onDrawRevoke?(): void;
  /** Accept the opponent's active offer — the only way a draw offer completes the match. */
  onDrawAccept?(): void;
  playerId: string | null;
  opponentId: string | null;
  username: string | null;
  /** The real opponent's display name when known (JOIN path), else null → a neutral "Opponent".
   *  Lets a game area name the opponent in its own reveal (Chess's "[name] Won" result line).
   *  Same public alias the slot pill shows — never a hidden identity. */
  opponentName?: string | null;
  /** Client→server clock offset (ms): add to `Date.now()` to align a display-only animation with
   *  server-authoritative timers — Crash's live altitude must match the altitude the server banks.
   *  Defaults to 0 (no skew) when the payload didn't carry the server clock. */
  serverClockOffset?: number;
  /** Base budget (ms) of the currently selected time control, for games that declare one (chess).
   *  Lets a hub render the picked clock in the slot pills pre-match (before any server clock).
   *  Generic (derived from the meta) — undefined for games without a time control. */
  timeControlBaseMs?: number;
  /** The server's match.end outcome — set only in the result phase (null otherwise). Lets a game
   *  area paint a terminal result on the board itself (e.g. Blackjack's win/lose card frames) when
   *  it opts out of the shared result overlay. Driven strictly by the server, never inferred. */
  outcome?: Outcome | null;
  /** True during the shared draw→rematch beat (#161) — the ~2 s window after a tie round pushes and
   *  the server re-deals a fresh round in the same escrow. Lets a game area hold its own resolution
   *  reveal (e.g. Limbo/Keno's `lastResult`, Coinflip's flip) while the bars show the orange outline,
   *  before the fresh round takes over. Generic (driven by the `replays` signal); games ignore it. */
  drawBeat?: boolean;
  /** OPT-IN reveal-complete signal (games that also set `gateResultOnReveal`). The game area alone
   *  knows its reveal choreography timing (e.g. Blackjack's hole-card flip + hit deal-in), so it
   *  calls this ONCE when the last card of the terminal reveal has landed. The hub then lights the
   *  result bar (and, when the balance-hold is enabled, applies the settled balance) in lockstep
   *  with the on-board reveal instead of on a fixed beat. Undefined for games that don't gate. */
  onRevealComplete?(): void;
  /** Ticket 2026-09-12#1 item 1 (ADVISOR_TO_PM.md): mirrors this hub's own `barSlideActive` (the
   *  same flag driving `matchBarSlide`'s bar-slide-to-center-and-back, opt-in via `matchBarSlide`) —
   *  true across the "searching"/"found" matching beat, false once `in-match` takes over. Lets a
   *  game area dim its own board to match the prototype's `rpsBoardOp` (`Full Spec.html:3795`:
   *  `rpsMatching ? 0.28 : 1`) while the opponent/own bars slide toward the VS label, so the sliding
   *  bars read against a receded table instead of a same-toned board. Always present (not gated on
   *  `matchBarSlide` — a game area that never reads it is an inert `false`/`undefined` the rest of
   *  the time, same no-op shape as the other opt-in fields above). */
  barSlideActive?: boolean;
}

/** The generic, per-game-agnostic props the App feeds every Game hub (Coinflip, RPS, …). */
export interface GameHubScreenProps {
  token: string;
  playerId: string | null;
  username: string | null;
  /** The player's OWN avatar (preset id or 'default'), threaded into the own slot bar. Own-session
   *  only — the opponent slot NEVER receives an avatarId (it stays the neutral silhouette, per
   *  Charter #2 redaction). Defaults to 'default'. */
  avatarId?: AvatarId;
  opponentId: string | null;
  /** The real opponent's display name, known only when we JOINed their open challenge (the owner
   *  name from the feed). Null on the PLAY/post path (the joiner's name never reaches the client)
   *  → the slot falls back to a neutral "Opponent". Never a fabricated/cycled name (Charter #2). */
  opponentName?: string | null;
  /** Ticket 2026-09-18#2 item 4: the real, server-confirmed stake for the CURRENT match — mirrors
   *  `opponentName` above exactly. `armedStake` (this component's own bet-amount display state)
   *  only ever gets populated locally, when the player taps a bet preset themselves before
   *  pressing PLAY — a JOIN-initiator never touches that UI, so their bet-amount display stayed
   *  permanently blank even though the stake was fully known server-side. Null pre-match/idle. */
  matchStake?: number | null;
  /** Client→server clock offset (ms) for aligning display-only timers (see GameAreaArgs). */
  serverClockOffset?: number;
  /** Live balance from the app (source of truth; updates on match.end settlement). */
  balance: number;
  currentMatchId: string | null;
  gameState: GameView | null;
  /** See GameAreaArgs.events — App.tsx threads the last match.state broadcast's events through
   *  unchanged; most hub games ignore this entirely. */
  events?: GameEvent[];
  legalMoves: string[];
  waitingExpiresAt: number | null;
  lobbyExpired: boolean;
  lastOutcome: Outcome | null;
  lastSettlement: SettlementSummary | null;
  /** Cross-game open challenges, keyed by gameId (App aggregates every game's feed) — the hub's
   *  Open Games ticker shows them all, not just this game's (owner decision D2). */
  challengesByGame: Record<string, OpenChallenge[]>;
  /** Post a challenge at `stake`. `timeControlId` is supplied for games that declare a
   *  time control (chess); omitted for the rest (the App maps it to 'none'). */
  onPlay(stake: number, timeControlId?: string): void;
  onCancel(): void;
  onRepost(): void;
  onTakeChallenge(matchId: string): void;
  /** Logged-out JOIN: the carousel passes the row's game + stake so the auth wall can capture a
   *  full {action:'join'} intent (matchId may be gone by auth → fall back to that hub, stake armed).
   *  Mirrors `HomeHubScreen`'s identical prop (same handler, `App.tsx`'s `handleTakePublicChallenge`). */
  onTakePublicChallenge?(c: { matchId: string; gameId: string; stake: number }): void;
  onMakeMove(move: string): void;
  onForfeit(): void;
  /** OPT-IN draw offers (chess — CHESS_DRAW_OFFER.md rev 3). App wraps the WS calls; other hubs
   *  ignore them. */
  onDrawOffer?(): void;
  onDrawRevoke?(): void;
  onDrawAccept?(): void;
  /** Subscribe/unsubscribe to EVERY game's feed (cross-game ticker). App wraps the WS calls. */
  onTrackChallenges(gameIds: string[]): void;
  onUntrackChallenges(): void;
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  onOpenGameList(): void;
  /** Rewards tab → the VIP/Rewards hub (issue #307). */
  onOpenRewards(): void;
  /** Menu overlay's own EARN → "Affiliate program" row (issue #423). Unused in guest mode — the
   *  Menu overlay itself is never rendered there (`!isGuest` below). */
  onOpenAffiliate(): void;
  /** Reset App's result state when the hub's result overlay dismisses (back to Idle). */
  onResultDismiss(): void;
  /** Logged out → no wallet/feed (auth-required); browsing the board + picking a bet stay open.
   *  The auth wall fires in the App at PLAY/JOIN. Default true. */
  loggedIn?: boolean;
  /** Pre-arm the bet selector (the join-fallback drops the user here ready to post). */
  initialStake?: number;
  /** Pre-arm the time-control selection for games that declare one (chess) — guest mode's fixed
   *  control (issue #279), mirroring `initialStake`. Guest sessions skip the `/games` roster fetch
   *  below (curated surface, no picker needed), so `timeControl` (the fetched descriptor that
   *  normally drives the picker's default) never populates — without this, a guest's `selectedControl`
   *  would stay `undefined` forever and PLAY would silently omit the time control. Ignored for games
   *  without a time control (Coinflip) and for non-guest sessions (the fetched roster's own default
   *  still wins there, unchanged). */
  initialTimeControl?: string;
  /** Anonymous guest session (CHARTER.md's guest-mode exception, issue #267). Curated/simplified
   *  chrome: hides the wallet chip (own-session balance still shows, just non-interactive), Open
   *  Games, the related-games rail, Bring-a-Rival, the footer, and the bottom nav (account/games
   *  all lead to real-platform surfaces a guest session doesn't have). The bet control is
   *  genuinely interactive (issue #353) — pre-armed at `initialStake` as a sensible default for a
   *  guest who never touches it, but a guest can also pick any other offered preset; the grid
   *  withholds `GUEST_HUMAN_RESERVED_STAKE` (1) so a guest can never select or post it. Default
   *  false. */
  isGuest?: boolean;
}

interface GameHubProps extends GameHubScreenProps {
  /** The game this hub instance is for — drives the title, related-games filter, and board. */
  gameId: string;
  gameName: string;
  /** The in-match (and greyed-idle) game area, provided per game. */
  renderGameArea(args: GameAreaArgs): ReactNode;
  /** Optional per-game content rendered right-aligned inside a slot pill, for the given side.
   *  Called for BOTH pills in EVERY phase — the game decides what (if anything) to show and when
   *  (Blackjack: Hit/Stand in the own pill in-match; Chess: each side's clock, pre-match + live).
   *  A non-null opponent-side result replaces the default in-match "Playing…" tag. */
  renderSlotAside?(args: GameAreaArgs, side: 'opponent' | 'own'): ReactNode;
  /** Optional game-specific reveal at the top of the result overlay (e.g. the Coinflip coin). */
  renderResultReveal?(args: { outcome: Outcome; gameState: GameView | null; playerId: string | null }): ReactNode;
  /** Optional in-match override for the ONE primary action button (PLAY's slot). When this returns
   *  non-null the hub renders it INSTEAD of PLAY — so a game transforms the single button in place
   *  (Crash: PLAY → EJECT → disabled-waiting → back to PLAY) rather than spawning a second control.
   *  Return null to keep the default PLAY button (idle / result → play again). Template-shaped. */
  renderPrimaryAction?(args: GameAreaArgs): ReactNode;
  /** Optional in-match override for the SECONDARY action button (the Play-a-Friend slot) — mirror of
   *  `renderPrimaryAction`. When it returns non-null the hub renders it INSTEAD of Play a Friend, so a
   *  game transforms that button in place (Chess: Play a Friend → Draw request ⇄ Revoke DRAW). Return
   *  null to keep the default Play a Friend. Never shown while searching (that slot is the Cancel). */
  renderSecondaryAction?(args: GameAreaArgs): ReactNode;
  /** Opt out of the shared result pop-up (mirrors holdResultMs being opt-in). When true the hub
   *  never renders the ResultOverlay; it instead holds the result phase open with the board mounted
   *  (gameState = the terminal frame, areaArgs.outcome set) so the game presents the result on the
   *  board itself, persisting until a new game starts or the player leaves. Other games omit it →
   *  the overlay shows as before (the regression guard). */
  suppressResultOverlay?: boolean;
  /** Opt OUT of the shared orange draw-bar (Blackjack's reversal). The draw→rematch beat still fires
   *  and `areaArgs.drawBeat` still reaches the game area (Blackjack paints the push on the CARDS + an
   *  orange "Push" label) — this only stops the orange outline from being painted on the two slot
   *  bars, because "the bar speaks only on decided rounds" (BLACKJACK.md / SCREENS.md reconciliation).
   *  Other games omit it → the bars still go orange on a draw (the universal treatment). */
  suppressDrawBar?: boolean;
  /** Opt in to bar-level result coloring on the own slot (Coinflip-style): all three verdicts settle
   *  to the shared ring outline (win → ring-success, loss → ring-destructive, draw → ring-amber-400);
   *  on a win the bar first plays a transient green fill + "You Win" alongside the username (which is
   *  never swapped out) that eases out into that green outline. Fires BAR_VERDICT_BEAT_MS after the
   *  result phase starts so the board can animate first. Other games omit this → no change. */
  ownBarResult?: boolean;
  /** Presentation-only reveal pacing (opt-in). When > 0, the hub keeps the board mounted in the
   *  In-match phase for this long after the server ends the match, so the game area can animate
   *  its final state transitions (e.g. Blackjack's opponent reveal) before the result overlay
   *  takes over. Settlement already happened server-side — this only spaces out the on-screen
   *  reveal a human beat; it never delays settlement or changes any state. Omitted → the overlay
   *  shows immediately (unchanged for every other game). */
  holdResultMs?: number;
  /** Opt in (Blackjack) to gating the RESULT PRESENTATION on the board's reveal-complete signal
   *  instead of a fixed beat. When set, the own result bar (and the ribbon balance) only settle once
   *  the game area calls `areaArgs.onRevealComplete()` — i.e. when the last card of the terminal
   *  reveal has landed — so the bar/balance never jump ahead of the on-board reveal. Requires the
   *  game area to fire `onRevealComplete`. Omitted → the bar lights on the fixed BAR_VERDICT_BEAT_MS
   *  beat and the balance syncs immediately (byte-identical to today for every other game). */
  gateResultOnReveal?: boolean;
  /** Override for the "Searching…" dwell floor below (issue #387). Coinflip and RPS pass 0: their
   *  entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, resolves ONLY at expiry —
   *  never early), so burning ~2.4s of it on a purely cosmetic hold risks the window elapsing before
   *  the pick buttons ever render, resolving the match via the timeout auto-pick with no player
   *  input. Every other hub game omits this (undefined → the existing 2400ms default), so their dwell
   *  is byte-identical to before this prop existed. */
  searchFloorMs?: number;
  /** Ticket 2026-09-11#10 item 1 (ADVISOR_TO_PM.md): opts a hub into the shared "bar slide toward
   *  the VS label, hold, slide back" motion that runs alongside `matchForming` above — confirmed
   *  shared across RPS/Mines/Dice in the prototype (`Full Spec.html:3517-3530`'s `rpsMatching =
   *  (view==='rps'||view==='mines'||view==='dice') && (rpsMatch==='searching'||rpsMatch==='found')`,
   *  which drives BOTH the VS-label opacity T5 already ported AND `rpsOppBarY`/`rpsPlayerBarY`
   *  (`:3753-3754`), which T5 missed entirely). Undefined (the default) → every hub except
   *  RpsHub/MinesHub/DiceHub never renders the data attributes or inline transform below, so this
   *  is a byte-identical no-op for the other 9 games.
   *  - A plain `number` (RPS passes `123`, `Full Spec.html:3754`'s `!gameV` fallback — the
   *    prototype's own `startRps()` never measures the DOM at all, so this flat magnitude is
   *    faithful, not a shortcut) → the opponent bar shifts down by that many px, the player bar up
   *    by the same magnitude.
   *  - `'measured'` (Mines/Dice pass this) → the real magnitude is measured live via
   *    `getBoundingClientRect()` on `[data-rc-gamewrap]`/`[data-rc-oppbar]`/`[data-rc-playerbar]` at
   *    the moment the slide first arms, reproducing `startDice()`/`startMines()`'s own measurement
   *    (`:3396-3403`/`:3341-3348`) — never a hardcoded ±123px, per the ticket's explicit warning. */
  matchBarSlide?: number | 'measured';
  /** T4 (issue #489, interim until a real light design lands): pins everything this hub renders
   *  EXCEPT `HubRibbon` — the shared main body, bottom nav, menu overlay, and result overlay — to
   *  `.dark`'s token values regardless of the app-wide theme. See the doc comment above where this
   *  is consumed (in the render, below) for the full mechanism and why `HubRibbon` is excluded.
   *  Omitted (the default) → no behavior change, byte-identical to before this prop existed. */
  pinDark?: boolean;
  /** Ticket 2026-09-12 (Chess high-stake escalation, PM-scoped — no prototype source exists for
   *  this; `Full Spec.html` only ever sets a bet chip to its exact tapped value, no escalation
   *  gesture anywhere). Opt-in, mirroring every other per-hub behavior on this component: when set,
   *  the FIRST value in the array is treated as a preset within `BET_PRESETS` (Chess passes
   *  `[100, 250, 500, 1000, 2500, 5000, 10000]`, so it keys off the existing "100" button) and that
   *  button's tap-again gesture cycles through the rest of the array instead of just re-arming its
   *  own face value — the same #381 "1→2" gesture shape, generalized. Tapping any OTHER preset
   *  first and then tapping back resets the cycle to the array's first rung (never resumes
   *  mid-cycle), for free, via `nextInCycle`'s `indexOf` returning -1 for "not currently in this
   *  cycle". Undefined (every hub but ChessHub) → byte-identical no-op: the "100" button (and every
   *  other preset) keeps its plain `onArm(v)`. */
  highStakeCycle?: readonly number[];
  /** Ticket 2026-09-16#7 item 4: a SECOND bar-convergence trigger, OR'd into `barSlideActive`
   *  (below) alongside the existing pre-match `matchForming || searching` — Mines' own post-bust
   *  result sequence (`minesResult !== null`, `Full Spec.html:3521-3526`'s `mConverged`), scoped
   *  per-hub (unlike the shared `barSlideActive` itself, which every `matchBarSlide` hub reads as
   *  "pre-match slide only"). Reuses the EXACT same live-measurement/transition machinery —
   *  `barSlideActive` transitioning false→true again is all the existing effect needs to
   *  re-measure, no new code there. Undefined (every hub but Mines) → byte-identical no-op. */
  resultConverge?: boolean;
  /** Ticket 2026-09-16#7 item 5: Mines-only gem-count icon rows (`minesOppGemList`/`minesGems`,
   *  `Full Spec.html:445-462`/`:660-681`) — rendered as a new sibling between the name and the
   *  right-side aside/"Playing…" slot. Ticket 2026-09-17#2 item 2: now `flex-1 min-w-0` (matching
   *  the prototype's own `flex:1 1 auto` fill), NOT the `shrink-0` this originally shipped with —
   *  the original deviation (avoiding moving `flex-1` off the name span, to protect long-name
   *  truncation on other hubs) turned out to cause its own real bug: with the gem row `shrink-0`
   *  and the name still `flex-1`, the name box grows to claim ALL remaining space regardless of its
   *  own length, pushing the gem row to the bar's far right edge. Fixed correctly this time: the
   *  name span's own `flex-1` is now conditional on `gemRow`'s absence (see `OpponentSlot`'s/
   *  `OwnSlot`'s own name-span comments) — still a Mines-only-safe change, since `gemRow` stays
   *  `undefined` for every other hub, so their name span keeps its `flex-1` exactly as before.
   *  Undefined (every hub but Mines) → byte-identical no-op, nothing rendered. */
  oppGemRow?: ReactNode;
  ownGemRow?: ReactNode;
  /** Ticket 2026-09-17#3 item 2: the gem-COUNT CAPTION (`oppGemText`/`myGemText`,
   *  `Full Spec.html:3779/3781`) — plain text sitting OUTSIDE the bar box (above the opponent's bar,
   *  below the player's own), a genuinely separate mechanism from `oppGemRow`/`ownGemRow` above
   *  (which render the icon strip INSIDE the bar). This is the long-tracked `2026-09-12#2` item 3(c)
   *  gap. Text generation is asymmetric in the source, preserved as-is rather than "fixed" into
   *  consistency: the opponent's caption is ALWAYS "{n} gems" — no singular case, even at 1
   *  (`:3779`); the player's own DOES singularize — "{n} gem" at exactly 1, "{n} gems" otherwise
   *  (`:3781`). Mines supplies the already-formatted string and its own visibility (`oppGemTextOp`/
   *  `myGemTextOp`, `:3780/3782`); GameHub owns position/font/color/transition, matching the
   *  citation's own literal values (`:467`/`:690`) exactly — `position:absolute`,
   *  `bottom:calc(100% + 6px)` for the opponent / `top:calc(100% + 6px)` for the player, both
   *  `right:4px`, `color:var(--rc-green)`, Space Grotesk 700 13px, `white-space:nowrap`,
   *  `pointer-events:none`, `transition:opacity 320ms ease`. Both `OpponentSlot`/`OwnSlot`'s root
   *  divs are already `position:relative`, so these render as ordinary absolutely-positioned
   *  children — no structural change, and they move with the bar during the converge slide for
   *  free. Undefined (every hub but Mines) → byte-identical no-op, nothing rendered. */
  oppGemText?: string;
  oppGemTextVisible?: boolean;
  ownGemText?: string;
  ownGemTextVisible?: boolean;
  /** Ticket 2026-09-17#4 item (dismiss): a tap anywhere in the game section (VS label, both bars,
   *  the board, or the empty space around them — `hub-section-game`, `Full Spec.html:2451`'s own
   *  overlay covers the same visual area) — dismisses a landed Mines result, returning the bars/
   *  board to their pre-match resting state. Deliberately narrower than the prototype's own literal
   *  mechanism: the prototype uses a truly page-wide overlay (z-index:6, covering the bottom nav
   *  too) with a manual `getBoundingClientRect` check carving out the Play button specifically,
   *  since Play sits underneath that same overlay. Our own `hub-section-game`/`hub-section-play` are
   *  already separate sibling sections — Play is never covered by this handler in the first place,
   *  so no such carve-out is needed, and unlike the prototype this never risks intercepting bottom-
   *  nav/wallet taps. Mines' own handler no-ops unless `resultPhase === 'final'`. Undefined (every
   *  hub but Mines) → byte-identical no-op, no handler attached. */
  onSectionTap?(): void;
  /** Ticket 2026-09-21#10 (D37): hides the shared opponent-bar "Playing…" label the moment the
   *  opponent's OWN round ends, closing a real collision — the shared `phase` alone stays
   *  'in-match' through the whole post-lock `holdResultMs` hold window (which for Mines spans its
   *  own `resultPhase` converge→reveal→final sequence), so without this the label kept showing
   *  well after the opponent's gem strip had already faded in, in the same bar. Undefined (every
   *  hub but Mines) → `!undefined` → `true` → byte-identical to today's plain `phase === 'in-match'`
   *  condition. See `OpponentSlot`'s own matching comment for the full mechanism. */
  oppLocked?: boolean;
}

/** Ticket 2026-09-12: generalizes the #381 "tap-again to escalate" gesture beyond the hardcoded
 *  1→2 case. `indexOf` returns -1 both when nothing is armed and when the currently-armed stake
 *  isn't part of THIS cycle at all (armed at some other preset) — `(-1 + 1) % length === 0` then
 *  naturally lands on `cycle[0]`, which is exactly the "any other preset resets the gesture"
 *  behavior the existing 1→2 gesture already has, with no special-casing needed here. */
function nextInCycle(cycle: readonly number[], current: number | null): number {
  const idx = current != null ? cycle.indexOf(current) : -1;
  return cycle[(idx + 1) % cycle.length];
}

/** A 1s ticking clock for countdowns (cosmetic; expiry is server-authoritative). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * GameHub — the COINFLIP_HUB pattern generalized (HUB_TRANSITION_ANALYSIS), revised to the
 * Start_Building_Frame: opponent/own slot pills wrap the per-game arena, a unified play panel
 * (PLAY + bet grid + time control + Play-a-Friend), the cross-game Open Games ticker, a
 * related-games rail (all games, coming-soon included), the Bring-a-Rival card and the shared
 * footer. Owns the generic chrome + the in-place state machine (Idle → Waiting → In-match →
 * Result over the App's WS events). The mechanic, WS flow, and server-authoritative redaction
 * are unchanged — presentation only.
 */
export function GameHub(props: GameHubProps) {
  const {
    gameId, gameName, renderGameArea, renderSlotAside, renderResultReveal, renderPrimaryAction, renderSecondaryAction, suppressResultOverlay, holdResultMs, gateResultOnReveal, ownBarResult, suppressDrawBar, searchFloorMs = 2400, matchBarSlide, pinDark = false, highStakeCycle, resultConverge, oppGemRow, ownGemRow, oppGemText, oppGemTextVisible, ownGemText, ownGemTextVisible, onSectionTap, oppLocked,
    token, playerId, username, avatarId = 'default', opponentId, opponentName, matchStake, serverClockOffset = 0, balance, currentMatchId, gameState, events,
    legalMoves,
    waitingExpiresAt, lobbyExpired, lastOutcome, lastSettlement, challengesByGame,
    onPlay, onCancel, onTakeChallenge, onTakePublicChallenge, onMakeMove, onForfeit, onDrawOffer, onDrawRevoke, onDrawAccept, onTrackChallenges,
    onUntrackChallenges, onSelectGame, onOpenWallet, onOpenGameList, onOpenRewards, onOpenAffiliate, onResultDismiss,
    loggedIn = true, initialStake, initialTimeControl, isGuest = false,
  } = props;

  // ── Live wallet balance ─────────────────────────────────────────────────────
  // The `balance`→`liveBalance` sync effect lives after `phase` is derived (it can HOLD on the
  // reveal-complete signal when gateResultOnReveal is set); the mount fetch stays here.
  const [liveBalance, setLiveBalance] = useState(balance);
  // Issue #414: the Menu overlay's own open/close/reveal-origin state — never opened for a guest
  // (its HubToolbar, the only way to reach it, is already hidden below via `!isGuest &&`).
  const menu = useMenuOverlay();
  // Ticket 2026-09-11#7b: the chat sheet's own state — same guest gating as Menu above.
  const chat = useChat();
  // Ticket 2026-09-12#3 item 1: unlock audio on the first user gesture (idempotent — safe to call
  // from many mounts). Consolidated here from ChessHub's own copy now that the shared PLAY button
  // below plays a sound generically for every hub, not just Chess/Dice.
  useEffect(() => { installUnlockOnFirstGesture(); }, []);
  function navTo(fn: () => void) {
    return () => { chat.close(); menu.wrap(fn)(); };
  }
  function openChat() {
    menu.close();
    chat.openChat();
  }
  useEffect(() => {
    // Wallet is auth-only (logged out shows the "Sign in" chip); a guest's balance lives in the
    // server's ephemeral ledger, never the real `/wallet` — the `balance` prop (updated from the
    // WS match.end settlement, generic to any session) is already authoritative for it.
    if (!loggedIn || isGuest) return;
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    return () => { alive = false; };
  }, [token, loggedIn, isGuest]);

  // ── Reveal-complete gate (opt-in via gateResultOnReveal) ─────────────────────
  // The game area (which alone knows its reveal choreography timing) calls onRevealComplete when the
  // last card of the terminal reveal has landed; we flip `revealDone` and gate the result bar (and,
  // when enabled, the ribbon balance) on it. Reset to "not yet revealed" for each new match.
  const [revealDone, setRevealDone] = useState(false);
  useEffect(() => { setRevealDone(false); }, [currentMatchId]);
  const handleRevealComplete = useCallback(() => setRevealDone(true), []);

  // Ticket 2026-09-18#1: JOIN/PLAY don't navigate (App.tsx's onMatchStart is an ordinary
  // setScreen(...) state change, no URL change, no page load), so the browser never gets a chance
  // to reset scroll on its own — whatever position the user had on a scrolled-down open-challenges
  // list carries straight over onto the new game screen. Scoped narrowly to match-entry only (not
  // every top-level navigation) per Owner's own explicit call — the broader policy question is
  // deferred to Designer separately. `behavior: 'auto'` (instant), not smooth: the screen has
  // already been replaced at this point, so animating a scroll over already-swapped content would
  // look broken, not polished.
  useEffect(() => { if (currentMatchId) window.scrollTo({ top: 0, behavior: 'auto' }); }, [currentMatchId]);

  // ── Games roster (drives the time control, related rail, and feed labels) ─────
  // A guest's curated surface is exactly one game (isGuest games are hidden anyway) — skip the
  // roster fetch and the cross-game ticker subscription entirely; coinflip has no time control.
  const [games, setGames] = useState<GameMeta[]>([]);
  useEffect(() => {
    if (isGuest) return;
    let alive = true;
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token, isGuest]);
  const nameByGame = useMemo(() => new Map(games.map((g) => [g.id, g.displayName])), [games]);
  const timeControl = games.find((g) => g.id === gameId)?.timeControl;
  const [selectedControl, setSelectedControl] = useState<string | undefined>(initialTimeControl);
  // Guest sessions never fetch the roster (above), so `timeControl?.defaultId` never resolves for
  // them — guard this sync to non-guest sessions so it can't clobber the guest's pre-armed control
  // (initialTimeControl) with `undefined` on mount.
  useEffect(() => { if (!isGuest) setSelectedControl(timeControl?.defaultId); }, [timeControl?.defaultId, isGuest]);

  // Cross-game ticker: subscribe to every game's feed while the hub is mounted (authed only).
  const gameKey = games.map((g) => g.id).join(',');
  useEffect(() => {
    if (!loggedIn || isGuest || games.length === 0) return;
    onTrackChallenges(games.map((g) => g.id));
    return () => onUntrackChallenges();
    // eslint-disable-next-line -- track once per game-set change (callbacks are stable)
  }, [gameKey, loggedIn, isGuest]);

  // ── Sub-state machine ──────────────────────────────────────────────────────
  const [waiting, setWaiting] = useState(false);
  const [overlay, setOverlay] = useState<{ outcome: Outcome; settlement: SettlementSummary; revealState: GameView | null } | null>(null);
  const prevMatch = useRef(currentMatchId);

  // Reveal-hold (opt-in via holdResultMs): keep the board in-match for a beat after the server
  // ends the match so the game area animates its terminal reveal, THEN show the result overlay.
  const [resultPending, setResultPending] = useState(false);
  const pendingResult = useRef<{ outcome: Outcome; settlement: SettlementSummary; revealState: GameView | null } | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resultTimer.current) clearTimeout(resultTimer.current); }, []);
  function clearPendingResult() {
    if (resultTimer.current) { clearTimeout(resultTimer.current); resultTimer.current = null; }
    pendingResult.current = null;
    setResultPending(false);
  }

  // "Searching…" dwell floor (DEMO_PRESENTATION): when we PLAY, hold the search beat for a
  // minimum even if a match is already resting, so pairing never snaps in with zero delay. A
  // presentation floor only — it never blocks/delays real pairing (the match is already live
  // server-side; we just defer the in-match *visual* a beat). Untouched on the JOIN path.
  // Duration comes from `searchFloorMs` (defaults to 2400 above) — Coinflip/RPS pass 0 (#387) so
  // `elapsed < SEARCH_FLOOR_MS` below is never true (elapsed is never negative) and the hold never
  // arms, naturally collapsing this whole mechanism to a no-op for them without a special-cased path.
  const SEARCH_FLOOR_MS = searchFloorMs;
  const searchStartRef = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holdSearch, setHoldSearch] = useState(false);
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  useEffect(() => {
    const prev = prevMatch.current;
    prevMatch.current = currentMatchId;
    if (currentMatchId && !prev) {
      setOverlay(null);
      clearPendingResult();
      setWaiting(false);
      // Apply the search dwell floor only when this match formed from our own PLAY beat.
      const started = searchStartRef.current;
      searchStartRef.current = null;
      const elapsed = started != null ? Date.now() - started : Infinity;
      if (elapsed < SEARCH_FLOOR_MS) {
        setHoldSearch(true);
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => setHoldSearch(false), SEARCH_FLOOR_MS - elapsed);
      }
    } else if (!currentMatchId && prev) {
      if (lastOutcome && lastSettlement) {
        const result = { outcome: lastOutcome, settlement: lastSettlement, revealState: gameState };
        if (holdResultMs && holdResultMs > 0) {
          // Defer the overlay a presentation beat so the board can play out its terminal reveal.
          pendingResult.current = result;
          setResultPending(true);
          if (resultTimer.current) clearTimeout(resultTimer.current);
          resultTimer.current = setTimeout(() => {
            resultTimer.current = null;
            if (pendingResult.current) setOverlay(pendingResult.current);
            pendingResult.current = null;
            setResultPending(false);
          }, holdResultMs);
        } else {
          setOverlay(result);
        }
      }
      setWaiting(false);
      setHoldSearch(false);
    }
  }, [currentMatchId, lastOutcome, lastSettlement, gameState, holdResultMs]);

  useEffect(() => {
    if (waitingExpiresAt != null) setWaiting(true);
  }, [waitingExpiresAt]);

  // #154: the search timed out with no opponent (lobbyExpired). Revert to idle IN PLACE — drop
  // out of the waiting phase so the opponent pill + arena show their idle cues again and the play
  // panel returns to idle PLAY. The armed stake is kept (armedStake state persists), so pressing
  // PLAY simply re-posts (App resets lobbyExpired on the new join → the "No opponent" note clears).
  useEffect(() => {
    if (lobbyExpired) { setWaiting(false); searchStartRef.current = null; }
  }, [lobbyExpired]);

  // While the dwell floor holds, a live match still reads as "waiting" (the opponent slot keeps
  // scanning) so the in-match board reveals a beat later instead of snapping in.
  // `resultPending` keeps the phase in-match (board mounted, "Playing…") through the reveal hold,
  // even though the server has already cleared currentMatchId.
  //
  // One-render bridge (Advisor #2, 2026-07-11): `overlay`/`resultPending` are only set by the effect
  // above, which fires one render AFTER `currentMatchId` first goes null (effects run post-commit).
  // On that exact first render, both are still their stale (falsy) pre-match values, so without this
  // bridge the formula falls all the way through to 'idle' for one frame — unmounting any board that
  // only mounts on 'in-match'/'result' (e.g. Blackjack's), so every card replays its mount animation
  // instead of transitioning in place. `lastOutcome`/`lastSettlement` are ordinary props (not
  // effect-derived) and App's onMatchEnd sets them in the SAME batch it nulls currentMatchId, so they
  // are already fresh on this exact render — bridge off them instead. This branch only ever fires in
  // the narrow window where overlay/resultPending/currentMatchId/waiting are all already falsy AND a
  // fresh result exists — i.e. only this one-render gap; the moment the effect catches up it sets
  // overlay directly (holdResultMs falsy) or resultPending then overlay (holdResultMs > 0), both of
  // which are already handled by the EARLIER branches above, so this stops competing immediately.
  const hasFreshResult = lastOutcome != null && lastSettlement != null;
  const phase: Phase = overlay ? 'result'
    : resultPending ? 'in-match'
    : (currentMatchId && !holdSearch) ? 'in-match'
    : (currentMatchId || waiting) ? 'waiting'
    : hasFreshResult ? (holdResultMs && holdResultMs > 0 ? 'in-match' : 'result')
    : 'idle';

  // Balance-hold (opt-in, paired with gateResultOnReveal): while a gated result is still revealing on
  // the board, HOLD the displayed balance at its pre-settlement value; apply the settled `balance`
  // only once the board signals reveal-complete (revealDone). `holdBalance` is constant-false for
  // non-gated games, so the effect's dependency set collapses to `[balance]` and its behaviour is
  // byte-identical to the previous `setLiveBalance(balance)` sync (the regression guard).
  const holdBalance = gateResultOnReveal === true && phase === 'result' && !revealDone;
  useEffect(() => {
    if (holdBalance) return;
    setLiveBalance(balance);
  }, [balance, holdBalance]);

  function dismissResult() {
    clearPendingResult();
    setOverlay(null);
    setWaiting(false);
    onResultDismiss();
  }

  // Decorative name-scan source for the "Searching…" beat: real online players from the live
  // cross-game Open Games feed (any game). Never fabricated — an empty feed shows just "Searching…".
  // Excludes the current player's own resting challenges (name-based: OpenChallenge carries only
  // ownerName, no owner id — #149) so the scan can't flash the player against themselves.
  // Ticket 2026-09-15#9 item 4: the comparison against `username` stays on the RAW ownerName (a
  // human player's own username is never bot-prefixed, so this must not compare against the
  // stripped/formatted display string) — only what actually gets ADDED to the scan set is run
  // through `displayHostName`, the same already-approved ADR-010 stripper GamesCarousel.tsx uses
  // (2026-09-13#6 item 3), so the bot-disclosure emoji never leaks into what's rendered here.
  const scanNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of Object.values(challengesByGame)) for (const c of list) if (c.ownerName && c.ownerName !== username) names.add(displayHostName(c.ownerName));
    return [...names];
  }, [challengesByGame, username]);

  // ── Bet + time-control selection ────────────────────────────────────────────
  const [armedStake, setArmedStake] = useState<number | null>(initialStake ?? null);
  // Ticket 2026-09-18#2 item 4: sync `armedStake` from the server-confirmed `matchStake` once a
  // match actually starts — the PLAY path already had a correct local value here (the same one
  // just echoed back), so this is a no-op flicker-free overwrite for PLAY; for JOIN, this is the
  // ONLY place `armedStake` (and so the bet-amount display) ever gets populated at all, since a
  // JOIN-initiator never touches the bet-preset UI. Keyed on `currentMatchId` (not `matchStake`
  // itself) to match every other match-start-triggered effect in this file (see the scroll-to-top
  // effect above) — fires exactly once per match, not on every incidental re-render.
  useEffect(() => { if (currentMatchId && matchStake != null) setArmedStake(matchStake); }, [currentMatchId]);

  function handlePlay() {
    if (armedStake == null) return;
    // Starting a new game clears any persisted result (the opt-out games keep the last board up
    // until now) so the panel/board leave the result phase cleanly.
    setOverlay(null);
    clearPendingResult();
    searchStartRef.current = Date.now(); // start the Searching dwell floor
    // Based on the actual armed value, not on whether the full picker descriptor loaded — a guest
    // session has a selectedControl (pre-armed, issue #279) with no `timeControl` descriptor at
    // all, and must still send it. Unchanged for every other game/session: `selectedControl` only
    // ever becomes truthy via the synced effect above when `timeControl` itself is truthy.
    if (selectedControl) onPlay(armedStake, selectedControl);
    else onPlay(armedStake);
  }
  function handleCancel() {
    searchStartRef.current = null;
    setWaiting(false);
    onCancel();
  }

  // Ticket 2026-09-15#12: fixed 3-slot head (Crash/Blackjack/Dice, Mines-substituted in place
  // when the current game is one of those 3) then the rest in GRID_ORDER — `relatedGamesFor` is
  // the pure ordering logic (unit-tested directly), this just attaches name/meta per id.
  const related = useMemo(() => {
    const live = new Set(games.map((g) => g.id));
    const metaById = new Map(games.map((g) => [g.id, g]));
    return relatedGamesFor(gameId, live).map((slot) => {
      const meta = metaById.get(slot.id);
      return { id: slot.id, name: meta?.displayName ?? titleCase(slot.id), playable: slot.playable, meta };
    });
  }, [games, gameId]);

  // A match is forming (the search dwell holds an already-paired match) or live — both freeze the
  // play panel (bet + Play-a-Friend greyed); the result phase does NOT (PLAY returns to start anew).
  const matchForming = phase === 'waiting' && currentMatchId != null;
  const playFrozen = phase === 'in-match' || matchForming;

  // #154: pure search — a posted bet with no match yet (and not expired). Drives the in-place
  // transform of the ALWAYS-mounted play panel: PLAY → a non-tappable "Waiting for an opponent ·
  // m:ss", Play-a-Friend → an active Cancel, bet row frozen — no separate WaitingBlock, no
  // mount/unmount (the in-match model, applied to waiting). The countdown ticks off `waitingExpiresAt`.
  const searching = phase === 'waiting' && !currentMatchId && !lobbyExpired;
  const searchNow = useNow(searching);
  const waitingRemaining = waitingExpiresAt != null ? waitingExpiresAt - searchNow : 0;

  // ── Matching bar-slide-to-center-and-back (ticket 2026-09-11#10 item 1) ──────
  // The prototype's `rpsMatching` flag (`Full Spec.html:3517-3530`) is true across BOTH its
  // `searching` and `found` sub-states and false again once the phase moves into `split`/active
  // play — exactly this hub's own `searching` OR `matchForming` (both already gated `!lobbyExpired`,
  // both collapse to `phase === 'waiting'`, and `matchForming`→false lands on the exact same beat
  // `phase` flips to `in-match`, matching the prototype's `found`→`split` transition point). Reuse
  // them rather than invent a third flag.
  // Ticket 2026-09-16#7 item 4: `resultConverge` (Mines-only) extends this the same way the
  // prototype's own `mConverged` extends `rpsMatching` (`Full Spec.html:3756`'s `minesBoardOp`) —
  // the SAME flag drives both the bar-shift-to-center AND the board dim below, matching exactly.
  const barSlideActive = matchForming || searching || Boolean(resultConverge);
  const barSlideEnabled = matchBarSlide != null;

  // 'measured' mode (Mines/Dice): live-measure the real bar positions the moment the slide first
  // arms, reproducing `startDice()`/`startMines()` (`Full Spec.html:3396-3403`/`:3341-3348`) exactly
  // — read `[data-rc-gamewrap]`/`[data-rc-oppbar]`/`[data-rc-playerbar]` via `getBoundingClientRect`,
  // take the vertical midpoint between the two bars, then derive each bar's own shift toward it.
  // The `71`/`23` px offsets are the prototype's own literal constants; `{o:123,p:-123}` (used
  // before the first measurement lands, or if either element isn't found) is the prototype's own
  // fallback for `mShift` (`:3520`) — not coincidentally the same magnitude as RPS's flat number
  // below, since that IS the prototype's designated "no live measurement yet" value.
  const gameWrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredShift, setMeasuredShift] = useState<{ o: number; p: number } | null>(null);
  const wasBarSlideActive = useRef(false);
  useLayoutEffect(() => {
    if (matchBarSlide === 'measured' && barSlideActive && !wasBarSlideActive.current) {
      const wrap = gameWrapRef.current;
      const ob = wrap?.querySelector<HTMLElement>('[data-rc-oppbar]');
      const pb = wrap?.querySelector<HTMLElement>('[data-rc-playerbar]');
      if (wrap && ob && pb) {
        const wr = wrap.getBoundingClientRect();
        const or_ = ob.getBoundingClientRect();
        const pr = pb.getBoundingClientRect();
        const oTop = or_.top - wr.top;
        const pTop = pr.top - wr.top;
        const mid = (oTop + pTop + pr.height) / 2;
        setMeasuredShift({ o: mid - 71 - oTop, p: mid + 23 - pTop });
      }
    }
    wasBarSlideActive.current = barSlideActive;
  }, [barSlideActive, matchBarSlide]);

  // Flat mode (RPS): the prototype's own `startRps()` never measures the DOM at all — only
  // `startDice()`/`startMines()` do — so a plain hardcoded magnitude here mirrors that exact
  // asymmetry (`Full Spec.html:3754`'s `!gameV` branch: `123px`/`-123px`) rather than inventing one.
  const barShift = !barSlideEnabled ? null
    : matchBarSlide === 'measured' ? (measuredShift ?? { o: 123, p: -123 })
    : { o: matchBarSlide, p: -matchBarSlide };
  const oppBarShiftY = barSlideEnabled ? (barSlideActive && barShift ? barShift.o : 0) : undefined;
  const ownBarShiftY = barSlideEnabled ? (barSlideActive && barShift ? barShift.p : 0) : undefined;

  // ── Draw→rematch beat (#161) — shared across every tie-replay game ───────────
  // The universal tie rule already re-deals a fresh round in the SAME escrow server-side (the module
  // bumps `replays`/`round` and returns a NON-terminal state; it settles once when decisive, and at
  // the 10-replay cap it sends match.end with outcome:void). The ONLY generic tell that a push just
  // happened is a rise in that public `replays` counter (replaysOf, no gameId branch). On a rise
  // while the match is live we run the shared beat: an orange outline on BOTH bars for
  // DRAW_REMATCH_HOLD_MS, then clear so the fresh round (already delivered) shows and the pick timer
  // restarts. The client never touches escrow per round; the cap-void arrives as a normal terminal
  // (match.end → result overlay), so there is no client-side loop.
  const replays = replaysOf(gameState);
  const [drawBeat, setDrawBeat] = useState(false);
  const prevReplays = useRef<number | null>(null);
  const drawBeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (drawBeatTimer.current) clearTimeout(drawBeatTimer.current); }, []);
  // A new match starts its own replay count — reset the baseline so a prior match can't leak a beat.
  useEffect(() => { prevReplays.current = null; setDrawBeat(false); }, [currentMatchId]);
  useEffect(() => {
    const prev = prevReplays.current;
    prevReplays.current = replays;
    // Only a genuine increase during a LIVE match is a draw — not the first frame, a reconnect
    // resume (baseline reset above), or the terminal void at the cap (that clears currentMatchId).
    if (prev != null && replays != null && replays > prev && currentMatchId != null) {
      setDrawBeat(true);
      if (drawBeatTimer.current) clearTimeout(drawBeatTimer.current);
      drawBeatTimer.current = setTimeout(() => setDrawBeat(false), DRAW_REMATCH_HOLD_MS);
    }
  }, [replays, currentMatchId]);

  // Built once and fed to the game area, the per-game slot asides (chess clocks) and the play action.
  const timeControlBaseMs = timeControl?.options.find((o) => o.id === selectedControl)?.baseMs;
  const areaArgs: GameAreaArgs = { phase, gameState, events, legalMoves, onMove: onMakeMove, onForfeit, onDrawOffer, onDrawRevoke, onDrawAccept, playerId, opponentId, username, opponentName, serverClockOffset, timeControlBaseMs, outcome: overlay?.outcome ?? null, drawBeat, onRevealComplete: handleRevealComplete, barSlideActive };
  // The bar-level draw outline: on for every game EXCEPT the ones that carry the draw on their own
  // surface (Blackjack → cards + "Push" label). The board still gets the full `drawBeat` via areaArgs.
  const barDrawBeat = suppressDrawBar ? false : drawBeat;

  // Bar-level result (opt-in, Coinflip-style). Fires BAR_VERDICT_BEAT_MS after the result phase
  // starts so the board's flip/reveal animation plays first. Generic derivation from server outcome.
  const ownBarFrameKind = outlineForOutcome(areaArgs.outcome, playerId);
  // The hook is ALWAYS called (hook-rule safe); the fixed-beat flag drives the non-gated path.
  const ownBarVerdictBeat = useDelayedFlag(
    ownBarResult === true && phase === 'result' && ownBarFrameKind != null,
    BAR_VERDICT_BEAT_MS,
  );
  // Gated games light the bar on the board's reveal-complete signal instead of the fixed beat, so it
  // never fires ahead of the last card landing (Advisor #10). Non-gated games keep the beat exactly.
  const ownBarVerdictLit = gateResultOnReveal
    ? (phase === 'result' && revealDone)
    : ownBarVerdictBeat;
  const ownBarVerdict: Verdict | null = (ownBarResult && ownBarVerdictLit) ? ownBarFrameKind : null;

  // T4 (issue #489): everything below HubRibbon — the shared main body, bottom nav, menu overlay,
  // and (for the rare hub that doesn't suppress it) the result overlay — for hubs that opt in via
  // `pinDark`. Extracted to a variable so the `.dark` wrapper (below, in the actual return) can be
  // applied conditionally without duplicating this whole block; every hub that omits `pinDark`
  // renders `bodyChrome` completely unwrapped, so this is a byte-identical no-op for them.
  const bodyChrome = (
    <>
      <main data-testid="hub-body">
        {/* No blanket px-4 — sections that need insetting add their own; the shared Open Games /
            Bring-a-Rival / footer render full-bleed to the max-w-md edge (they pad internally). */}
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {/* 1 — Arena: opponent slot pill, the per-game board, the player's own slot pill.
              No grey card frame here — each panel owns its surface (Blackjack's greyish table
              fills the section; the other arenas wrap themselves in a card). */}
          <section
            data-testid="hub-section-game"
            aria-label={gameName}
            className="relative flex flex-col gap-3 px-4"
            onClick={onSectionTap}
            ref={gameWrapRef}
            data-rc-gamewrap={barSlideEnabled ? '1' : undefined}
          >
            {/* T5: the shared "VS" match-found beat (Full Spec.html:430-433's `matchVsLabel` /
                `rpsMatchVsOp` / `rpsMatchVsScale` / `matchVsColor`) — the reveal between "Searching…"
                and the frozen pre-match state, the instant a match is assigned but play hasn't
                started (`matchForming`, line ~497 above). Every hub built on GameHub shares this
                render path (OpponentSlot → board → OwnSlot below), so this one insertion covers all
                of them, not just Mines/RPS/Dice.
                Always mounted (never conditionally rendered) so the opacity/scale transition can
                run BOTH ways — fading in on matchForming, then fading back out as `in-match` takes
                over — exactly like the prototype's own always-bound style props. Centered on the
                section's own vertical midpoint (top-1/2 + -translate-y-1/2) rather than the
                prototype's fixed `matchVsTop` pixel offset: the prototype is a fixed-width mock with
                a hand-tuned px value per game state, while this section's height is fluid (per-game
                board sizes) — centering on the section itself is the faithful equivalent of "floating
                between the two player bars" in a responsive layout. Every other value (opacity/scale
                start-end, color, font, transition timing) is copied 1:1 from the cited lines. */}
            <div
              aria-hidden="true"
              data-testid="hub-match-vs"
              className="pointer-events-none absolute inset-x-0 top-1/2 z-[2] flex items-center justify-center"
              style={{
                // Ticket 2026-09-17#3 item 1: extends `matchForming` with Mines' own post-lock
                // `resultConverge` (undefined/false for every other hub — byte-identical no-op
                // there), mirroring the prototype's own `rpsMatchVsOp: rpsMatching || mConverged ? 1
                // : 0` (`Full Spec.html:3787`). Position is unchanged — already centered on the
                // section's own midpoint, which already coincides with where the converged bars land.
                opacity: matchForming || resultConverge ? 1 : 0,
                transform: `translateY(-50%) scale(${matchForming || resultConverge ? 1 : 0.7})`,
                transition: 'opacity 320ms ease, transform 420ms cubic-bezier(0.34,1.5,0.5,1)',
              }}
            >
              <span
                className="text-[18px] font-bold tracking-[1.5px] text-[var(--rc-muted)]"
                style={{ fontFamily: ARIAL }}
              >
                VS
              </span>
            </div>
            <OpponentSlot phase={phase} opponentName={opponentName} scanNames={scanNames} aside={renderSlotAside?.(areaArgs, 'opponent')} drawBeat={barDrawBeat} barShiftY={oppBarShiftY} gemRow={oppGemRow} gemText={oppGemText} gemTextVisible={oppGemTextVisible} oppLocked={oppLocked} />
            {renderGameArea(areaArgs)}
            <OwnSlot
              label={loggedIn ? (username || 'You') : 'Sign in'}
              username={loggedIn ? username : null}
              avatarId={loggedIn ? avatarId : 'default'}
              isOwn={loggedIn}
              aside={renderSlotAside?.(areaArgs, 'own')}
              barVerdict={ownBarVerdict}
              drawBeat={barDrawBeat}
              barShiftY={ownBarShiftY}
              gemRow={ownGemRow}
              gemText={ownGemText}
              gemTextVisible={ownGemTextVisible}
              // Ticket 2026-09-15#13 item 2: Dice's own player-bar loss ring is var(--rc-loss)
              // (#FF3E5E, Full Spec.html:3787's playerBarRing), NOT the shared ring-destructive
              // every other OwnSlot-using game keeps — scoped here by gameId, not a global token
              // swap, since this component is shared by RPS/Mines/Coinflip/Blackjack/Chess too.
              // Ticket 2026-09-16#7 item 4: Mines gets the SAME token — its own playerBarRing
              // literal (Full Spec.html:3787) is ALSO #FF3E5E for loss, confirmed independently —
              // not a coincidence worth re-literalling, reuse the token exactly like Dice does.
              // Ticket 2026-09-25#3 item 2: RPS joins the same gate — a deliberate NEW bar treatment
              // for RPS (see RpsHub.tsx's own doc comment for the full citation chain), not a
              // consequence of the token already existing — Blackjack/Chess/Coinflip remain untouched.
              lossRingColor={gameId === 'dice' || gameId === 'mines' || gameId === 'rps' ? 'var(--rc-loss)' : undefined}
              // Ticket 2026-09-16#4 item 4: Dice's own win ring/fill is #16A34A (DiceHub.tsx's own
              // DICE_WIN_GREEN — the same green already used for the winning cube number and the
              // winning history pill), NOT the shared --rc-green — scoped by gameId, same shape as
              // lossRingColor above. Literal, not a --rc-* token: unlike --rc-loss this color has no
              // other consumer outside Dice, so there's nothing else for a shared token to serve.
              // Ticket 2026-09-17#6 (D28): Mines' own win colour is now #16A34A too — a DELIBERATE
              // reversal of 2026-09-16#7's #22C55E (which correctly matched the prototype's own
              // literal for this specific mechanism at the time). D28 explicitly asks for #16A34A
              // instead, citing the prototype's own #22C55E before overriding it — an informed
              // decision, applied as directed, not a re-litigation of the earlier verification.
              // Ticket 2026-09-25#3 item 2: RPS joins Mines/Dice on this same literal too, matching
              // its own card-frame win color (RpsHub.tsx's `FRAME_WIN`, ticket 2026-09-25#2 item 2) —
              // Blackjack/Chess/Coinflip are untouched, still on the shared generic --rc-green token
              // (this does not become a platform-wide unification).
              winRingColor={gameId === 'dice' || gameId === 'mines' || gameId === 'rps' ? '#16A34A' : undefined}
              winFillColor={gameId === 'dice' || gameId === 'mines' || gameId === 'rps' ? '#16A34A' : undefined}
              // Ticket 2026-09-16#7 item 4: Mines-only — the shared outlineClasses() had no
              // per-verdict draw override until now (win/lose already did). Mines' own draw literal
              // (Full Spec.html:3787) is #FF8A1E — no other game currently needs this overridden.
              drawRingColor={gameId === 'mines' ? '#FF8A1E' : undefined}
            />
          </section>

          {/* 3 — Unified play panel — ALWAYS mounted; the controls transform in place (#154), so
              idle→waiting→in-match never mounts/unmounts a panel or shifts layout. Idle/Result →
              live PLAY + Play-a-Friend. Searching → PLAY becomes a non-tappable "Waiting for an
              opponent · m:ss" (the actionSlot seam, same slot Crash uses for EJECT) and Play-a-
              Friend becomes the one active Cancel; the bet row freezes. Forming/In-match → frozen,
              "Playing…". Expiry reverts to idle + a polite "No opponent found" note. The opponent
              pill's "Searching…" and each hub's arena "Finding a rival…" remain the state cues. */}
          <div className="px-4">
            <PlayPanel
              playing={playFrozen}
              searching={searching}
              noOpponent={lobbyExpired && !currentMatchId}
              armedStake={armedStake}
              onArm={setArmedStake}
              onPlay={handlePlay}
              onCancel={handleCancel}
              actionSlot={
                searching ? (
                  <button
                    type="button"
                    disabled
                    data-testid="hub-play"
                    className="w-full cursor-default rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white opacity-80"
                  >
                    Waiting for an opponent · <span className="tabular-nums" data-testid="hub-waiting-countdown">{formatClock(waitingRemaining)}</span>
                  </button>
                ) : (renderPrimaryAction?.(areaArgs) ?? null)
              }
              secondaryActionSlot={searching ? null : (renderSecondaryAction?.(areaArgs) ?? null)}
              timeControl={timeControl}
              selectedControl={selectedControl}
              onSelectControl={setSelectedControl}
              excludedStakes={isGuest ? GUEST_EXCLUDED_STAKES : undefined}
              isGuest={isGuest}
              highStakeCycle={highStakeCycle}
            />
          </div>

          {/* 4 — Open Games (cross-game, all hubs) — the same GamesCarousel the Home hub renders
              (issue #305/#316: one implementation, not two). Internally handles both the signed-in
              WS aggregate and the logged-out public-poll snapshot via its own `loggedIn` prop.
              JOIN is blocked ONLY while genuinely occupied — a live match or an in-flight search. The
              settled post-game result view (phase 'result') is idle-with-a-board: the match is already
              deleted server-side, so JOIN must stay open there (as in plain idle) — otherwise Open
              Games wrongly reads "one match at a time" until the player leaves.
              Guest mode swaps this for `GuestBotWaiters` (issue #354) instead of omitting the section
              entirely — a small guest-scoped equivalent backed ONLY by the isolated guest instance's
              currently-resting Demo-Opponent bot-waiters (issue #351), never `challengesByGame`/the
              real WS aggregate (GUEST_MODE_CONTRACT.md §4's "no live human matchmaking with strangers"
              still holds — this never shows a real player, by construction of its own data source). */}
          {isGuest ? (
            <GuestBotWaiters
              gameId={gameId}
              balance={liveBalance}
              onTake={onTakeChallenge}
              joinDisabled={phase === 'in-match' || phase === 'waiting'}
            />
          ) : (
            <GamesCarousel
              challengesByGame={challengesByGame}
              nameByGame={nameByGame}
              balance={liveBalance}
              onTake={onTakeChallenge}
              onTakePublicChallenge={onTakePublicChallenge}
              loggedIn={loggedIn}
              joinDisabled={phase === 'in-match' || phase === 'waiting'}
            />
          )}

          {/* 5–8 — Related-games rail, Bring a Rival, footer: all point at the full registered
              platform (game grid / leaderboard / waitlist), none of which a curated guest session
              has. Omitted for guest mode. */}
          {!isGuest && (
            <>
              <RelatedRail related={related} onSelectGame={onSelectGame} />
              <BringARival />
            </>
          )}
        </div>

        {!isGuest && <HubFooter onGames={onOpenGameList} onRewards={onOpenRewards} />}
      </main>

      {/* Bottom nav (Games/Account) leads to the full game grid / profile — real-platform
          surfaces a guest session doesn't have. Omitted for guest mode. */}
      {!isGuest && (
        <HubToolbar
          onGames={navTo(onOpenGameList)}
          onAccount={navTo(onOpenWallet)}
          onRewards={navTo(onOpenRewards)}
          onMenu={(rect) => { chat.close(); menu.onMenu(rect); }}
          reportAnchorRect={menu.reportAnchorRect}
          onChat={openChat}
          active={chat.open ? 'chat' : menu.open ? 'menu' : 'games'}
        />
      )}
      {!isGuest && (
        <MenuOverlay
          open={menu.open}
          anchorRect={menu.anchorRect}
          onClose={menu.close}
          onOpenGames={onOpenGameList}
          onOpenRewards={onOpenRewards}
          onOpenAffiliate={onOpenAffiliate}
        />
      )}
      {!isGuest && (
        <ChatSheet
          open={chat.open}
          expanded={chat.expanded}
          messages={chat.messages}
          onClose={chat.close}
          onToggleExpanded={chat.toggleExpanded}
          onSend={chat.send}
        />
      )}

      {/* Opt-out games (Blackjack) suppress the pop-up and present the result on the board instead;
          the overlay stays the default for every other hub (the regression guard). */}
      {overlay && !suppressResultOverlay && (
        <ResultOverlay
          outcome={overlay.outcome}
          settlement={overlay.settlement}
          reveal={renderResultReveal?.({ outcome: overlay.outcome, gameState: overlay.revealState, playerId })}
          playerId={playerId ?? undefined}
          onDismiss={dismissResult}
        />
      )}
    </>
  );

  return (
    <div className={hubShellClass(isGuest)}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onOpenGameList} onWallet={onOpenWallet} loggedIn={loggedIn} isGuest={isGuest} />
      {/* T4 (issue #489): `pinDark` pins `bodyChrome` (everything except HubRibbon above) to
          `.dark`'s token values regardless of the app-wide theme — an interim fix for hubs whose
          own per-game files never got a light-mode pass (T1–T3 only threaded light overrides
          through the `--rc-*` token set, not the shadcn base tokens (`--background`/`--card`/…),
          so those hubs are accidentally frozen dark almost everywhere already; this makes it
          permanent and immune to future drift). `.dark` (index.css) is a complete mirror of
          `:root`'s dark values, so CSS custom properties inside this wrapper resolve to it instead
          of any inherited `data-theme="light"` override on `<html>`. HubRibbon is deliberately
          OUTSIDE this scope: it already threads `--rc-*` tokens correctly for light mode on its
          own (T2), including a JS-level logo asset swap keyed off the REAL resolved theme
          (`useTheme()` in HubRibbon.tsx) that a CSS-only scope can't override — wrapping it here
          would silently break that (dark-pinned background, but the light-mode logo asset, since
          `useTheme()` still reads the real app-wide theme → an illegible half-adjusted header).
          Opt-in per hub (Coinflip/Blackjack/Chess today, via `pinDark`); every other hub omits it,
          so `bodyChrome` renders with no extra wrapping DOM node — a byte-identical no-op. */}
      {pinDark ? <div className="dark">{bodyChrome}</div> : bodyChrome}
    </div>
  );
}

/** A fast, decorative name scan over real online players (~3–4/sec). Returns null when there are
 *  no online names — the slot then shows just "Searching…", never a fabricated alias. */
function useNameScan(active: boolean, names: string[]): string | null {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || names.length === 0) return;
    const id = setInterval(() => setI((n) => n + 1), 280); // ~3.5 names/sec
    return () => clearInterval(id);
  }, [active, names.length]);
  if (!active || names.length === 0) return null;
  return names[i % names.length];
}

/** Item 1/2 — the opponent slot above the board. Idle → neutral "Opponent"; Waiting → the
 *  "Searching…" beat with a decorative online-name scan; In-match/Result → the REAL opponent's
 *  name in bright white (or a neutral "Opponent" when the joiner's name never reached the client).
 *  Never an opponentId, never a fabricated/cycled name (Charter #2 + DEMO_PRESENTATION honesty). */
function OpponentSlot({ phase, opponentName, scanNames, aside, drawBeat, barShiftY, gemRow, gemText, gemTextVisible, oppLocked }: { phase: Phase; opponentName?: string | null; scanNames: string[]; aside?: ReactNode; drawBeat?: boolean; barShiftY?: number; gemRow?: ReactNode; gemText?: string; gemTextVisible?: boolean; oppLocked?: boolean }) {
  const searching = phase === 'waiting';
  const inMatch = phase === 'in-match' || phase === 'result';
  const scan = useNameScan(searching, scanNames);
  return (
    <div
      data-testid="hub-slot-opponent"
      // Ticket 2026-09-11#10 item 1: `data-rc-oppbar` + the translateY below are only ever present
      // for hubs that opt into `matchBarSlide` (RpsHub/MinesHub/DiceHub) — `barShiftY` is undefined
      // for every other hub, so neither the attribute nor the inline style render there at all.
      data-rc-oppbar={barShiftY != null ? '1' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5 transition-all duration-300',
        // Ticket 2026-09-12#1 item 1 (ADVISOR_TO_PM.md): the prototype's `data-rc-oppbar`/
        // `data-rc-playerbar` carry an explicit `z-index:3` (`Full Spec.html:436`/`:660`) — above the
        // VS label's `z-index:2` (`:432`, this hub's own `hub-match-vs` above) and the un-indexed
        // game-area card block. Without it, `barShiftY`'s `transform` creates a stacking context with
        // the default `z-index:auto`, so paint order falls back to DOM order — this pill mounts BEFORE
        // `renderGameArea` below, so the slide-to-center motion painted it BEHIND the RPS card. Only
        // ever applied for hubs that opt into the bar-slide mechanism (`barShiftY != null`); every
        // other hub's stacking is untouched.
        barShiftY != null && 'z-[3]',
        // Shared draw→rematch beat (#161): both bars flash the orange push outline for ~2 s.
        drawBeat && outlineClasses('draw'),
      )}
      style={barShiftY != null ? { transform: `translateY(${barShiftY}px)`, transition: 'transform 620ms cubic-bezier(0.3,0.9,0.32,1)' } : undefined}
    >
      {/* Ticket 2026-09-15#9 items 1-3: split into the prototype's own two-piece layout
          (`Full Spec.html:446/461`) — the avatar+name group on the left, blurred while searching
          (`oppBarBlur`, `:3800`), and "Searching…" as its own absolutely-positioned element on the
          right, instead of one inline flex row with both pieces side by side. The avatar now
          hashes from the (already ADR-010-stripped) scanned name while searching — matching the
          prototype's own `avForName` flicker — instead of staying the neutral default throughout. */}
      {/* Ticket 2026-09-17#2 item 2: `flex-1` on this avatar+name group is what makes the gem row
          (below) land at the bar's far right edge — it stretches to claim ALL remaining space
          regardless of how short the name is, leaving `gemRow` (shrink-0) nowhere to go but
          immediately after that now-enormous box. Drop `flex-1` here ONLY when a gem row is
          actually present (Mines only — `gemRow` is undefined everywhere else, so this is a
          byte-identical no-op for every other hub) and let `gemRow` itself claim the freed space
          instead (see its own span below). */}
      <span className={cn('flex items-center gap-2.5 transition-[filter] duration-300', gemRow ? 'shrink-0' : 'min-w-0 flex-1', searching && 'blur-[4.5px]')}>
        {/* NEUTRAL avatar outside search — the in-match opponent stays redacted: never their real
            name/avatar (Charter #2). Only the DECORATIVE scan (never the real opponent) drives it
            while actively searching. */}
        <Avatar avatarId={searching && scan ? avatarIdForName(scan) : 'default'} />
        {searching ? (
          scan && <span data-testid="hub-search-scan" className="min-w-0 truncate text-sm font-bold text-muted-foreground/50">{scan}</span>
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-sm font-bold', inMatch ? 'text-foreground' : 'text-muted-foreground')}>
            {inMatch ? (opponentName || 'Opponent') : 'Opponent'}
          </span>
        )}
      </span>
      {searching && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-pulse text-sm font-bold text-muted-foreground">
          Searching…
        </span>
      )}
      {/* Ticket 2026-09-16#7 item 5 / 2026-09-17#2 item 2: Mines-only gem-count row — a new sibling
          between the name and the aside/"Playing…" slot below. Now `flex-1 min-w-0` (not
          `shrink-0`) — paired with the name span above dropping ITS `flex-1` when a gem row is
          present, so the freed space actually goes to the gem row instead of the (now
          intrinsically-sized) name. `GemCountRow`'s own inner flex defaults to `justify-content:
          flex-start`, so it still left-aligns within that space rather than centering/stretching.
          Undefined for every other hub → nothing rendered here at all, byte-identical no-op. */}
      {gemRow && <span className="min-w-0 flex-1">{gemRow}</span>}
      {/* A per-game aside (e.g. chess clock) takes the right slot; otherwise the live "Playing…"
          tag — only while actually in-match (a persisted post-match board is not "playing").
          Ticket 2026-09-16#5 item 7: weight/case/tracking corrected against the prototype's own
          citation (`Full Spec.html:463`: font-weight:bold, no text-transform on the literal mixed-
          case "Playing...", letter-spacing:0.3px, font-size:13px) — was font-black/uppercase/
          tracking-wide/text-xs(12px), wrong in both themes. `text-foreground/70` (the color half) is
          left untouched — a separate, already-tracked GameHub.tsx light-theme token backlog
          (2026-09-15#9), not reopened here. Shared fallback: affects every game using it (RPS/Mines/
          Dice/Coinflip/Blackjack/Chess alike), not Mines-specific. */}
      {aside ? (
        <span className="flex shrink-0 items-center gap-2">{aside}</span>
      ) : (
        // Ticket 2026-09-21#10 (D37): was a plain conditional MOUNT (`phase === 'in-match' && ...`)
        // — popped in/out instantly, not the prototype's own cited `transition:opacity 260ms ease`
        // (Full Spec.html:462), which had never actually been implemented despite the citation.
        // Now always-mounted, opacity-toggled — genuinely fades for every game using this shared
        // label, not just Mines. `oppLocked` (new, opt-in — undefined for every hub but Mines, the
        // same "byte-identical no-op elsewhere" shape as oppGemRow/resultConverge) additionally
        // hides it the moment the opponent's OWN round ends, closing the real gap: `phase` alone
        // stays 'in-match' through the whole post-lock holdResultMs window, which spans Mines' own
        // resultPhase converge→reveal→final sequence — so "Playing…" (knowing nothing about
        // resultPhase) used to keep showing well after the opponent's gem strip had already faded
        // in, colliding with it in the same bar. For every other game, `oppLocked` is undefined →
        // `!undefined` → `true` → this reduces to exactly `phase === 'in-match'`, byte-identical to
        // before.
        // Ticket 2026-09-22#3 (D40): a direct regression from the always-mounted switch above —
        // `shrink-0` is in-flow, so even at opacity:0 it still reserved its own natural width,
        // squeezing the gem strip's own `flex-1` sibling down to ~1/3 width (wrapping 3 rows
        // instead of ~2). Reuses the same fix already proven correct one element above for
        // "Searching…" (`absolute right-3.5 top-1/2 -translate-y-1/2`) — the prototype's own source
        // stacks both labels in the literal SAME absolutely-positioned slot (`Full Spec.html:461`),
        // mutually exclusive by opacity, one shared spot by design. Parent is already `relative` —
        // no new positioning context needed.
        <span
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-bold tracking-[0.3px] text-foreground/70"
          style={{ opacity: phase === 'in-match' && !oppLocked ? 1 : 0, transition: 'opacity 260ms ease' }}
        >
          Playing…
        </span>
      )}
      {/* Ticket 2026-09-17#3 item 2: the gem-count CAPTION — see `GameHubProps.oppGemText`'s own doc
          comment for the citation. Sits outside the pill (bottom:calc(100% + 6px)), so it moves with
          the bar during the converge slide for free, being an ordinary DOM descendant of it. */}
      {gemText && (
        <span
          data-testid="hub-gem-text-opponent"
          className="absolute z-[1] text-[13px] font-bold text-[var(--rc-green)]"
          style={{
            right: 4,
            bottom: 'calc(100% + 6px)',
            fontFamily: SPACE_GROTESK,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            opacity: gemTextVisible ? 1 : 0,
            transition: 'opacity 320ms ease',
          }}
        >
          {gemText}
        </span>
      )}
    </div>
  );
}

/** Item 1/6 — the player's own slot below the board: their name, with an optional per-game aside
 *  (Blackjack's Hit/Stand in-match, Chess's clock) rendered beside it.
 *  When `barVerdict` is set (Coinflip + Blackjack opt-in): all three verdicts settle to the shared
 *  ring outline (win → ring-success, loss → ring-destructive, draw → ring-amber-400). A win first
 *  plays the SHARED win animation (`useWinReveal`): a green fill + "You Win" kept ALONGSIDE the
 *  username (never swapped out), the green a background layer — 0.5 s fill-in → 2 s hold → 0.5 s
 *  fade-out → the persistent green outline. Loss/draw are outline-only (no fill/text). */
function OwnSlot({ label, username, avatarId = 'default', isOwn, aside, barVerdict, drawBeat, barShiftY, lossRingColor, winRingColor, winFillColor, drawRingColor, gemRow, gemText, gemTextVisible }: { label: string; username?: string | null; avatarId?: AvatarId; isOwn: boolean; aside?: ReactNode; barVerdict?: Verdict | null; drawBeat?: boolean; barShiftY?: number; lossRingColor?: string; winRingColor?: string; winFillColor?: string; drawRingColor?: string; gemRow?: ReactNode; gemText?: string; gemTextVisible?: boolean }) {
  const win = barVerdict === 'win';
  const { contentVisible, fillShown, settled } = useWinReveal(win);

  return (
    <div
      data-testid="hub-slot-own"
      // Ticket 2026-09-11#10 item 1: see OpponentSlot's matching comment above — `data-rc-playerbar`
      // + the inline transform are opt-in via `barShiftY`, undefined (byte-identical no-op) for
      // every hub that doesn't pass `matchBarSlide`.
      data-rc-playerbar={barShiftY != null ? '1' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5 transition-all duration-300',
        // Ticket 2026-09-12#1 item 1 (ADVISOR_TO_PM.md): see `OpponentSlot`'s matching comment above —
        // explicit `z-[3]` (`Full Spec.html:436`/`:660`), opt-in via `barShiftY != null` only.
        barShiftY != null && 'z-[3]',
        // All three settle to the shared ring; the win ring only lands once the fill has run.
        // Ticket 2026-09-15#13 item 2: an opt-in `lossRingColor` (Dice only, today) swaps the
        // Tailwind `ring-destructive` class for an inline ring of that exact color — every other
        // caller (no `lossRingColor` passed) keeps today's shared class byte-identical.
        barVerdict === 'lose' && (lossRingColor ? 'ring-[3px]' : 'ring-[3px] ring-destructive'),
        // Ticket 2026-09-16#7 item 4: same shape again — an opt-in `drawRingColor` (Mines only,
        // today) swaps the shared `ring-amber-400` for Mines' own #FF8A1E.
        barVerdict === 'draw' && (drawRingColor ? 'ring-[3px]' : 'ring-[3px] ring-amber-400'),
        // Ticket 2026-09-16#4 item 4: same shape as `lossRingColor` above — an opt-in `winRingColor`
        // (Dice only, today) swaps `outlineClasses('win')`'s `ring-success`/glow-shadow classes for a
        // plain inline-colored ring (no glow, matching the loss side's own precedent), so Dice's win
        // ring can be `DICE_WIN_GREEN` (#16A34A) instead of the shared `--rc-green`.
        win && settled && (winRingColor ? 'ring-[3px]' : outlineClasses('win')),
        // In-match draw→rematch beat (#161): the same orange push outline as the opponent bar.
        drawBeat && outlineClasses('draw'),
      )}
      style={{
        ...(barShiftY != null ? { transform: `translateY(${barShiftY}px)`, transition: 'transform 620ms cubic-bezier(0.3,0.9,0.32,1)' } : undefined),
        ...(barVerdict === 'lose' && lossRingColor ? { '--tw-ring-color': lossRingColor } as CSSProperties : undefined),
        ...(barVerdict === 'draw' && drawRingColor ? { '--tw-ring-color': drawRingColor } as CSSProperties : undefined),
        ...(win && settled && winRingColor ? { '--tw-ring-color': winRingColor } as CSSProperties : undefined),
      }}
    >
      {/* Green celebration fill — a background LAYER behind the content (never replaces the username).
          Fades in over 0.5 s, holds 2 s, fades out over 0.5 s (same duration both ways), then unmounts.
          Ticket 2026-09-16#4 item 4: an opt-in `winFillColor` (Dice only) swaps the shared `bg-success`
          class for an inline background of that exact color — every other caller is unaffected. */}
      {contentVisible && (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: fillShown ? 1 : 0 }}
          transition={{ duration: WIN_FILL_IN_MS / 1000, ease: 'easeOut' }}
          className={cn('pointer-events-none absolute inset-0 rounded-full', !winFillColor && 'bg-success')}
          style={winFillColor ? { background: winFillColor } : undefined}
        />
      )}
      {/* Own avatar — per-user LIGHT disc + darkened glyph, derived from the username (no username →
          NEUTRAL, e.g. logged out / legacy session). Sits above the win-fill layer (z-10). */}
      <Avatar username={username} avatarId={avatarId} className="relative z-10" />
      {/* Username stays put in every state; white over the green fill, back to normal once it fades.
          Ticket 2026-09-17#2 item 2: `flex-1` dropped when a gem row is present — see the matching
          comment on `OpponentSlot`'s own name span above for why. */}
      <span
        className={cn('relative z-10 truncate text-sm font-bold transition-colors duration-300', gemRow ? 'shrink-0' : 'min-w-0 flex-1', contentVisible ? 'text-white' : isOwn ? 'text-foreground' : 'text-muted-foreground')}
      >
        {label}
      </span>
      {/* "you won" — Ticket 2026-09-17#6 (D28) items 2-4, fixing all three at once:
          Item 2 (position): the citation has this as a SEPARATE position:absolute span at the
          bar's own top level (right:18px; top:50%; transform:translateY(-50%)), not a flex-row
          sibling — pulled out of the row entirely, matching the fill layer's own sibling approach.
          Item 3 (content): was "You Win" (title case) PLUS Tailwind's `uppercase` class forcing it
          to render as "YOU WIN" regardless of the JSX string — both needed to go; the citation wants
          lowercase "you won". Font swapped to the citation's exact values: bold (not extrabold),
          16px (not text-sm/14px), letter-spacing 0.6px (not tracking-wide), ARIAL (this file's own
          shared constant, already used identically for the VS label — not a second literal).
          Item 4 (timing): the citation's own rcWinText keyframe (Full Spec.html:70) holds opacity 0
          through 8% of the 3000ms total (240ms) before ramping to 1 by 20% (600ms) — a deliberate
          stagger behind the fill's own faster ramp (rcWinFill hits 1 by 16.7%/501ms — already
          matching WIN_FILL_IN_MS=500, no change needed there). Fade-out timing is unchanged for both
          (both hold to 83.4%, fade to 0 by 100%). A single keyframe-array + times animation (rather
          than the fill's simpler fillShown-toggle) hits these exact cited percentages directly. */}
      {contentVisible && (
        <motion.span
          data-testid="hub-slot-own-verdict"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0, 1, 1, 0] }}
          transition={{ times: [0, 0.08, 0.2, 0.834, 1], duration: (WIN_FILL_IN_MS + WIN_HOLD_MS + WIN_FADE_OUT_MS) / 1000, ease: 'easeOut' }}
          className="pointer-events-none absolute z-[1] font-bold text-white"
          style={{ right: 18, top: '50%', transform: 'translateY(-50%)', fontFamily: ARIAL, fontSize: 16, letterSpacing: '0.6px' }}
        >
          you won
        </motion.span>
      )}
      {/* Ticket 2026-09-16#7 item 5 / 2026-09-17#2 item 2: see `OpponentSlot`'s matching comment
          above (`flex-1 min-w-0`). Ticket 2026-09-17#6 (D28) item 1: dropped `relative z-10` — the
          win-fill layer is z-1, so z-10 put the gem strip ABOVE it instead of below (Designer's own
          diagnosis, confirmed by direct read). `min-w-0 flex-1` is unrelated to stacking and stays. */}
      {gemRow && <span className="min-w-0 flex-1">{gemRow}</span>}
      {aside && <span className="relative z-10 flex shrink-0 items-center gap-2">{aside}</span>}
      {/* Ticket 2026-09-17#3 item 2: see `OpponentSlot`'s matching comment above — same mechanism,
          mirrored to the OTHER side of the bar (`top:calc(100% + 6px)`, not `bottom`). */}
      {gemText && (
        <span
          data-testid="hub-gem-text-own"
          className="absolute z-[1] text-[13px] font-bold text-[var(--rc-green)]"
          style={{
            right: 4,
            top: 'calc(100% + 6px)',
            fontFamily: SPACE_GROTESK,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            opacity: gemTextVisible ? 1 : 0,
            transition: 'opacity 320ms ease',
          }}
        >
          {gemText}
        </span>
      )}
    </div>
  );
}

/** The unified play panel (PLAY + bet grid + optional time control + Play-a-Friend). It is ALWAYS
 *  mounted and transforms in place across states (#154), never swapped for a separate block:
 *  `playing` freezes it during a match (PLAY reads "Playing…", controls grey but stay); `searching`
 *  is the pure-search state (the hub supplies the "Waiting for an opponent · m:ss" actionSlot and
 *  Play-a-Friend becomes the active Cancel, while the bet row freezes with the SAME visuals — but
 *  NO "Playing…" label); `noOpponent` shows the polite "No opponent found" note after expiry. */
function PlayPanel({
  playing, searching, noOpponent, armedStake, onArm, onPlay, onCancel, actionSlot, secondaryActionSlot, timeControl, selectedControl, onSelectControl, excludedStakes, isGuest, highStakeCycle,
}: {
  playing: boolean;
  /** Pure search: freeze the bet row (no "Playing…") and turn Play-a-Friend into the active Cancel. */
  searching: boolean;
  /** Search expired with no opponent → show the polite "No opponent found — try again" note. */
  noOpponent: boolean;
  armedStake: number | null;
  onArm(v: number): void;
  onPlay(): void;
  /** Cancel the in-flight search (the hardened leaveQueue path, #153). */
  onCancel(): void;
  /** Presets to withhold from the offered bet grid entirely (issue #353) — e.g. guest mode
   *  withholds `GUEST_HUMAN_RESERVED_STAKE` so a guest can never select or post it. Enforced by
   *  never rendering the preset as an option, not by disabling it in place. Independent of
   *  playing/searching (those freeze the WHOLE grid via `frozen`; this narrows WHICH values are
   *  ever offered). Default: none (every other hub is unaffected, offers the full BET_PRESETS
   *  range). */
  excludedStakes?: readonly number[];
  /** When provided, replaces the PLAY button in place — the game's transforming primary action
   *  (e.g. Crash's EJECT during flight, or the hub's waiting label during search). Null → the
   *  default PLAY button (the #1-bug fix: ONE button that transforms, never a second control). */
  actionSlot?: ReactNode;
  /** When provided (and not searching), replaces the Play-a-Friend button in place — the game's
   *  transforming SECONDARY action (Chess's Draw request ⇄ Revoke DRAW). Null → the default. */
  secondaryActionSlot?: ReactNode;
  timeControl?: GameMeta['timeControl'];
  selectedControl?: string;
  onSelectControl(id: string): void;
  /** T9: registered users see a cosmetic `$`-formatted bet amount instead of the play-money
   *  `<Credits>`/RC-coin glyph — same precedent `HubRibbon.tsx`'s wallet chip already set for the
   *  header balance (Owner-approved `$` skin, `CHARTER.md` #4). Bypasses `<Credits>` entirely for
   *  this one call site rather than touching its "never $" contract. Guests keep `<Credits>`
   *  unchanged. Default false (guest) so existing non-GameHub callers — none today — stay safe. */
  isGuest?: boolean;
  /** Ticket 2026-09-12: opt-in per-hub high-stake escalation cycle (ChessHub only today) — see the
   *  `GameHubProps.highStakeCycle` doc comment above for the full mechanism. `highStakeCycle[0]`
   *  is the existing `BET_PRESETS` entry (100) whose tap-again gesture is generalized; the rest of
   *  the array are stakes reachable only through that one button's cycling state, exactly like `2`
   *  is today reachable only through the "1" button's #381 gesture. Undefined for every hub that
   *  doesn't pass it (byte-identical no-op). */
  highStakeCycle?: readonly number[];
}) {
  // Both a live match and a pure search freeze the bet controls with the identical greyed/inert
  // treatment — the ONLY difference is the primary label (search shows the waiting slot, not
  // "Playing…") and that Play-a-Friend becomes Cancel during search.
  const frozen = playing || searching;
  // The offered presets, minus anything withheld (issue #353) — computed once per render rather
  // than filtered inline in the JSX below so the grid-column count (right below) can agree with it.
  const presets = excludedStakes?.length ? BET_PRESETS.filter((v) => !excludedStakes.includes(v)) : BET_PRESETS;

  // Ticket 2026-09-11#8/A: bet-panel light/dark colors + the sliding-indicator track math.
  const { resolved } = useTheme();
  const light = resolved === 'light';
  // Ticket 2026-09-16#2: the currency-name row below must follow the wallet's actual selection
  // (`useCurSel()`, already wired into HubRibbon/GamesCarousel/RewardsHub) — this row was the one
  // consumer still hardcoded to "USD". Guest mode is untouched (its RC-icon/'RC'-label branch is a
  // separate, deliberate surface, not currency-aware at all).
  const { curSel } = useCurSel();
  // The armed preset's index within the OFFERED grid (accounts for the #381 tap-again gesture:
  // stake 2 lights the `v === 1` slot, same slot 1 renders in). -1 (no bet armed, or an armed
  // value outside the offered grid) hides the indicator entirely, same as the prototype's own
  // `betValueOp` gate on both the value row and the indicator (`Full Spec.html:708,716`).
  // Ticket 2026-09-12: generalizes the #381 check above — a preset's slot also lights up for
  // `armedStake` when it's the `highStakeCycle` anchor (v === highStakeCycle[0]) and the armed
  // stake is somewhere else IN that cycle (never its own BET_PRESETS entry, same idiom as `2`).
  const armedInHighStakeCycle = highStakeCycle != null && armedStake != null && highStakeCycle.includes(armedStake);
  const armedIndex = presets.findIndex((v) => (
    armedStake === v || (v === 1 && armedStake === 2) || (highStakeCycle != null && v === highStakeCycle[0] && armedInHighStakeCycle)
  ));
  // Track math ported 1:1 from `Full Spec.html:3739` (`betIndLeft`) / `:716` (indicator width),
  // generalized from the prototype's hardcoded 6-column case to whatever count is actually
  // offered (5 when a guest's reserved stake is withheld, issue #353) — same 5px padding / 2px
  // inter-chip gap either way (`:715`'s track `padding:5px` + `gap:2px`).
  const BET_TRACK_PAD_PX = 5;
  const BET_TRACK_GAP_PX = 2;
  const betTrackNonContentPx = BET_TRACK_PAD_PX * 2 + (presets.length - 1) * BET_TRACK_GAP_PX;
  const betIndicatorWidth = `calc((100% - ${betTrackNonContentPx}px) / ${presets.length})`;
  const betIndicatorLeft = `calc(${BET_TRACK_PAD_PX}px + ${Math.max(0, armedIndex)} * (${betIndicatorWidth} + ${BET_TRACK_GAP_PX}px))`;
  // "PLAY needs a bet" guided affordance (#143). PLAY stays enabled with no stake armed; pressing
  // it then GUIDES the user to the bet panel (smooth-scroll + red frame + a11y hint) instead of
  // dead-ending — it never starts a match. The cue clears the instant a bet is armed (no auto-play).
  const betRef = useRef<HTMLDivElement>(null);
  const [needsBet, setNeedsBet] = useState(false);
  // Ticket 2026-09-15#13 item 1: the PLAY button's own shake nudge — the prototype's `nudgePlay()`
  // (`Full Spec.html:3043-3047`), self-clearing after its own duration so a rapid repeat press
  // restarts cleanly (the clearTimeout guard mirrors the prototype's own re-trigger guard). Fired
  // from `guideToBet()` below, the single shared guard both PLAY and Play-a-Friend call through.
  const [playShake, setPlayShake] = useState(false);
  const playShakeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(playShakeTimeoutRef.current), []);

  // Clear the cue the moment a stake is armed (any path: preset, initialStake, external) and
  // whenever the panel freezes for a live match. Arming only clears the guide — it never presses
  // PLAY; the user does that themselves on their next tap.
  useEffect(() => { if (armedStake != null) setNeedsBet(false); }, [armedStake]);
  useEffect(() => { if (frozen) setNeedsBet(false); }, [frozen]);

  // The shared guard. Scroll the BET panel into view (centered → clears the fixed top ribbon and
  // bottom nav; the scroll-margins below add explicit nav + safe-area clearance, robust to the
  // body-scroll change in #142) and raise the red needs-bet frame + hint. Starts no match.
  function guideToBet() {
    // Ticket 2026-09-18#2 item 3: the shared guard for BOTH rejection moments that route through
    // it — PLAY pressed with no bet armed, and an unarmed Play-a-Friend press (see
    // handlePlayFriend's own separate call for the ARMED Play-a-Friend case, which never reaches
    // this function at all).
    play('reject');
    setNeedsBet(true);
    betRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearTimeout(playShakeTimeoutRef.current);
    setPlayShake(true);
    playShakeTimeoutRef.current = setTimeout(() => setPlayShake(false), 560);
  }
  function handlePlayPress() {
    if (armedStake == null) { guideToBet(); return; } // no bet → guide; do NOT start a match
    // Ticket 2026-09-12#3 item 1: the prototype's ONE shared PLAY handler (`playMines()`,
    // `Full Spec.html:3830-3833`) fires `this.sfx('play')` unconditionally, before any per-game
    // branching, as the very first line — this IS that same shared button, so wiring the sound
    // here gives every hub (RPS/Mines/Dice/Chess/Coinflip alike) the click for free, matching the
    // prototype's own scope exactly. It fires only once a match is actually starting, never on the
    // guideToBet() early-return above (the prototype's own intent: the sound marks a real play).
    play('play');
    onPlay();
  }
  // Play a Friend is inert/visual-only (owner D1). The guard is pre-wired so that WHEN that path
  // activates and requires a stake, an unarmed press guides to the bet panel exactly like PLAY.
  // The friend flow itself is not built, so an armed press still does nothing (no behaviour change).
  function handlePlayFriend() {
    if (armedStake == null) { guideToBet(); return; }
    // Ticket 2026-09-18#2 item 3: an armed press is a real, live no-op today (the flow below isn't
    // built yet) — Owner's own cited example of a rejection with no signal at all.
    play('reject');
    /* TODO(D1): launch the friend-invite flow with the armed stake. */
  }

  return (
    <div data-testid="hub-section-play" className="flex flex-col gap-3.5 rounded-[18px] bg-surface p-4">
      {/* The ONE primary action. Default = PLAY (always full purple, always pressable; an unarmed
          press guides to the bet panel — #143; in-match → "Playing…" disabled). A game may
          transform it in place via actionSlot. */}
      {actionSlot ?? (
        <button
          type="button"
          disabled={playing}
          onClick={handlePlayPress}
          data-testid="hub-play"
          className={cn(
            'w-full rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white active:translate-y-[3px]',
            playing ? 'opacity-70' : 'hover:brightness-110',
          )}
          // Ticket 2026-09-11#8/A item 3: the chunky "pressable ledge" (`Full Spec.html:695`'s
          // `box-shadow:{{ playBtnShadow }}`, `PLAY_BTN_SHADOW` above) released via
          // `translateY(3px)` on press (`:695`'s own `style-active`). Per-property durations cited
          // verbatim from the same line's `transition` value — box-shadow/opacity survive the
          // Tailwind `transition-colors` this button already had; only transform is added new.
          // Ticket 2026-09-15#13 item 1: playShakeAnim (Full Spec.html:3828), fired by guideToBet()
          // on an unarmed press — the same easing/duration the prototype uses verbatim.
          style={{
            boxShadow: PLAY_BTN_SHADOW,
            transition: 'box-shadow 260ms ease, transform 120ms ease, opacity 220ms ease, filter 150ms ease',
            animation: playShake ? 'rcPlayShake 540ms cubic-bezier(0.36,0.07,0.19,0.97) both' : undefined,
          }}
        >
          {playing ? 'Playing…' : 'Play'}
        </button>
      )}

      {/* Expiry note (#154): the search timed out with no opponent. Polite live region (same
          pattern as the #143 needs-bet hint) — sr-only until it fires, cleared on the next PLAY
          (App resets lobbyExpired on re-post). Does NOT claim a refund (already auto-refunded). */}
      <p
        role="status"
        aria-live="polite"
        data-testid="hub-no-opponent"
        className={cn('-mt-1 text-center text-xs font-semibold text-muted-foreground', !noOpponent && 'sr-only')}
      >
        {noOpponent ? 'No opponent found — try again' : ''}
      </p>

      {/* Bet amount — stays visible during a match OR a search, greyed + inert (same treatment).
          Ticket 2026-09-15#13 item 1: the needs-bet ring (#143) moved OFF this wrapper — it now
          lives on the bet-track pill itself (data-rc-bettrack below), matching the prototype's own
          citation exactly (`betWarnRing`, a box-shadow on that one element, not the whole panel).
          scroll-mt clears the fixed top ribbon (~6rem); scroll-mb clears the fixed bottom nav
          (~7rem) + safe-area so a scrolled-in panel lands ABOVE the nav (robust to #142). */}
      <div
        ref={betRef}
        data-testid="hub-section-bet"
        data-needs-bet={needsBet || undefined}
        className={cn(
          'scroll-mt-24 scroll-mb-[calc(7rem_+_env(safe-area-inset-bottom))] rounded-xl',
          frozen && 'pointer-events-none opacity-50',
        )}
      >
        {/* Ticket 2026-09-11#8/A item 1: the currency-name + live-bet-value row, missing entirely
            before this — the old "Bet amount" plain caption is replaced by the prototype's actual
            two-sided row (`Full Spec.html:703-709`). Left: currency icon + `{{curSym}} (democash)`
            (`:705-706`). Right: a second (smaller) icon + the armed stake in green (`:709-710`),
            faded out via `betValueOp` (`:708`) until a bet is armed — kept mounted (not
            conditionally rendered) so the 200ms opacity transition can run, matching the
            prototype's own always-bound style prop. `role="group"` carries the accessible label
            the old visible caption used to (the prototype itself has no separate text label here). */}
        <div role="group" aria-label="Bet amount" className="mb-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-[7px]">
            {isGuest ? <RcIcon size={17} /> : <CurrencyIcon sym={curSel} size={17} />}
            <span className="text-foreground" style={{ fontFamily: ARIAL, fontSize: '12px', fontWeight: 700, letterSpacing: '1.2px' }}>
              {isGuest ? 'RC' : curSel} <span style={{ fontSize: '10px', letterSpacing: '0.6px' }}>(democash)</span>
            </span>
          </div>
          <div
            className="flex shrink-0 items-center gap-[5px]"
            style={{ opacity: armedStake == null ? 0 : 1, transition: 'opacity 200ms ease' }}
          >
            {isGuest ? <RcIcon size={15} /> : <CurrencyIcon sym={curSel} size={15} />}
            <span className="text-success tabular-nums" style={{ fontFamily: SPACE_GROTESK, fontSize: '14px', fontWeight: 700 }}>
              {isGuest ? (armedStake ?? 0).toLocaleString('en-US') : `$${(armedStake ?? 0).toLocaleString('en-US')}`}
            </span>
          </div>
        </div>
        {/* Ticket 2026-09-11#8/A item 2: one shared pill/ribbon track with a sliding purple
            indicator (`Full Spec.html:715-716`), replacing the previous per-button boxed
            bg-brand/bg-background treatment — a real restructuring, not a recolor. Track:
            `border-radius:999px`, `padding:5px`, `gap:2px`, background `BET_TRACK_BG` (`:715`,
            `:3734`). The indicator is an `absolute` sibling (`:716`) — NOT per-button background —
            sized/positioned by the `betIndicatorWidth`/`betIndicatorLeft` calc() ported from
            `:3739` above (generalized from the prototype's fixed 6-column case to however many
            presets are actually offered, issue #353's guest exclusion). grid-template-columns
            replaces the old grid-cols-6/grid-cols-5 ternary with the same repeat(n, 1fr) the
            prototype itself uses (`:715`), agreeing with `presets.length` by construction instead
            of a hardcoded two-count ternary. */}
        <div
          data-rc-bettrack="1"
          className="relative grid rounded-full p-[5px]"
          style={{
            background: light ? BET_TRACK_BG.light : BET_TRACK_BG.dark,
            gridTemplateColumns: `repeat(${presets.length}, 1fr)`,
            gap: `${BET_TRACK_GAP_PX}px`,
            // Ticket 2026-09-15#13 item 1: the needs-bet ring itself (betWarnRing, Full
            // Spec.html:3736) — same hue at zero alpha/zero spread when off, so the transition is
            // a clean fade rather than a hard cut.
            boxShadow: needsBet ? '0 0 0 2px var(--rc-loss)' : '0 0 0 0 rgba(255,62,94,0)',
            transition: 'box-shadow 260ms ease',
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[5px] bottom-[5px] rounded-full"
            style={{
              width: betIndicatorWidth,
              left: betIndicatorLeft,
              background: BET_INDICATOR_BG,
              opacity: armedIndex < 0 ? 0 : 1,
              transition: 'left 420ms cubic-bezier(0.34,1.32,0.44,1), opacity 220ms ease',
            }}
          />
          {presets.map((v) => {
            // Ticket 2026-09-12: this preset's slot shows the escalated `armedStake` instead of its
            // own face value when it's the `highStakeCycle` anchor and the armed stake is somewhere
            // in that cycle — no prototype source (product decision), same shape as the #381 `v===1`
            // clause right below it.
            const isHighStakeAnchor = highStakeCycle != null && v === highStakeCycle[0];
            const displayValue = v === 1 && armedStake === 2 ? 2
              : isHighStakeAnchor && armedInHighStakeCycle ? (armedStake as number)
              : v;
            // Plain colored text sitting on top of the track (`c.color`, `:3741` — white when
            // selected, `var(--rc-green)` otherwise) — no per-button border/background anymore.
            const selected = armedStake === v || (v === 1 && armedStake === 2) || (isHighStakeAnchor && armedInHighStakeCycle);
            return (
              <button
                key={v}
                type="button"
                disabled={frozen}
                data-testid={`hub-bet-${v}`}
                aria-pressed={selected}
                // #381: the 1¢ preset is special-cased to reach the undocumented, bot-excluded
                // stake of 2 (tools/bot-crowd's HUMAN_RESERVED_STAKES) via a tap-again gesture —
                // tapping again while 1 is armed arms 2; tapping again while 2 is armed toggles
                // back to 1. Every other preset keeps its plain onArm(v). 2 is never its own
                // BET_PRESETS entry / grid button — only reachable through this one button's state.
                // Ticket 2026-09-12: generalizes the SAME gesture shape to `highStakeCycle` (Chess's
                // "100" button, PM-scoped — no prototype source, this is a product decision) via
                // `nextInCycle`; checked after the `v===1` branch so the two never collide (kept
                // fully separate per the ticket) even though `highStakeCycle[0]` is never `1` today.
                onClick={
                  v === 1 ? () => onArm(armedStake === 1 ? 2 : 1)
                  : isHighStakeAnchor ? () => onArm(nextInCycle(highStakeCycle!, armedStake))
                  : () => onArm(v)
                }
                className="relative z-10 min-w-0 rounded-full py-2.5 text-center text-[13px] font-bold tabular-nums"
                style={{ fontFamily: SPACE_GROTESK, color: selected ? '#FFFFFF' : 'var(--rc-green)' }}
              >
                {isGuest ? <Credits amount={displayValue} /> : `$${displayValue.toLocaleString('en-US')}`}
              </button>
            );
          })}
        </div>

        {/* Not colour-alone (#143): a short text hint paired with a polite live region for
            colourblind / screen-reader users. Always mounted as the live region (so the change is
            announced); shows the red hint only in the needs-bet state, clearing with the frame.
            Ticket 2026-09-15#13 item 1: three corrections — copy ("Select a bet amount to play" →
            the prototype's exact "Choose your bet"), color (text-destructive → the new
            theme-invariant var(--rc-loss) token, not the shared destructive/danger reds), and
            mechanism (an instant sr-only toggle → a real max-height 0→26px + opacity 0→1 collapse,
            `overflow:hidden`, matching the prototype's betWarnH/betWarnOp exactly — confirmed
            genuinely different from an instant show/hide, not a cosmetic nit). One element instead
            of the prototype's wrapper+span pair — max-height clips the padding along with the
            text either way, so the visual effect is identical with less markup. */}
        <p
          role="status"
          aria-live="polite"
          data-testid="hub-bet-hint"
          className="overflow-hidden text-xs font-semibold"
          style={{
            color: 'var(--rc-loss)',
            paddingTop: 7,
            maxHeight: needsBet ? 26 : 0,
            opacity: needsBet ? 1 : 0,
            transition: 'max-height 260ms ease, opacity 220ms ease',
          }}
        >
          {needsBet ? 'Choose your bet' : ''}
        </p>

        {/* Time-control picker — shown only for games that declare one (chess). Each option is a
            two-line button: the large duration over the small mode name (e.g. "10 min" / "Rapid"). */}
        {timeControl && (
          <div data-testid="hub-section-timecontrol" className="mt-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Time control</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {timeControl.options.map((o) => {
                const selected = selectedControl === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={frozen}
                    data-testid={`hub-tc-${o.id}`}
                    aria-pressed={selected}
                    aria-label={o.label}
                    onClick={() => onSelectControl(o.id)}
                    className={cn(
                      'flex flex-col items-center justify-center rounded-lg px-2 py-2.5 text-center leading-tight transition-colors',
                      selected ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className="text-sm font-extrabold">{tcDuration(o.baseMs)}</span>
                    <span className={cn('mt-0.5 text-[10px] font-bold uppercase tracking-wide', selected ? 'text-white/75' : 'text-muted-foreground')}>
                      {tcName(o.label)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Play a Friend transforms IN PLACE into the one active Cancel during a search (#154) — same
          button node, so no remount. Searching → "Cancel", active, wired to the hardened leaveQueue
          (#153). A game may transform it in place via secondaryActionSlot (Chess: Draw request ⇄
          Revoke DRAW in-match). Otherwise → purple, inert/visual-only (owner D1); greys with the
          panel in-match. The #143 needs-bet guard stays pre-wired for the idle Play-a-Friend path. */}
      {!searching && secondaryActionSlot ? (
        secondaryActionSlot
      ) : (
        <button
          type="button"
          {...(searching ? {} : { 'aria-disabled': 'true' as const })}
          data-testid={searching ? 'hub-cancel' : 'hub-play-friend'}
          onClick={searching ? onCancel : handlePlayFriend}
          className={cn(
            'w-full rounded-xl py-3.5 text-[15px] font-bold transition-colors',
            searching ? 'bg-surface text-foreground hover:brightness-110' : 'cursor-default bg-brand text-white active:translate-y-[3px]',
            playing && 'opacity-50',
          )}
          // Ticket 2026-09-11#8/A item 3: same pressable-ledge shadow as PLAY. The prototype's own
          // "Play a Friend" div (`Full Spec.html:729`) doesn't literally carry `box-shadow` at that
          // citation — this applies the ticket's own instruction to add the site's universal purple-
          // CTA shadow (`playBtnShadow`'s base value, also seen e.g. `:1356`,`:2474`,`:3823`) here
          // too, for visual consistency with PLAY. Only the Play-a-Friend state gets it — the
          // transformed "Cancel" state (`bg-surface`, not a purple CTA) is untouched, matching the
          // ticket's scope (PLAY + Play a Friend only).
          style={searching ? undefined : { boxShadow: PLAY_BTN_SHADOW, transition: 'box-shadow 260ms ease, transform 120ms ease, opacity 220ms ease, filter 150ms ease' }}
        >
          {searching ? 'Cancel' : 'Play a Friend'}
        </button>
      )}

      {/* Ticket 2026-09-11#8/A item 4: "PROVABLY FAIR BY DESIGN" + shield-check icon, confirmed via
          grep to not exist anywhere in apps/web/src before this — ported verbatim from
          `Full Spec.html:729-745` (`data-rc-betpanel="1"` sibling directly below Play a Friend,
          unconditional — no `searching` gate in the source, so this always renders). Caption:
          11px bold, `letter-spacing:0.9px`, color `PROVABLY_FG` (`:733`, `:3607`). Icon: the same
          shield outline/shading `AffiliateHub.tsx`'s `ShieldIcon` already ports (base `#8B45F0` +
          `#A870F0` shade + `#BFB8D6` shine, clipped to the shield outline) with THIS badge's own
          checkmark glyph (`:738`, white stroke) instead of that one's lightning bolt, plus the two
          `var(--rc-text)` sparkle accents (`:739-740`), all traced 1:1 from the cited lines. */}
      <div data-rc-betpanel="1" className="-mt-1 flex items-center justify-center gap-2">
        <span style={{ fontFamily: ARIAL, fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.9px', color: light ? PROVABLY_FG.light : PROVABLY_FG.dark }}>
          PROVABLY FAIR BY DESIGN
        </span>
        <ProvablyFairShieldIcon />
      </div>
    </div>
  );
}

/** Full Spec.html:734-744 — the shield-check icon beside "PROVABLY FAIR BY DESIGN" (ticket
 *  2026-09-11#8/A item 4). Same shield outline/clip-path convention as `AffiliateHub.tsx`'s
 *  `ShieldIcon`, own clip id (`pfShieldClip`) to avoid colliding with that component's
 *  `affShieldClip` if both ever render on the same page. */
function ProvablyFairShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" className="block flex-none overflow-visible" aria-hidden="true">
      <defs>
        <clipPath id="pfShieldClip">
          <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" />
        </clipPath>
      </defs>
      <g clipPath="url(#pfShieldClip)">
        <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill="#8B45F0" />
        <path d="M12 2.2 3.6 5v6.6c0 5 3.5 8.6 8.4 10.2z" fill="#A870F0" />
        <path d="M12 2.2 20.4 5 3.6 21.8z" fill="#BFB8D6" opacity="0.28" />
      </g>
      <path d="M8.1 12.2 10.9 15 16 9.4" fill="none" stroke="#FFFFFF" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.4 3.6l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75z" fill="var(--rc-text)" />
      <path d="M2 15.9l.55 1.5 1.5.55-1.5.55-.55 1.5-.55-1.5-1.5-.55 1.5-.55z" fill="var(--rc-text)" />
    </svg>
  );
}

/**
 * Ticket 2026-09-15#12 (D18) — full rebuild, prior version shared nothing with the prototype
 * (plain scroll, no arrows, no bolt icon, wrong card shape, a "Soon" badge the prototype doesn't
 * have). Citations: heading/arrow row `Full Spec.html:915-921`, rail/card CSS `:929-933`,
 * `nudgeRel` scroll-by-3-cards `:3237-3243`, arrow mute state `:3842-3843`/`:3848-3851`, edge-mask
 * strips `:934-935`. The bolt icon (`OriginalsIcon`) and the arrow press-pop mechanism (`popId`
 * set on `onPointerUp`, cleared on `onAnimationEnd` — deliberately NOT a key-remount, the
 * mechanism that caused the 2026-09-13#9 nav-bar regression) both reuse HomeHub.tsx's own
 * already-proven-safe category-rail patterns verbatim, not new ones.
 */
function RelatedRail({
  related, onSelectGame,
}: {
  related: { id: string; name: string; playable: boolean; meta?: GameMeta }[];
  onSelectGame(meta: GameMeta): void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, atEnd: false });
  const [popId, setPopId] = useState<'prev' | 'next' | null>(null);

  // `nudgeRel` (Full Spec.html:3237-3243): scroll exactly 3 cards' worth, measured off the first
  // card's own real rendered width (not a hardcoded card size).
  function nudge(dir: 1 | -1) {
    const rail = railRef.current;
    const card = rail?.firstElementChild as HTMLElement | null | undefined;
    const step = card ? card.getBoundingClientRect().width + 9 : 120;
    rail?.scrollBy?.({ left: dir * step * 3, behavior: 'smooth' });
  }
  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setScroll({ left: el.scrollLeft, atEnd: el.scrollLeft >= el.scrollWidth - el.clientWidth - 4 });
  }
  // relPrevFill/relNextFill (Full Spec.html:3842-3843): left active only past scrollLeft 20; right
  // active until within 4px of the scrollable end.
  const prevActive = scroll.left > 20;
  const nextActive = !scroll.atEnd;

  if (related.length === 0) return null;
  return (
    <section data-testid="hub-section-related" aria-label="Related games">
      <div className="mt-[22px] flex items-center gap-[9px] px-4">
        <OriginalsIcon className="h-[22px] w-[22px] shrink-0 text-[#8B45F0]" />
        <span className="flex-1 truncate text-[19px] font-bold tracking-[0.6px] text-[var(--rc-text)]" style={{ fontFamily: ARIAL }}>
          RELATED GAMES
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {(['prev', 'next'] as const).map((dir) => {
            const active = dir === 'prev' ? prevActive : nextActive;
            const color = active ? 'var(--rc-text)' : 'var(--rc-muted)';
            return (
              <button
                key={dir}
                type="button"
                aria-label={dir === 'prev' ? 'Previous' : 'Next'}
                data-testid={`hub-related-${dir}`}
                onClick={() => nudge(dir === 'prev' ? -1 : 1)}
                onPointerUp={() => setPopId(dir)}
                onAnimationEnd={() => setPopId((cur) => (cur === dir ? null : cur))}
                style={{ animation: popId === dir ? 'rcNavPop 420ms cubic-bezier(0.22,0.61,0.36,1)' : undefined }}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <svg width="12" height="14" viewBox="0 0 12 14">
                  <path
                    d={dir === 'prev' ? 'M8.8 2.2 3.2 7 8.8 11.8z' : 'M3.2 2.2 8.8 7 3.2 11.8z'}
                    fill={color}
                    stroke={color}
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ transition: 'fill 260ms ease, stroke 260ms ease' }}
                  />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative mt-3">
        <div
          ref={railRef}
          onScroll={handleScroll}
          className="no-scrollbar flex gap-[9px] overflow-x-auto px-4"
          style={{ scrollSnapType: 'x mandatory', scrollPaddingLeft: 16, WebkitOverflowScrolling: 'touch' }}
        >
          {related.map((t) => {
            // The "RAPIDCLASH ORIGINALS" pill visible on every card is baked into the tile art
            // image itself, not separate markup — confirmed via the harness capture. No border, no
            // badge overlay (the prototype's own card has neither); opacity-50 is this app's own
            // real non-interactive/coming-soon cue, same convention used elsewhere in the app.
            const cardStyle = {
              flex: '0 0 calc((100% - 18px) / 3)',
              width: 'calc((100% - 18px) / 3)',
              aspectRatio: '112 / 158',
              scrollSnapAlign: 'start' as const,
              borderRadius: 14,
              overflow: 'hidden' as const,
              backgroundColor: 'var(--rc-surface)',
              backgroundImage: TILE_ART[t.id] ? `url(${TILE_ART[t.id]})` : undefined,
              backgroundSize: 'cover' as const,
              backgroundPosition: 'center' as const,
            };
            return t.playable && t.meta ? (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectGame(t.meta!)}
                data-testid={`hub-related-${t.id}`}
                aria-label={t.name}
                style={{ ...cardStyle, cursor: 'pointer' }}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            ) : (
              <div
                key={t.id}
                aria-disabled="true"
                aria-label={`${t.name} — coming soon`}
                data-testid={`hub-related-${t.id}`}
                style={cardStyle}
                className="opacity-50"
              />
            );
          })}
        </div>
        {/* Edge-mask strips (Full Spec.html:934-935) — solid var(--rc-bg), not a fade gradient. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-4" style={{ background: 'var(--rc-bg)' }} />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-4" style={{ background: 'var(--rc-bg)' }} />
      </div>
    </section>
  );
}

/**
 * Brief, self-dismissing result overlay (spec Q2). Generic win/lose/draw + the credits settlement
 * delta (confetti on a win), with an optional game-specific reveal slot at the top.
 */
function ResultOverlay({
  outcome, settlement, reveal, playerId, onDismiss,
}: {
  outcome: Outcome;
  settlement: SettlementSummary;
  reveal?: ReactNode;
  playerId?: string;
  onDismiss(): void;
}) {
  const kind: 'win' | 'lose' | 'neutral' =
    outcome.type === 'draw' || outcome.type === 'void'
      ? 'neutral'
      : (playerId === undefined || outcome.winner === playerId) ? 'win' : 'lose';
  const text = outcome.type === 'draw' ? 'Draw! 🤝'
    : outcome.type === 'void' ? 'Match voided'
    : kind === 'win' ? 'You Won! 🏆' : 'You Lost 😔';
  const style = {
    win: 'border-success/40 bg-success/10 text-success',
    lose: 'border-destructive/40 bg-destructive/10 text-destructive',
    neutral: 'border-border bg-surface text-muted-foreground',
  }[kind];
  const delta = settlement.delta;

  useEffect(() => {
    if (kind === 'win') confetti({ particleCount: 110, spread: 75, origin: { y: 0.55 }, disableForReducedMotion: true });
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [kind, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
      role="dialog"
      aria-label="Match result"
      data-testid="hub-result-overlay"
      onClick={onDismiss}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 text-center"
      >
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        {reveal}
        <div className={cn('mb-3 rounded-xl border px-4 py-3 text-xl font-black', style)} data-testid="hub-result-text">
          <Trophy className={cn('mx-auto mb-1 h-6 w-6', kind !== 'win' && 'opacity-40')} />
          {text}
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wallet change</p>
        <div className={cn('text-2xl font-bold tabular-nums', delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-foreground/80')} data-testid="hub-result-delta">
          <Credits amount={delta} showSign size={20} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">New balance: <strong className="text-foreground"><Credits amount={settlement.newBalance} /></strong></p>
      </motion.div>
    </div>
  );
}
