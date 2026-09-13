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
 * Deliberately NOT persisted to localStorage (unlike `theme.ts`'s choice): the prototype's own
 * `curSel` lives in plain `this.state`, defaulting to `'USD'` fresh on every load, with no
 * read-back from storage anywhere in the decoded template — and every non-USD value it drives is
 * `currencyData.ts`'s own hardcoded MOCK balance, never the real ledger (see that file's own doc
 * comment), so there's no real state here worth surviving a reload.
 */

const DEFAULT_CURRENCY = 'USD';

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
