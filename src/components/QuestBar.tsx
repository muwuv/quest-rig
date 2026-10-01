import { QUEST_TARGET_SEC } from "../lib/quests";

export function QuestBar({ elapsed }: { elapsed: number }) {
  const pct = Math.min(100, (elapsed / QUEST_TARGET_SEC) * 100);
  const done = elapsed >= QUEST_TARGET_SEC;
  return (
    <div className={`qbar ${done ? "done" : ""}`}>
      <div className="qbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
