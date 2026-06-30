/**
 * Shared layout for a hub on BODY scroll (#142). The shell no longer owns a fixed-height
 * inner scroll surface — the document body scrolls, which is what lets iOS Safari collapse and
 * return its toolbar. HubRibbon is `position: sticky; top: 0` (in-flow at the top, so it owns
 * the top clearance); HubToolbar stays `position: fixed` at the bottom. Content runs
 * top-to-bottom and slides behind the transparent bars (matching the design frame).
 *
 *   <div className={HUB_SHELL}>
 *     <HubRibbon … />                                  // sticky top (in-flow)
 *     <main data-testid="…"><div className={cn('…', HUB_BODY)}>…</div></main>
 *     <HubToolbar … />                                 // fixed bottom
 *   </div>
 *
 * HUB_BODY pads the content so the last item clears the fixed toolbar (the nav pill ~84px +
 * the bottom safe-area) and nothing is ever hidden behind it. There is no top pad: the
 * sticky ribbon is in-flow, so it already reserves the ~96px wordmark band itself.
 */
export const HUB_SHELL = 'relative min-h-[100dvh] bg-background text-foreground';
export const HUB_BODY = 'pb-[calc(7rem_+_env(safe-area-inset-bottom))]';
