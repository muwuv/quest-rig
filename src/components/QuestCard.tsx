import { memo } from "react";
import type { VideoQuest } from "../lib/quests";
import { formatClock } from "../lib/quests";
import { PressDepth } from "./ui/press-depth";
import { QuestRing } from "./QuestRing";

export const QuestCard = memo(function QuestCard({
  vq,
  active,
  busy,
  note,
  onWatch,
  onClaim,
  onStop,
}: {
  vq: VideoQuest;
  active: boolean;
  busy: boolean;
  note: string | null;
  onWatch: (vq: VideoQuest) => void;
  onClaim: (vq: VideoQuest) => void;
  onStop: () => void;
}) {
  const pct = vq.target > 0 ? Math.min(100, (vq.value / vq.target) * 100) : 0;
  return (
    <li className="quest-card">
      {vq.art ? (
        <div className="quest-banner">
          <img src={vq.art} alt="" loading="lazy" decoding="async" draggable={false} />
        </div>
      ) : (
        <div className="quest-banner blank">
          <span>{vq.name.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      <div className="quest-body">
        <div className="spot-head">
          <QuestRing art={vq.art} name={vq.name} pct={pct} done={vq.completed || vq.claimed} />
          <div className="spot-title">
            <h1 title={vq.name}>{vq.name}</h1>
            <p className="exe" title={vq.reward}>{vq.reward}</p>
          </div>
        </div>
        <div className="launch-row">
          {vq.excluded ? (
            <span className="sess-status">Not eligible</span>
          ) : vq.claimed ? (
            <PressDepth variant="success" block depth={4} tilt={4} faceHeight={34} disabled>
              Claimed
            </PressDepth>
          ) : vq.completed ? (
            <PressDepth
              variant="primary"
              block
              depth={4}
              tilt={4}
              faceHeight={34}
              disabled={busy}
              onClick={() => void onClaim(vq)}
            >
              {busy ? "…" : "Claim reward"}
            </PressDepth>
          ) : active ? (
            <PressDepth
              variant="success"
              block
              depth={4}
              tilt={4}
              faceHeight={34}
              onClick={onStop}
            >
              Watching — stop
            </PressDepth>
          ) : (
            <PressDepth
              variant="primary"
              block
              depth={4}
              tilt={4}
              faceHeight={34}
              disabled={busy}
              onClick={() => void onWatch(vq)}
            >
              {busy ? "Starting…" : `Watch ${formatClock(vq.target)}`}
            </PressDepth>
          )}
        </div>
        {note !== null && <p className="vq-note">{note}</p>}
      </div>
    </li>
  );
});
