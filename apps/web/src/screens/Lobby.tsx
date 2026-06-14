interface Props {
  stake: number;
  onLeave(): void;
}

export function LobbyScreen({ stake, onLeave }: Props) {
  return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>⏳</div>
      <h1>Waiting for opponent…</h1>
      <p>Stake: {stake} credits</p>
      <div style={{ margin: '32px 0' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <button className="btn btn-secondary" onClick={onLeave}>Leave Queue</button>
    </div>
  );
}
