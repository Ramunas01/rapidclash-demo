// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { RpsHubScreen } from '../screens/RpsHub.js';
import type { RpsView } from '../App.js';
import type { OpenChallenge } from '@rapidclash/shared';
import { setCurSel } from '../lib/currency.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Ticket 2026-09-18#2 item 3: mocks lib/sound.js so the guideToBet()/handlePlayFriend() reject-sound
// assertions below can check the exact call (same idiom as DiceHub.test.tsx's play('play')/('dice-
// roll') mock).
const { playMock } = vi.hoisted(() => ({ playMock: vi.fn() }));
vi.mock('../lib/sound.js', () => ({
  play: playMock,
  unlock: vi.fn(),
  installUnlockOnFirstGesture: vi.fn(),
  isMuted: () => false,
  toggleMute: vi.fn(),
  setMuted: vi.fn(),
  subscribe: () => () => {},
  preloadSounds: vi.fn(),
}));

type Props = Parameters<typeof RpsHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'pid', username: 'me', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}

const CHALLENGE: OpenChallenge = { matchId: 'c1', ownerName: 'rival', ownerTier: 'Unranked', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };

describe('RpsHubScreen (GameHub + RpsPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
    playMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setCurSel('USD'); // restore the app-wide default so other test files aren't affected
  });

  it('Idle: arming a bet enables PLAY, which posts that stake (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);

    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // pressable with no stake armed (no longer a dead end)
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // guided to the bet panel, not started
    expect(scrollSpy).toHaveBeenCalled(); // bet panel scrolled into view
    // Ticket 2026-09-18#2 item 3: the shared reject sound fires on PLAY-with-no-bet, the same
    // rejection moment the ring/hint/shake below already mark visually.
    expect(playMock).toHaveBeenCalledWith('reject');
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBe('true');
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);
    // Ticket 2026-09-15#13 item 1: the needs-bet ring lives on the bet-track pill itself, NOT the
    // whole hub-section-bet wrapper — and the shake fires on PLAY at the same moment.
    const bettrack = document.querySelector('[data-rc-bettrack]') as HTMLElement;
    expect(bettrack.style.boxShadow).toBe('0 0 0 2px var(--rc-loss)');
    expect(screen.getByTestId('hub-section-bet').style.boxShadow).toBeFalsy();
    expect(play.style.animation).toContain('rcPlayShake');

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
    expect(bettrack.style.boxShadow).toBe('0 0 0 0 rgba(255,62,94,0)');
  });

  // Ticket 2026-09-16#2: the bet-amount row (icon + label) must follow the wallet's own selected
  // currency (`useCurSel()`, already wired into HubRibbon/GamesCarousel/RewardsHub) instead of
  // the hardcoded "USD" this row shipped with. Guest mode's RC-icon/'RC'-label branch is a
  // separate, deliberate surface (CHARTER.md) and stays untouched regardless of curSel.
  it('#2026-09-16#2: the bet row label follows the wallet\'s selected currency, not a hardcoded USD', () => {
    setCurSel('SOL');
    render(<RpsHubScreen {...baseProps()} />);
    const betAmountGroup = screen.getByRole('group', { name: /bet amount/i });
    expect(betAmountGroup.textContent).toContain('SOL');
    expect(betAmountGroup.textContent).not.toContain('USD');
  });

  it('#2026-09-16#2: guest mode keeps RC regardless of the wallet\'s selected currency', () => {
    setCurSel('SOL');
    render(<RpsHubScreen {...baseProps({ isGuest: true })} />);
    const betAmountGroup = screen.getByRole('group', { name: /bet amount/i });
    expect(betAmountGroup.textContent).toContain('RC');
    expect(betAmountGroup.textContent).not.toContain('SOL');
  });

  it('#143: the inert "Play a Friend" also guides to the bet panel when no stake is armed (guard pre-wired)', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    render(<RpsHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('hub-play-friend'));
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);
    expect(playMock).toHaveBeenCalledWith('reject'); // ticket 2026-09-18#2 item 3
  });

  // Ticket 2026-09-18#2 item 3: an ARMED Play-a-Friend press is a real, live no-op today (the
  // invite flow isn't built — handlePlayFriend's own TODO) — Owner's own cited example of a
  // rejection with zero signal. Distinct from the unarmed case above (which routes through
  // guideToBet() instead) — this is the OTHER call site, confirming both fire the cue.
  it('ticket 2026-09-18#2 item 3: an ARMED "Play a Friend" press (today\'s no-op) also fires the reject sound', () => {
    render(<RpsHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('hub-bet-25')); // arm a stake first
    playMock.mockClear();
    fireEvent.click(screen.getByTestId('hub-play-friend'));
    expect(playMock).toHaveBeenCalledWith('reject');
  });

  it('In-match: the RPS board activates, choices come from legalMoves, and the opponent stays hidden', () => {
    const onMakeMove = vi.fn();
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], onMakeMove })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    // Redaction: the opponent's pick is never shown before match.end — 2026-09-11#8/C's real
    // blue-bolt icon (not the ✊/✋/✌️ hand icons), replacing the old 🤫 emoji stand-in.
    expect(screen.getByTestId('hub-opponent-pick').querySelector('[data-rc-rps-icon="redacted"]')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hub-move-rock'));
    expect(onMakeMove).toHaveBeenCalledWith('rock');
  });

  // Ticket 2026-09-16#5 item 7: the shared OpponentSlot fallback "Playing…" tag's weight/case/
  // tracking corrected against the prototype's own citation (Full Spec.html:463) — was font-black/
  // uppercase/tracking-wide/text-xs(12px), wrong in both themes. Found while verifying a Mines
  // ticket but lands in shared GameHub.tsx code, so every game using the fallback is affected —
  // exercised here via RPS as the canonical shared-GameHub test surface. The color half
  // (text-foreground/70) is a separate, already-tracked light-theme token backlog — untouched here.
  it('ticket 2026-09-16#5 item 7: the opponent bar\'s "Playing…" fallback uses the prototype\'s own weight/case/tracking', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    // Scoped to the opponent bar — the PLAY button's own disabled label is also "Playing…".
    const playingTag = within(screen.getByTestId('hub-slot-opponent')).getByText('Playing…');
    expect(playingTag.className).toContain('font-bold');
    expect(playingTag.className).not.toContain('font-black');
    expect(playingTag.className).not.toContain('uppercase');
    expect(playingTag.className).toContain('text-[13px]');
    expect(playingTag.className).toContain('tracking-[0.3px]');
  });

  // 2026-09-11#9 item 2 (deliberate, Owner-approved redaction rollback — ADVISOR_TO_PM.md): a tied
  // round's new_round event carries revealedChoices, and RpsBoard flips the opponent card to the
  // real throw, holds it, then resets to redacted — a real, intentional behavior change from "always
  // hidden pre-terminal", not a regression.
  it("2026-09-11#9/2026-09-25#3: a tied round's new_round event flips the opponent card to the real throw (after the shared 700ms pause), holds, then resets to redacted", () => {
    vi.useFakeTimers();
    try {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      // Ticket 2026-09-25#3: the tie-reveal now shares the terminal reveal's own 700ms pre-flip
      // pause — the redacted tile stays put immediately after the tie, not an instant flip.
      expect(screen.getByTestId('hub-opponent-pick').querySelector('[data-rc-rps-icon="redacted"]')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(700); });
      // Flipped: the redacted blue-bolt tile is gone; the opponent's real (scissors) throw is now in
      // the DOM (both flip faces are always present — backface-visibility is a visual-only 3D property
      // jsdom doesn't lay out — so this asserts the revealed face was added, not that the hidden face
      // left).
      expect(screen.queryByTestId('hub-opponent-pick')).toBeNull();
      expect(screen.getByTestId('hub-opponent-pick-revealed').querySelector('[data-rc-rps-icon="scissors"]')).toBeInTheDocument();

      // After the flip-to-done beat (900ms) + hold (~1.5s), it falls back to the redacted tile.
      act(() => { vi.advanceTimersByTime(900); });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(screen.getByTestId('hub-opponent-pick').querySelector('[data-rc-rps-icon="redacted"]')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // 2026-09-11#10 item 2 (ADVISOR_TO_PM.md): the terminal (match-end) reveal and the tie-reveal beat
  // both flip the SAME `RpsRevealFlipCard` at different moments — a terminal outcome must always win
  // the render over a still-pending tie-reveal (impossible to race for real, since the next round's
  // earliest resolution is a full fresh ~10s window later, but this proves the defensive composition
  // holds rather than just leaning on that timing margin).
  it('a terminal outcome always wins over a still-pending tie-reveal (composes without glitching)', () => {
    vi.useFakeTimers();
    try {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      const { rerender } = render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      // The tie-reveal is armed and past its own 700ms pause, showing the opponent's just-tied
      // scissors throw.
      act(() => { vi.advanceTimersByTime(700); });
      expect(screen.getByTestId('hub-opponent-pick-revealed').querySelector('[data-rc-rps-icon="scissors"]')).toBeInTheDocument();

      // Before its ~3.1s hold elapses, the match actually ends decisively — the terminal outcome
      // must win the RENDER immediately (no stale tie card, no duplicate/competing flip nodes) —
      // ticket 2026-09-25#3: it still gets its OWN fresh 700ms pause (`revealKey` changing to
      // 'terminal' resets `revealStage` back to 'grow'), so it shows redacted, not an instant rock.
      const terminalState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'paper', bob: 'rock' } };
      act(() => {
        rerender(
          <RpsHubScreen
            {...baseProps({
              currentMatchId: null,
              gameState: terminalState,
              lastOutcome: { type: 'win', winner: 'pid' },
              lastSettlement: { delta: 9, newBalance: 1009 },
            })}
          />,
        );
      });
      expect(screen.queryByTestId('hub-opponent-pick-revealed')).toBeNull();
      expect(screen.getByTestId('hub-opponent-pick').querySelector('[data-rc-rps-icon="redacted"]')).toBeInTheDocument();

      // Past the terminal reveal's own pause: exactly one revealed opponent card, showing the
      // TERMINAL throw (rock) — not the stale tie's (scissors).
      act(() => { vi.advanceTimersByTime(700); });
      expect(screen.getAllByTestId('hub-opponent-pick-revealed')).toHaveLength(1);
      expect(screen.getByTestId('hub-opponent-pick-revealed').querySelector('[data-rc-rps-icon="rock"]')).toBeInTheDocument();

      // Advancing past the tie-reveal's own (now-cleared) timer must not glitch anything back to
      // redacted — the terminal reveal persists (it never resets, unlike the tie beat).
      act(() => { vi.advanceTimersByTime(900 + 1500); });
      expect(screen.getByTestId('hub-opponent-pick-revealed').querySelector('[data-rc-rps-icon="rock"]')).toBeInTheDocument();
      expect(screen.queryByTestId('hub-opponent-pick')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("2026-09-11#9: a DECISIVE round's new_round-less broadcast never flips the opponent card (revealedChoices is tie-only)", () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    // No `events` at all — the common case (a provisional pick's broadcast carries none either).
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    expect(screen.getByTestId('hub-opponent-pick').querySelector('[data-rc-rps-icon="redacted"]')).toBeInTheDocument();
  });

  it('own slot renders the player\'s chosen avatar preset (avatarId threaded into the own bar)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ avatarId: 'rc-01', currentMatchId: 'm1', gameState, legalMoves: ['rock'] })} />);
    const own = within(screen.getByTestId('hub-slot-own'));
    const ownAvatar = own.getByTestId('avatar');
    expect(ownAvatar.getAttribute('data-avatar-id')).toBe('rc-01');
    // A preset shows its <img>, not the default glyph.
    expect(own.getByTestId('avatar-img')).toBeInTheDocument();
    expect(own.queryByTestId('avatar-glyph')).toBeNull();
  });

  it('REDACTION: the in-match opponent bar stays the neutral silhouette regardless of MY avatar (opponent avatarId is never on the wire)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    // I picked a colourful preset; the opponent slot must NOT reflect any avatar — it has no avatarId
    // source at all (the opponent's stored avatar is never sent in-match, Charter #2).
    render(<RpsHubScreen {...baseProps({ avatarId: 'rc-02', currentMatchId: 'm1', gameState, legalMoves: ['rock'] })} />);
    const opp = within(screen.getByTestId('hub-slot-opponent'));
    const oppAvatar = opp.getByTestId('avatar');
    expect(oppAvatar.getAttribute('data-avatar-id')).toBe('default'); // never a preset
    expect(opp.queryByTestId('avatar-img')).toBeNull(); // no preset image
    expect(opp.getByTestId('avatar-glyph')).toBeInTheDocument(); // the neutral silhouette
    // NEUTRAL disc (no username) — distinct from any per-user disc.
    expect(oppAvatar.getAttribute('data-disc')).toBe('hsl(230, 10%, 88%)');
  });

  it('In-match: picks stay enabled and mutable for the whole window (timer-only-resolve #164)', () => {
    const onMakeMove = vi.fn();
    // A prior pick is on the server view, and legalMoves is empty — under the OLD model this froze
    // the board. The new model never gates on legalMoves/your_turn: all three throws stay tappable.
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [], onMakeMove })} />);
    expect(screen.getByTestId('hub-move-rock')).not.toBeDisabled();
    expect(screen.getByTestId('hub-move-scissors')).not.toBeDisabled();
    // The current pick shows selected (purple outline via aria-pressed)…
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('true');
    // …and re-tapping a different throw changes the selection (mutable) and re-sends it.
    fireEvent.click(screen.getByTestId('hub-move-paper'));
    expect(onMakeMove).toHaveBeenCalledWith('paper');
    expect(screen.getByTestId('hub-move-paper').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('false');
  });

  // 2026-09-11#10 item 2 (ADVISOR_TO_PM.md): the prototype has no separate result modal for this
  // game — RPS wires `suppressResultOverlay` so the outcome presents IN PLACE on the persistent
  // board instead, matching the pre-existing Coinflip pattern this replaces the old
  // `hub-result-overlay` assertions with.
  //
  // 2026-09-12#1 item 3 (ADVISOR_TO_PM.md): `ownBarResult` was REMOVED from this hub's `<GameHub>`
  // call (a real correction to 2026-09-11#10 item 2 — the prototype's own `mOutcome` is gated on
  // `gameV = view === 'mines' || isDice`, `Full Spec.html:3519`, so RPS structurally never gets the
  // bar-level "You Win" fill). This test now asserts the ABSENCE of that bar-level verdict and, per
  // item 2 above, the real win indication instead: the own card's frame turning green
  // (`rpsLeftFrame`, `:3810`) combined with both cards growing to the `rpsExpanded()` big geometry.
  it('Result: ending a match reveals the outcome in place on the board — no overlay, opponent throw flips, own card frame turns green + both cards enlarge, no bar-level verdict', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'scissors' } };
    const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
      />,
    );
    // No separate popup ever appears — the board itself carries the result.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    // The pick grid locks at terminal — no round left to pick into.
    expect(screen.getByTestId('hub-move-rock')).toBeDisabled();
    // Item 3: no bar-level "You Win" YET — since ticket 2026-09-25#3, `ownBarResult` lights the
    // bar once RpsBoard's own revealStage reaches 'done' (gateResultOnReveal), not the instant
    // terminal/outcome lands — checked here before any time passes, so it's correctly still unlit.
    expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull();
    // Item 2: both cards grow to the expanded (`rpsExpanded()`) geometry — 124×176, not 92×130.
    // Beat 1 fires immediately at `terminal`, unstaged — this codebase's own doc comment on
    // `cardW` confirms this part was already correct before ticket 2026-09-25#2.
    expect(screen.getByTestId('hub-my-pick-frame').style.width).toBe('124px');
    expect(screen.getByTestId('hub-my-pick-frame').style.height).toBe('176px');
    // Item 2: the picker row has genuinely collapsed (height + opacity → 0), not just dimmed.
    const pickerWrapper = screen.getByTestId('hub-move-rock').closest('[role="group"]')?.parentElement as HTMLElement;
    expect(pickerWrapper.style.opacity).toBe('0');
    // jsdom's CSSOM normalizes a zero length to unitless '0' regardless of the '0px' React set.
    expect(pickerWrapper.style.maxHeight).toMatch(/^0(px)?$/);
  });

  // Ticket 2026-09-25#2 item 1 (ADVISOR_TO_PM.md): the terminal reveal's own three staggered beats,
  // confirmed against the prototype's exact `rpsTimer` chain — a 700ms pause before the opponent
  // card starts flipping (Beat 2), then +900ms more before the frame colors land (Beat 3). Prior to
  // this ticket, all of this fired in one step the instant `terminal` became true.
  describe('ticket 2026-09-25#2 item 1: the terminal reveal is staged (grow → flip → done), not one step', () => {
    function renderTerminal() {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'scissors' } };
      const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      rerender(
        <RpsHubScreen
          {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
        />,
      );
    }

    it('Beat 1 (immediate): cards already grown, but the opponent stays redacted and the own frame stays neutral — the flip/color hasn\'t started yet', () => {
      vi.useFakeTimers();
      try {
        renderTerminal();
        // Cards grown (Beat 1, unstaged) — but nothing about the reveal itself has started.
        expect(screen.getByTestId('hub-my-pick-frame').style.width).toBe('124px');
        expect(screen.queryByTestId('hub-opponent-pick-revealed')).toBeNull();
        expect(screen.getByTestId('hub-opponent-pick')).toBeInTheDocument();
        expect(screen.getByTestId('hub-my-pick-frame').style.background).toBe('rgb(255, 255, 255)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('Beat 2 (+700ms): the opponent card mounts and starts flipping — the own frame is STILL neutral (color is Beat 3, not Beat 2)', () => {
      vi.useFakeTimers();
      try {
        renderTerminal();
        act(() => { vi.advanceTimersByTime(700); });
        expect(screen.getByTestId('hub-opponent-pick-revealed').querySelector('[data-rc-rps-icon="scissors"]')).toBeInTheDocument();
        expect(screen.queryByTestId('hub-opponent-pick')).toBeNull();
        expect(screen.getByTestId('hub-my-pick-frame').style.background).toBe('rgb(255, 255, 255)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('Beat 3 (+700ms +900ms = +1600ms): the own card frame finally turns win-green (#16A34A)', () => {
      vi.useFakeTimers();
      try {
        renderTerminal();
        act(() => { vi.advanceTimersByTime(700); });
        act(() => { vi.advanceTimersByTime(900); });
        expect(screen.getByTestId('hub-my-pick-frame').style.background).toMatch(/#16a34a|22, 163, 74/i);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('ticket 2026-09-25#2 item 2: a LOSS colors the own frame with the shared --rc-loss token, not the old #F04438 literal', () => {
    vi.useFakeTimers();
    try {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'paper' } };
      const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      rerender(
        <RpsHubScreen
          {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -5, newBalance: 995 } })}
        />,
      );
      act(() => { vi.advanceTimersByTime(700); });
      act(() => { vi.advanceTimersByTime(900); });
      expect(screen.getByTestId('hub-my-pick-frame').style.background).toBe('var(--rc-loss)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticket 2026-09-25#2 item 1: the flip card\'s translateX nudge starts at 16px on mount and returns to 0px after 410ms — shared by both the terminal reveal and the tie-reveal', () => {
    vi.useFakeTimers();
    try {
      // Tie-reveal path — ticket 2026-09-25#3 unified the tie-reveal onto the SAME staged timing
      // as the terminal reveal, so the flip card mounts only after the same 700ms pause now.
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      act(() => { vi.advanceTimersByTime(700); });
      const card = screen.getByTestId('hub-opponent-pick-revealed');
      expect(card.style.transform).toBe('translateX(16px)');
      act(() => { vi.advanceTimersByTime(410); });
      expect(card.style.transform).toBe('translateX(0px)');
    } finally {
      vi.useRealTimers();
    }
  });

  it("ticket 2026-09-25#2 item 1: the pick-window countdown fades out (opacity 1→0, scale 1→0.55) the instant a match ends — Beat 1, unstaged", () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, windowEndsAt: Date.now() + 5000 };
    const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    expect(screen.getByTestId('rps-countdown').parentElement!.style.opacity).toBe('1');
    expect(screen.getByTestId('rps-countdown').parentElement!.style.transform).toContain('scale(1)');
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
      />,
    );
    // `RpsBoard` remounts per match (keyed on `currentMatchId`, ticket 2026-09-25#1 item 3) — the
    // countdown box above is a stale reference to the UNMOUNTED prior instance after this rerender;
    // re-query rather than reuse it, or this assertion would silently check dead DOM.
    expect(screen.getByTestId('rps-countdown').parentElement!.style.opacity).toBe('0');
    expect(screen.getByTestId('rps-countdown').parentElement!.style.transform).toContain('scale(0.55)');
  });

  // Ticket 2026-09-25#7 (ADVISOR_TO_PM.md) — Designer's own direct answer to the open question
  // ticket 2026-09-25#3/PR #727 flagged: "Yes they should complete the full movement as if would
  // be a regular result ending." REVERSES this test's own prior assertion (ticket 2026-09-12#1
  // item 2's original terminal-only decision) for ties specifically — an ordinary tie's reveal now
  // grows to the BIG 124×176 geometry too, same as terminal, since both reveals already share one
  // `revealStage` timing machine (2026-09-25#2/#3).
  it("2026-09-25#7: the tied-round reveal beat ALSO grows to the BIG card geometry, same as a terminal result — then shrinks cleanly back to small once the hold resets", () => {
    vi.useFakeTimers();
    try {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      const { rerender } = render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      // The tie-reveal is armed (real opponent throw visible, past its shared 700ms pause) — the
      // card now grows to the BIG 124×176 geometry, not the small 92×130 it used to stay at.
      act(() => { vi.advanceTimersByTime(700); });
      expect(screen.getByTestId('hub-opponent-pick-revealed').style.width).toBe('124px');
      expect(screen.getByTestId('hub-opponent-pick-revealed').style.height).toBe('176px');
      expect(screen.getByTestId('hub-my-pick-frame').style.width).toBe('124px');
      expect(screen.getByTestId('hub-my-pick-frame').style.height).toBe('176px');
      // The picker row is still live (not collapsed) — the match isn't over, just this round tied.
      // Untouched by this ticket: the collapse logic stays keyed on `terminal` alone.
      expect(screen.getByTestId('hub-move-rock')).not.toBeDisabled();

      // Advisor's own flagged check, not a new open question: once the hold elapses and the tie
      // resets to redacted for the next round, the geometry shrinks cleanly back down — growing
      // bigger first doesn't leave it stuck, or break the existing shrink transition.
      act(() => { vi.advanceTimersByTime(900 + 1500); });
      expect(screen.getByTestId('hub-opponent-pick')).toBeInTheDocument(); // back to redacted
      expect(screen.getByTestId('hub-my-pick-frame').style.width).toBe('92px');
      expect(screen.getByTestId('hub-my-pick-frame').style.height).toBe('130px');

      // A SECOND tie in the SAME match (round bumps again) reproduces the same grow correctly —
      // confirming the reset genuinely re-armed the machine, not just a one-shot fluke.
      const events2 = [
        { type: 'new_round', payload: { round: 2, replays: 2, revealedChoices: { pid: 'paper', bob: 'paper' } } },
      ];
      rerender(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState: { ...gameState, round: 2 }, legalMoves: ['rock', 'paper', 'scissors'], events: events2 })}
        />,
      );
      act(() => { vi.advanceTimersByTime(700); });
      expect(screen.getByTestId('hub-opponent-pick-revealed').style.width).toBe('124px');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-25#3 item 2 (ADVISOR_TO_PM.md): RPS now wires the exact Dice-style bar
  // ring+fill+"you won" text — a deliberate departure from the prototype, confirmed via Designer's
  // own report. Real timers + waitFor (matches DiceHub.test.tsx's own equivalent tests) rather than
  // fake-timer chaining, since `RpsBoard`'s reveal → `onRevealComplete` → GameHub's own
  // `revealDone` state crosses a component boundary the fake-timer/act split-testing pitfall would
  // otherwise need extra care to route around correctly.
  describe('ticket 2026-09-25#3 item 2: the own-bar win/lose treatment (deliberately new, not a prototype behavior)', () => {
    it('a WIN lights the own bar (ring #16A34A, fill #16A34A, "you won" text) once RpsBoard\'s own reveal reaches done — never before', async () => {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'scissors' } };
      const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      rerender(
        <RpsHubScreen
          {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
        />,
      );
      // Not lit yet — `RpsBoard`'s own revealStage hasn't reached 'done' (needs the full 700+900ms).
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull();
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 3000 });
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you won/i);
      const ownBar = screen.getByTestId('hub-slot-own');
      const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement;
      expect(ownFill.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
      await waitFor(() => expect(ownBar.className).toContain('ring-[3px]'), { timeout: 4000 });
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
    }, 10000);

    it('a LOSS rings the own bar var(--rc-loss), not the shared ring-destructive class', async () => {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'paper' } };
      const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      rerender(
        <RpsHubScreen
          {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -5, newBalance: 995 } })}
        />,
      );
      const ownBar = screen.getByTestId('hub-slot-own');
      await waitFor(() => expect(ownBar.className).toContain('ring-[3px]'), { timeout: 3000 });
      expect(ownBar.className).not.toContain('ring-destructive');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');
    }, 8000);

    it("an ordinary tie followed by a decisive match-end still waits for the TERMINAL reveal's own 700+900ms — no stale premature light-up", async () => {
      // Drive an ordinary tie all the way through its own 'done', THEN end the match decisively, to
      // confirm the composition holds end-to-end (matches the existing "a terminal outcome always
      // wins over a still-pending tie-reveal" coverage, extended through the bar). NOTE: this does
      // NOT, on its own, isolate whether `RpsBoard`'s `onRevealComplete` call is actually gated to
      // `terminal` — GameHub's own `currentMatchId`-keyed `revealDone` reset (fired the same render
      // the match ends, since match-end always changes `currentMatchId`) independently protects
      // this exact scenario either way, confirmed empirically. The `terminal &&` guard in
      // `RpsBoard` is kept as defensive, correctness-by-construction code regardless (RpsBoard's
      // own contract shouldn't depend on a caller-side reset it doesn't control) — matching this
      // file's own established philosophy elsewhere (e.g. the tie-vs-terminal render-priority
      // effect's "renders defensively rather than leaning on timing margin alone").
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      const { rerender } = render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      await new Promise((r) => setTimeout(r, 1700));
      const terminalState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'paper', bob: 'rock' } };
      rerender(
        <RpsHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState: terminalState,
            lastOutcome: { type: 'win', winner: 'pid' },
            lastSettlement: { delta: 9, newBalance: 1009 },
          })}
        />,
      );
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull();
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 3000 });
    }, 8000);
  });

  // Ticket 2026-09-25#3 (D49): root-caused "the yellow rings on both bars" to the shared,
  // game-agnostic `drawBeat` mechanism (#161) — unrelated to `ownBarResult`/the card frames above,
  // and firing on every tie regardless. `suppressDrawBar` silences the BAR's own copy of it, the
  // same flag `BlackjackHub.tsx` already uses, now that RPS shows every tie via its card frames.
  it("ticket 2026-09-25#3: suppressDrawBar keeps the generic orange draw-pulse off both bars during an ordinary tie", async () => {
    // `replays` isn't part of RpsView's own TS shape (RpsHub.tsx never reads it directly), but the
    // real server state (`rps.ts`'s `RpsState.replays`) genuinely carries it — GameHub's shared,
    // game-agnostic `replaysOf()` reads it via a loose `unknown` cast, which is what this test needs
    // to actually arm the `drawBeat` mechanism `suppressDrawBar` is meant to silence.
    const gameState = { players: ['pid', 'bob'], choices: {}, round: 0, replays: 0 } as RpsView & { replays: number };
    const { rerender } = render(
      <RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />,
    );
    const tiedState = { ...gameState, round: 1, replays: 1 };
    const events = [
      { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'rock' } } },
    ];
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState: tiedState, legalMoves: ['rock', 'paper', 'scissors'], events })}
      />,
    );
    expect(screen.getByTestId('hub-slot-own').className).not.toContain('ring-amber-400');
    expect(screen.getByTestId('hub-slot-opponent').className).not.toContain('ring-amber-400');
  });

  // Ticket 2026-09-25#3: your OWN hand could previously vanish mid-tie-reveal — `optimisticPick`/
  // `serverChoice` both go blank the instant the round bumps, well before the reveal even starts.
  it("ticket 2026-09-25#3: the OWN card's hand stays visible (snapshotted) through a tie-reveal, not blank, while the picker tiles stay LIVE for the new round", async () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
    const events = [
      { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
    ];
    render(
      <RpsHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
      />,
    );
    // The own card shows the snapshotted 'rock' (the round that just tied), not blank.
    expect(screen.getByTestId('hub-my-pick-icon').querySelector('[data-rc-rps-icon="rock"]')).toBeInTheDocument();
    // The picker tiles stay live: tapping a DIFFERENT choice for the new round registers immediately
    // (the tile lights up), independent of the frozen own-card snapshot above.
    fireEvent.click(screen.getByTestId('hub-move-paper'));
    expect(screen.getByTestId('hub-move-paper').getAttribute('aria-pressed')).toBe('true');
    // The own card is still showing the OLD snapshot (rock), not the new live tap (paper) — the two
    // are deliberately decoupled during an active tie-reveal.
    expect(screen.getByTestId('hub-my-pick-icon').querySelector('[data-rc-rps-icon="rock"]')).toBeInTheDocument();
  });

  // Ticket 2026-09-25#3: the rare terminal void at the replay cap gets the same orange `done`
  // coloring as an ordinary tie, but — unlike an ordinary tie — never auto-continues, since there's
  // no live match left to continue into. Confirmed this falls out of the existing `terminal`/
  // `outcome` path for free (the replay-cap void is a genuine terminal outcome, never routed through
  // the ordinary `tieReveal` mechanism) — no special-casing needed.
  it('ticket 2026-09-25#3: a terminal void (replay-cap) colors both frames orange and stays expanded — no auto-continue, unlike an ordinary tie', async () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'rock' } };
    const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'void' }, lastSettlement: { delta: 0, newBalance: 1000 } })}
      />,
    );
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.getByTestId('hub-my-pick-frame').style.background).toBe('rgb(247, 144, 9)'); // #F79009, jsdom-normalized
    // Well past an ordinary tie's own auto-continue point (700+900+1500 ≈ 3.1s) — still expanded,
    // no reset to redacted, since this is a genuinely terminal outcome with no next round.
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.getByTestId('hub-opponent-pick-revealed')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-opponent-pick')).toBeNull();
  }, 8000);

  it('JOIN balance-check + chrome (shared GameHub behaviour holds for RPS)', () => {
    const onTakeChallenge = vi.fn();
    render(<RpsHubScreen {...baseProps({ balance: 5, challengesByGame: { rps: [CHALLENGE] }, onTakeChallenge })} />);
    const row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    // registered (default loggedIn: true) → the Owner-approved $ skin, 2026-09-11#8 item B.2
    expect(within(row).getByTestId(/^games-carousel-stake-/).textContent).toBe('$50');
    fireEvent.click(within(row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('games-carousel-notice').textContent).toMatch(/not enough/i);
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5 })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5, isGuest: true })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  // Issue #337: the shared footer must sit OUTSIDE the gapped `flex flex-col gap-4` content div
  // (a sibling, directly under <main>), not as its last gapped child — otherwise the parent's
  // own gap stacks on top of the gradient's margin, producing a page-specific black band. This
  // is the one thing jsdom (no real layout engine) CAN verify: DOM structure. It cannot verify
  // the actual rendered pixel gap — that needs a real browser, out of scope for this suite.
  it('renders the footer as a sibling of the gapped content div, directly under <main> (#337)', async () => {
    render(<RpsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('hub-body');
    const footer = await screen.findByTestId('home-footer');
    expect(footer.parentElement).toBe(main);
    const gappedDiv = main.querySelector('.gap-4');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.contains(footer)).toBe(false);
  });

  // Issue #342: the content div no longer needs hubBodyPadding's toolbar-clearance padding —
  // the footer now reserves that space itself (see HubFooter.test.tsx). Non-guest path only:
  // hubBodyPadding(isGuest) already returned '' for guests before this fix (guest mode never
  // renders HubFooter/HubToolbar), so this removal only changes the logged-in/non-guest branch.
  it('no longer carries the hubBodyPadding toolbar-clearance padding on the content div (#342)', async () => {
    render(<RpsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('hub-body');
    await screen.findByTestId('home-footer');
    const gappedDiv = main.querySelector('.gap-4');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.className).not.toMatch(/pb-\[calc/);
  });
});

