/**
 * Shared layout for a hub with FIXED-overlay chrome. HubRibbon and HubToolbar are
 * `position: fixed` and float above a single full-viewport scroll surface, so content runs
 * top-to-bottom and slides behind the transparent bars (matching the design frame) — no
 * inner / middle-box scrollbar.
 *
 *   <div className={HUB_SHELL}>
 *     <HubRibbon … />                                  // fixed top
 *     <main data-testid="…"><div className={cn('…', HUB_BODY)}>…</div></main>
 *     <HubToolbar … />                                 // fixed bottom
 *   </div>
 *
 * HUB_BODY pads the content so the first/last item clears the fixed bars and nothing is ever
 * hidden behind them: the ribbon is the wordmark band (~96px) and the toolbar is the nav pill
 * (~84px). Kept in one place so the clearance and the bar heights stay in lockstep.
 */
export const HUB_SHELL = 'relative h-[100dvh] overflow-y-auto no-scrollbar bg-background text-foreground';
export const HUB_BODY = 'pt-24 pb-28';
