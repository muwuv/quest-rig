import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { VideoQuest } from "../lib/quests";
import { ShaderAnimation } from "../components/ui/shader-animation";
import { ShaderBackground } from "../components/ui/adisyon-shader";
import { QuestCard } from "../components/QuestCard";
import { TokenEntry } from "./TokenEntry";

export type VFilter = "all" | "done" | "todo";

const VFILTERS = [
  {
    key: "all",
    label: "All quests",
    icon: (
      <>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </>
    ),
  },
  {
    key: "todo",
    label: "To do",
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v3l2 1.2" />
      </>
    ),
  },
  {
    key: "done",
    label: "Done",
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M5.5 8.2l1.8 1.8 3.2-3.6" />
      </>
    ),
  },
] as const;

export function VideoView({
  token,
  draft,
  onDraft,
  onSubmitToken,
  tokenChecking,
  tokenErr,
  vquests,
  vfilter,
  setVfilter,
  watching,
  vbusy,
  vnote,
  vloading,
  verror,
  onReload,
  onWatch,
  onClaim,
  onStop,
}: {
  token: string;
  draft: string;
  onDraft: (v: string) => void;
  onSubmitToken: () => void;
  tokenChecking: boolean;
  tokenErr: string | null;
  vquests: VideoQuest[];
  vfilter: VFilter;
  setVfilter: (f: VFilter) => void;
  watching: { id: string } | null;
  vbusy: string | null;
  vnote: { id: string; text: string } | null;
  vloading: boolean;
  verror: string | null;
  onReload: () => void;
  onWatch: (vq: VideoQuest) => void;
  onClaim: (vq: VideoQuest) => void;
  onStop: () => void;
}) {
  const fqRef = useRef<HTMLDivElement>(null);
  const [fglider, setFglider] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      const root = fqRef.current;
      if (!root) return;
      const active = root.querySelector(".fchip.on") as HTMLElement | null;
      if (!active) return;
      setFglider({ left: active.offsetLeft, width: active.offsetWidth });
    };
    update();
    raf = requestAnimationFrame(update);
    try {
      (document as any).fonts?.ready?.then?.(() => update())?.catch?.(() => {});
    } catch {
      /* ignore */
    }
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [vfilter, vquests.length]);

  const visibleQuests = useMemo(
    () =>
      vquests.filter((vq) =>
        vfilter === "all" ? true : vfilter === "done" ? vq.completed || vq.claimed : !vq.completed && !vq.claimed,
      ),
    [vquests, vfilter],
  );

  return (
    <section className="video-view">
      <div className="video-scroll">
        {!token ? (
          <>
            <div className="token-shader" aria-hidden="true">
              <ShaderBackground />
              <div className="token-lines">
                <ShaderAnimation />
              </div>
            </div>
            <TokenEntry
              draft={draft}
              onDraft={onDraft}
              onSubmit={onSubmitToken}
              checking={tokenChecking}
              err={tokenErr}
            />
          </>
        ) : (
          <>
            <div className="vq-toolbar">
              <div className="vq-filter" role="tablist" aria-label="Quest filter" ref={fqRef}>
                <span
                  className="fglider"
                  aria-hidden="true"
                  style={{ left: fglider.left, width: fglider.width }}
                />
                {VFILTERS.map(({ key, label, icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={vfilter === key}
                    title={label}
                    aria-label={label}
                    className={`fchip${vfilter === key ? " on" : ""}`}
                    onClick={() => setVfilter(key)}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      {icon}
                    </svg>
                    <span className="fchip-label">{label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Reload quests"
                aria-label="Reload quests"
                onClick={() => void onReload()}
                disabled={vloading}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.9 0 3.5 0.9 4.5 2.3M12.5 1.5v3h-3" />
                </svg>
              </button>
            </div>
          </>
        )}

        {token.trim() !== "" && (
          <>
            {verror && (
              <div className="card">
                <p className="vq-err">{verror}</p>
              </div>
            )}
            {vloading && vquests.length === 0 && (
              <div className="card">
                <p className="signals-empty">Loading quests…</p>
              </div>
            )}
            {token.trim() !== "" && vquests.length === 0 && !vloading && !verror && (
              <div className="card">
                <p className="signals-empty">No video quests right now. Hit Reload to check again.</p>
              </div>
            )}
            {vquests.length > 0 && (
              <ul className="quest-grid">
                {visibleQuests.map((vq) => (
                  <QuestCard
                    key={vq.id}
                    vq={vq}
                    active={watching?.id === vq.id}
                    busy={vbusy === vq.id}
                    note={vnote?.id === vq.id ? vnote.text : null}
                    onWatch={onWatch}
                    onClaim={onClaim}
                    onStop={onStop}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