describe('GameHub (logged out — via RpsHub)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('browsing stays open: the bet selector works + PLAY arms, but the chip is "Sign in" and the feed is the logged-out carousel', () => {
    const onPlay = vi.fn();
    const onTrackChallenges = vi.fn();
    render(<RpsHubScreen {...baseProps({ loggedIn: false, token: '', onPlay, onTrackChallenges })} />);
    // Sign-in chip, not a fake balance; the same GamesCarousel the Home hub uses, in its
    // logged-out (public-poll) mode — not the old teaser card, not the signed-in WS ticker.
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.getByTestId('games-carousel')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-section-challenges-teaser')).toBeNull();
    expect(onTrackChallenges).not.toHaveBeenCalled(); // no WS feed while logged out
    // Browsing + arming a bet is allowed; the auth wall fires in the App at PLAY.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('initialStake pre-arms the bet (the join-fallback lands here ready to post)', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 25 })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // pre-armed → PLAY ready immediately
  });
});

// Ticket 2026-09-11#9 (ADVISOR_TO_PM.md): a deliberate Owner-directed REVERSAL of #387's
// `searchFloorMs={0}`. RPS's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS,
// resolves ONLY at expiry — never early); restoring the ~3.8s "Searching…"/"found"/"split" dwell
// floor now deliberately holds `phase` at 'waiting' for that beat even when `currentMatchId` is
// already set, matching the prototype's `startRps()` timing (`Full Spec.html:3291-3313`) — accepting
// that this eats into the player's SEEN share of the already-ticking server window (see the code
// comment at RpsHub.tsx's `searchFloorMs` prop for the full rationale). This replaces the old
// "bypassed (#387)" behavior the tests below used to assert.
describe('RpsHubScreen — search dwell floor restored (2026-09-11#9)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds at waiting (throw buttons hidden, VS label shown) through the ~3.8s dwell floor even when currentMatchId is already set, then reveals the throw buttons once the floor elapses', () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay })} />);
      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)
      expect(onPlay).toHaveBeenCalledWith(10);

      // The server pairs the match immediately (as can genuinely happen) — rerender with a live match
      // and NO time elapsed. The restored ~3.8s dwell floor holds `phase` at 'waiting' regardless.
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
      rerender(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay, currentMatchId: 'm1', gameState })} />);

      expect(screen.queryByTestId('hub-move-rock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hub-move-paper')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hub-move-scissors')).not.toBeInTheDocument();
      // T5: `matchForming` (phase 'waiting' with a currentMatchId already assigned) is exactly the
      // window the restored floor now holds open — the shared VS label arms for RPS again.
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      // Ticket 2026-09-11#10 item 1: the same `matchForming` window now also slides the bars toward
      // the VS label — RPS uses the prototype's own flat fallback magnitude (`Full Spec.html:3754`'s
      // `!gameV` branch), opponent bar +123px, player bar -123px.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(123px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-123px)');
      // Ticket 2026-09-12#1 item 1 (ADVISOR_TO_PM.md): explicit z-[3] on both sliding bars — above
      // the VS label's z-[2] and the un-indexed RPS card block — so the slide-to-center motion paints
      // in front of the board instead of behind it (Full Spec.html:436/:660).
      expect(screen.getByTestId('hub-slot-opponent').className).toContain('z-[3]');
      expect(screen.getByTestId('hub-slot-own').className).toContain('z-[3]');
      // Item 1's second half: the RPS card block itself fades to 28% opacity while the bars slide
      // (`rpsBoardOp`, Full Spec.html:3795) — the table recedes so the bars stand out against it.
      expect(screen.getByTestId('hub-rps-panel').style.opacity).toBe('0.28');

      // Advance past the restored ~3.8s floor — the hold clears and the throw buttons render.
      act(() => { vi.advanceTimersByTime(3800); });

      expect(screen.getByTestId('hub-move-rock')).toBeInTheDocument();
      expect(screen.getByTestId('hub-move-paper')).toBeInTheDocument();
      expect(screen.getByTestId('hub-move-scissors')).toBeInTheDocument();
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
      // Slides back to 0 the same beat `in-match` takes over (prototype's `found`→`split` beat).
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
      // The table un-dims the same beat the slide-back happens (`barSlideActive` is false in-match).
      expect(screen.getByTestId('hub-rps-panel').style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticket 2026-09-11#10 item 1: the bar-slide also arms during pure searching (no match yet), matching the prototype\'s rpsMatching flag covering BOTH its searching and found sub-states', () => {
    vi.useFakeTimers();
    try {
      render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000 })} />);
      // No currentMatchId at all — this is the prototype's `rpsMatch === 'searching'` sub-state, not
      // `found`, yet `rpsMatching` (Full Spec.html:3517-3530) is true for both, so the slide is armed.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(123px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-123px)');
      expect(screen.getByTestId('hub-rps-panel').style.opacity).toBe('0.28');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RpsHubScreen — opponent bar during matchmaking (ticket 2026-09-15#9)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('item 1: "Searching…" is its own absolutely-positioned element, split apart from the scanned name (not one inline row)', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000, challengesByGame: { rps: [CHALLENGE] } })} />);
    const opp = within(screen.getByTestId('hub-slot-opponent'));
    const label = opp.getByText('Searching…');
    expect(label.className).toContain('absolute');
    const scan = opp.getByTestId('hub-search-scan');
    // Not a descendant of "Searching…"'s own element, and not the other way around — two
    // structurally separate pieces, matching the prototype's own two-piece split.
    expect(label.contains(scan)).toBe(false);
    expect(scan.contains(label)).toBe(false);
  });

  it('item 2: the avatar+name group blurs while searching', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000, challengesByGame: { rps: [CHALLENGE] } })} />);
    const opp = within(screen.getByTestId('hub-slot-opponent'));
    const avatar = opp.getByTestId('avatar');
    expect(avatar.parentElement?.className).toContain('blur-[4.5px]');
  });

  it('item 3: the avatar hashes from the scanned name while searching, not the neutral default', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000, challengesByGame: { rps: [CHALLENGE] } })} />);
    const opp = within(screen.getByTestId('hub-slot-opponent'));
    const avatar = opp.getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar-id')).not.toBe('default');
    expect(avatar.getAttribute('data-avatar-id')).toMatch(/^rc-\d\d$/);
    expect(opp.getByTestId('avatar-img')).toBeInTheDocument(); // a real preset image, not the neutral glyph
  });

  it('item 4: the scanned name strips the bot-disclosure emoji, reusing GamesCarousel\'s displayHostName', () => {
    const botChallenge: OpenChallenge = { matchId: 'c2', ownerName: '🤖@sweeper', ownerTier: 'Unranked', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };
    render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000, challengesByGame: { rps: [botChallenge] } })} />);
    const scan = within(screen.getByTestId('hub-slot-opponent')).getByTestId('hub-search-scan');
    expect(scan.textContent).toBe('@sweeper');
    expect(scan.textContent).not.toContain('🤖');
  });
});

