import boltDecor from '../../assets/brand/bolt-decor.webp';

/**
 * "Bring a Rival" promo card (frame 1:1). Static for now — the invite-link feature isn't built,
 * so the button is visibly inert. Shared by the Home hub and every Game hub.
 */
export function BringARival() {
  return (
    <section data-testid="home-rival" aria-label="Bring a rival" className="px-4">
      <div className="relative overflow-hidden rounded-[14px] border border-border bg-surface px-5 pb-5 pt-[18px]">
        <div className="pointer-events-none absolute -bottom-[18px] -right-[10px] h-[120px] w-[120px]">
          <img src={boltDecor} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <h3 className="relative text-[17px] font-extrabold">Bring a Rival</h3>
        <p className="relative mt-1.5 max-w-[74%] text-[12.5px] leading-relaxed text-muted-foreground">
          Send a match link. They join, you both stake, the winner takes the pot.
        </p>
        <button
          type="button"
          aria-disabled="true"
          className="relative mt-3.5 inline-flex cursor-default items-center gap-2 rounded-[10px] bg-brand px-4 py-2.5 text-[13px] font-bold text-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 9v6M21 12h-6" /></svg>
          Challenge a friend
        </button>
      </div>
    </section>
  );
}
