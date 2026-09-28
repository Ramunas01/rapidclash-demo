import { useEffect, useState } from 'react';

/**
 * App-wide selected-currency singleton (`docs/COMMS/ADVISOR_TO_PM.md` 2026-09-13#6 item 2) —
 * mirrors `theme.ts`'s module-level singleton + subscribe/notify shape exactly (this app's house
 * pattern for small pieces of global client state; no React Context anywhere in `apps/web`).
 *
 * Promoted out of `CurrencyPicker.tsx`'s own local `useState('USD')` (issue #530): Designer's
 * spec for the Open Games carousel (`GamesCarousel.tsx`'s `AmountFigure`) requires every row
 * across the app to reflect the SAME selected wallet currency and switch together the moment the
 * picker changes it — a per-component-instance `useState` structurally can't do that, since only
 * one screen position (`HubRibbon.tsx`'s wallet chip) ever mounted `CurrencyPicker` before.
 *
 * Deliberately NOT persisted to localStorage (unlike `theme.ts`'s choice) — a per-session default,
 * matching the prototype's own behavior.
 *
 * `DEFAULT_CURRENCY = 'SOL'` matches the prototype's own `curSel` default (`Full Spec.html:3579`,
 * `this.state.curSel || 'SOL'`). Ticket `2026-09-27#7` (D69) is a deliberate reversal of the
 * PREVIOUS USD-default decision recorded here (`2026-09-11#5`, re-affirmed `2026-09-16#3`): that
 * decision's own reasoning was "the trigger must show the user's REAL balance by default, not the
 * prototype's mock SOL figure" — reasoning that applied only while non-USD balances were mock
 * data. Now that every currency (including SOL) shows its own real ledger balance (D69 PR 4), that
 * reasoning no longer holds, and the ticket's own title ("real per-currency balances + SOL
 * default") and Owner's explicit sign-off (`2026-09-28#1`, "nothing left open in this ticket's own
 * scope") both call for SOL, not USD. Corrected 2026-09-28 after Advisor's PR 4 review caught this
 * half of the ticket had been missed during implementation — see `docs/COMMS/ADVISOR_TO_PM.md`.
 */

const DEFAULT_CURRENCY = 'SOL';

let curSel: string = DEFAULT_CURRENCY;

const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

export function getCurSel(): string {
  return curSel;
}

/** Sets the app-wide selected currency and notifies every subscriber (e.g. every `useCurSel()`
 *  call anywhere in the tree — `CurrencyPicker`'s own trigger/panel AND `GamesCarousel`'s
 *  logged-in stake rows, kept in sync without either knowing about the other). */
export function setCurSel(next: string): void {
  curSel = next;
  notify();
}

/** Subscribe to currency-selection changes. Returns an unsubscribe function. */
export function subscribeCurSel(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: the current selected currency symbol + a setter. Any component anywhere in the
 *  tree can call this — the selection is global, not scoped to one screen. */
export function useCurSel(): { curSel: string; setCurSel(next: string): void } {
  const [state, setState] = useState(() => getCurSel());
  useEffect(() => subscribeCurSel(() => setState(getCurSel())), []);
  return { curSel: state, setCurSel };
}