// Ticket 2026-09-22#4 (D41): the prototype's own pick-tile markup is genuinely just one `<svg>` —
// no text label at either usage — plus 2 precise selection-ring value corrections and the (deliberately-
// implemented, despite being unreferenced dead code in the prototype's own source) icon-colour swap.
describe('RpsHubScreen — pick-tile labels and selection green (ticket 2026-09-22#4/D41)', () => {
  it('item 1: no text label under the hand icon, in either the idle preview or the live picker', () => {
    const { rerender } = render(<RpsHubScreen {...baseProps()} />);
    expect(screen.queryByText(/rock/i)).toBeNull();
    expect(screen.queryByText(/paper/i)).toBeNull();
    expect(screen.queryByText(/scissors/i)).toBeNull();

    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    rerender(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    // aria-label carries the name for a11y — not a rendered text node — the live picker buttons
    // still exist and are still accessible, just with no visible caption underneath the icon.
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-label')).toBe('Rock');
    expect(screen.queryByText(/^rock$/i)).toBeNull();
    expect(screen.queryByText(/^paper$/i)).toBeNull();
    expect(screen.queryByText(/^scissors$/i)).toBeNull();
  });

  it('item 2: the unselected ring is color-matched zero-alpha green, not CSS transparent black; selected uses the literal win-green; easing is plain "ease"', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    const rock = screen.getByTestId('hub-move-rock');
    const paper = screen.getByTestId('hub-move-paper');
    // Ticket 2026-09-25#2 item 2: the ring moved off `var(--rc-green)` to the literal `#16A34A`
    // win-green (the RPS/Mines/Dice color-unification rule) — its zero-alpha pair moved with it.
    expect(rock.style.boxShadow).toBe('inset 0 0 0 3px #16A34A');
    expect(paper.style.boxShadow).toBe('inset 0 0 0 3px rgba(22,163,74,0)');
    expect(paper.className).toMatch(/(?:^|\s)ease(?:\s|$)/);
    expect(paper.className).not.toMatch(/ease-out/);
  });

  it('ticket 2026-09-25#1 item 2: the picker icon stays full multi-tone purple whether selected or not — the D41 white/--rc-muted override is reverted (Designer\'s own correction)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    const rockIcon = within(screen.getByTestId('hub-move-rock')).getByRole('img', { name: 'Rock' });
    const paperIcon = within(screen.getByTestId('hub-move-paper')).getByRole('img', { name: 'Paper' });
    // Both selected (rock) and unselected (paper) picker icons render their original literal fills —
    // no color override at either state, matching every other RpsHandIcon call site in the file.
    expect(rockIcon.querySelector('path')?.getAttribute('fill')).toBe('#B285F7');
    expect(paperIcon.querySelector('path')?.getAttribute('fill')).toBe('#B285F7');
    // The idle preview's own icon (pre-match, no picker context) is unaffected either way.
    const { container, unmount } = render(<RpsHubScreen {...baseProps()} />);
    const idleRock = container.querySelector('[data-rc-rps-icon="rock"]');
    expect(idleRock?.querySelector('path')?.getAttribute('fill')).toBe('#B285F7');
    unmount();
  });

  it('ticket 2026-09-25#1 item 1: no "You (username)" / "Picked X — tap another…" captions, and no Forfeit button, anywhere on the live board', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    expect(screen.queryByTestId('hub-my-pick')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hub-locked')).not.toBeInTheDocument();
    expect(screen.queryByText(/You \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Picked .* — tap another/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forfeit' })).not.toBeInTheDocument();
  });

  it('ticket 2026-09-25#1 item 3: RpsBoard remounts per match (keyed on currentMatchId) — a stale LOCAL optimisticPick from a finished match never carries into the next one even when round stays 0', () => {
    // The bug this guards is client-local state (optimisticPick), not server-echoed choices — a tap
    // sets it immediately, ahead of the server round-trip, and it's normally cleared by the
    // [round]-keyed reset effect. Drive it via a real tap, not an injected gameState.choices, or the
    // test never touches the actual stale state the per-match key exists to clear.
    const gameStateM1: RpsView = { players: ['pid', 'bob'], choices: {}, round: 0 };
    const { rerender } = render(
      <RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState: gameStateM1, legalMoves: ['rock', 'paper', 'scissors'] })} />,
    );
    fireEvent.click(screen.getByTestId('hub-move-rock'));
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('true');
    // Next match forms with a bot near-instantly (RPS's own searchFloorMs={0}) — round is 0 again
    // (rps.ts only bumps round on a tie-replay), the exact case the [round]-only reset effect misses.
    const gameStateM2: RpsView = { players: ['pid', 'carol'], choices: {}, round: 0 };
    rerender(<RpsHubScreen {...baseProps({ currentMatchId: 'm2', opponentId: 'carol', gameState: gameStateM2, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('false');
  });
});
