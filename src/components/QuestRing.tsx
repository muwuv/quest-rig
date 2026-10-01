import orbUrl from "../assets/orb.webm";

export function QuestRing({
  name,
  pct,
  done,
}: {
  art: string | null;
  name: string;
  pct: number;
  done: boolean;
}) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const fill = Math.max(0, Math.min(1, pct / 100));
  return (
    <span className={`quest-ring${done ? " done" : ""}`} title={done ? `${name} — done` : `${name} — ${Math.floor(pct)}%`}>
      <video className="qr-orb" src={orbUrl} autoPlay loop muted playsInline />
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="qr-track" cx="24" cy="24" r={R} />
        <circle
          className="qr-fill"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={`${fill * C} ${C}`}
        />
      </svg>
    </span>
  );
}
