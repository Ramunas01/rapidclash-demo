import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isMuted, toggleMute, subscribe, unlock } from '../../lib/sound.js';

/**
 * Speaker / muted-speaker toggle for the shared header. Self-contained: it reads and
 * writes the sound module directly (no prop threading), and re-renders on any mute change
 * via the module's subscribe(). Default = sound ON (unmuted); the choice persists.
 */
export function MuteToggle() {
  const [muted, setMuted] = useState(isMuted());
  useEffect(() => subscribe(() => setMuted(isMuted())), []);

  return (
    <button
      type="button"
      onClick={() => {
        unlock(); // a tap here is a user gesture — a good moment to unlock audio too
        toggleMute();
      }}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      data-testid="hub-mute-toggle"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
}
