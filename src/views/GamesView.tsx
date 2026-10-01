import type { CSSProperties, Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";
import {
  QUEST_TARGET_SEC,
  exeKey,
  formatClock,
  formatTotal,
  shortDate,
  type FarmState,
  type GameRow,
  type PlayQuest,
  type ProcessInfo,
} from "../lib/quests";
import { PressDepth } from "../components/ui/press-depth";
import { QuestBar } from "../components/QuestBar";
import { ChevronDownIcon, SaveAddIcon, SaveIcon } from "../icons";

export function GamesView({
  loadingGames,
  loadError,
  loadGames,
  query,
  setQuery,
  searchRef,
  filtered,
  selected,
  setSelectedIdx,
  leavingId,
  flashId,
  pinned,
  runningExes,
  busyId,
  isPinned,
  selectedRunning,
  startGame,
  togglePin,
  hasToken,
  playable,
  processes,
  nowSec,
  leavingPid,
  stopProcess,
  farm,
  iconByExe,
  leavingStash,
  dropStashed,
  resumeStashed,
  helpOpen,
  onToggleHelp,
}: {
  loadingGames: boolean;
  loadError: string | null;
  loadGames: () => void;
  query: string;
  setQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  filtered: GameRow[];
  selected: GameRow | null;
  setSelectedIdx: Dispatch<SetStateAction<number>>;
  leavingId: string | null;
  flashId: string | null;
  pinned: string[];
  runningExes: Set<string>;
  busyId: string | null;
  isPinned: boolean;
  selectedRunning: boolean;
  startGame: (game: GameRow) => void;
  togglePin: (id: string) => void;
  hasToken: boolean;
  playable: { game: GameRow; quest: PlayQuest }[];
  processes: ProcessInfo[];
  nowSec: number;
  leavingPid: number | null;
  stopProcess: (pid: number) => void;
  farm: FarmState;
  iconByExe: Map<string, string | null>;
  leavingStash: string | null;
  dropStashed: (exePath: string) => void;
  resumeStashed: (exePath: string) => void;
  helpOpen: boolean;
  onToggleHelp: () => void;
}) {
  const totalRunSec = processes.reduce((acc, p) => acc + (nowSec - p.startedAt), 0);
  const questDoneCount = processes.filter((p) => nowSec - p.startedAt >= QUEST_TARGET_SEC).length;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      void startGame(selected);
    } else if (e.key === "Escape") {
      setQuery("");
      (e.target as HTMLElement).blur();
    }
  };

  return (
    <>
      {/* Library */}
      <section className="library">
        <div className="toolbar">
          <div className="searchbox">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search games…  ( / to focus )"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="clear-btn"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
            <span className="count">{filtered.length}</span>
          </div>
        </div>

        {loadError && (
          <button className="retry" type="button" onClick={() => void loadGames()}>
            Catalog is offline — click to retry
          </button>
        )}

        <div className="covers">
          {loadingGames &&
            Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="cover skeleton" style={{ "--d": `${(i % 6) * 60}ms` } as CSSProperties} />
            ))}
          {!loadingGames &&
            filtered.map((game, i) => {
              const live = runningExes.has(exeKey(game.exeName));
              const isPin = pinned.includes(game.id);
              return (
                <div
                  key={`${game.id}-${game.exeName}`}
                  className={`cover ${selected?.id === game.id ? "on" : ""}${leavingId === game.id ? " leaving" : ""}${flashId === game.id ? " flash" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedIdx(i);
                  }}
                  onDoubleClick={() => void startGame(game)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelectedIdx(i);
                  }}
                >
                  <span className="cover-frame">
                    {game.iconUrl ? (
                      <img src={game.iconUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="cover-fallback">{game.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="cover-meta">
                    <em>{game.name}</em>
                    <span className="cover-exe">{game.exeName}</span>
                  </span>
                  <span className="cover-flags">
                    {live && <b className="pin-flag live-flag">Live</b>}
                  </span>
                  <button
                    type="button"
                    className={`row-pin ${isPin ? "on" : ""}`}
                    title={isPin ? "Unpin" : "Pin to top"}
                    aria-label={isPin ? "Unpin" : "Pin to top"}
                    aria-pressed={isPin}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(game.id);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <span className="row-pin-icon" key={isPin ? "saved" : "add"}>
                      {isPin ? <SaveIcon /> : <SaveAddIcon />}
                    </span>
                  </button>
                </div>
              );
            })}
          {!loadingGames && filtered.length === 0 && (
            <p className="empty">No games found for “{query}”</p>
          )}
        </div>
      </section>

      {/* Detail panel */}
      <aside className="panel">
        <div className="panel-scroll">
          <div className="card spotlight">
            {selected ? (
              <>
                {selected.bannerUrl && (
                  <div className="spot-banner" key={selected.id}>
                    <img
                      src={selected.bannerUrl}
                      alt=""
                      draggable={false}
                      onLoad={(e) => e.currentTarget.classList.add("ld")}
                      onError={(e) => {
                        const b = e.currentTarget.closest(".spot-banner");
                        if (b) (b as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
                <div className="spot-head">
                  <span className="spot-frame">
                    {selected.iconUrl ? (
                      <img src={selected.iconUrl} alt="" />
                    ) : (
                      <span className="cover-fallback big">
                        {selected.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <div className="spot-title">
                    <h1 title={selected.name}>{selected.name}</h1>
                    <p className="exe" title={selected.exeName}>{selected.exeName}</p>
                  </div>
                </div>
                <div className="launch-row">
                  <div className="launch-group">
                    <PressDepth
                      variant={selectedRunning ? "success" : "primary"}
                      join="left"
                      depth={4}
                      tilt={5}
                      faceHeight={34}
                      style={{ flex: 1, minWidth: 0 }}
                      block
                      disabled={busyId !== null || selectedRunning}
                      onClick={() => void startGame(selected)}
                      title={
                        selectedRunning
                          ? "Already running"
                          : "Run as a background window — Discord picks it up within ~30s"
                      }
                    >
                      {busyId === selected.id
                        ? "Starting…"
                        : selectedRunning
                          ? "Running"
                          : "Launch"}
                    </PressDepth>
                    <PressDepth
                      variant={isPinned ? "success" : "primary"}
                      join="right"
                      icon
                      depth={4}
                      tilt={4}
                      faceHeight={34}
                      style={{ width: 46, flex: "none" }}
                      title={isPinned ? "Unpin" : "Pin to top"}
                      ariaLabel={isPinned ? "Unpin" : "Pin to top"}
                      onClick={() => togglePin(selected.id)}
                    >
                      <span className="save-swap" key={isPinned ? "saved" : "add"}>
                        {isPinned ? <SaveIcon /> : <SaveAddIcon />}
                      </span>
                    </PressDepth>
                  </div>
                </div>
              </>
            ) : (
              <div className="spot-title">
                <h1 className="idle">{loadingGames ? "Loading catalog…" : "Select a game"}</h1>
                <p className="exe">Search on the left, then launch it here.</p>
              </div>
            )}
          </div>

          {hasToken && playable.length > 0 && (
            <div className="card">
              <div className="section-head">
                <span className="label">Playable now</span>
                <span className="label dim">
                  {playable.length} {playable.length === 1 ? "quest" : "quests"}
                </span>
              </div>
              <ul className="play-list">
                {playable.map(({ game, quest }) => {
                  const live = runningExes.has(exeKey(game.exeName));
                  const ends = shortDate(quest.endsAt);
                  return (
                    <li key={quest.questId}>
                      <span className="sess-icon">
                        {game.iconUrl ? (
                          <img src={game.iconUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="sess-fallback">
                            {game.name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="vq-meta">
                        <span className="vq-name">
                          <strong title={game.name}>{game.name}</strong>
                        </span>
                        <span className="vq-reward" title={quest.name}>
                          {quest.name}
                          {ends ? ` · ends ${ends}` : ""}
                        </span>
                      </span>
                      <PressDepth
                        variant={live ? "success" : "secondary"}
                        depth={3}
                        tilt={5}
                        faceHeight={26}
                        disabled={busyId !== null || live}
                        onClick={() => void startGame(game)}
                      >
                        {live ? "Live" : "Launch"}
                      </PressDepth>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="card signals">
            <div className="section-head">
              <span className="label">Active</span>
              <span className="label dim">
                {processes.length > 0
                  ? `${processes.length} running · ${formatTotal(totalRunSec)}${questDoneCount ? ` · ${questDoneCount} ready` : ""}`
                  : "Idle"}
              </span>
            </div>

            <p className="totals">
              Total {formatTotal(farm.totals.sec)} · {farm.totals.runs}{" "}
              {farm.totals.runs === 1 ? "run" : "runs"}
            </p>

            {processes.length === 0 ? (
              <p className="signals-empty">
                Nothing running. Launch a game and the 15-minute timer will tick here.
              </p>
            ) : (
              <ul>
                {processes.map((p) => {
                  const elapsed =
                    Math.max(0, nowSec - p.startedAt) + (p.accumulated || 0);
                  const done = elapsed >= QUEST_TARGET_SEC;
                  return (
                    <li key={p.pid} className={`row-collapse${leavingPid === p.pid ? " leaving" : ""}`}>
                      <div className="collapse-inner">
                        <div className="sess-card">
                          <div className="sess-top">
                            <span className={`sess-icon${done ? " done" : ""}`}>
                              {iconByExe.get(exeKey(p.exePath)) ? (
                                <img src={iconByExe.get(exeKey(p.exePath))!} alt="" loading="lazy" />
                              ) : (
                                <span className="sess-fallback">{p.name.slice(0, 2).toUpperCase()}</span>
                              )}
                            </span>
                            <strong title={p.name}>{p.name}</strong>
                            <span className="sess-clock">{formatClock(elapsed)}</span>
                            <button
                              className="stop"
                              disabled={busyId !== null}
                              onClick={() => void stopProcess(p.pid)}
                              aria-label="Stop"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="sess-bottom">
                            <QuestBar elapsed={elapsed} />
                            <span className={`sess-status ${done ? "ok" : ""}`}>
                              {done ? "Ready to claim" : `${formatClock(QUEST_TARGET_SEC - elapsed)} left`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {farm.stash.length > 0 && (
            <div className="card">
              <div className="section-head">
                <span className="label">Paused</span>
                <span className="label dim">Resume where it stopped</span>
              </div>
              <ul className="stash-list">
                {farm.stash.map((s) => (
                  <li key={s.exePath} className={`row-collapse${leavingStash === s.exePath ? " leaving" : ""}`}>
                    <div className="collapse-inner">
                      <div className="sess-card">
                        <div className="sess-top">
                          <span className="sess-icon">
                            {iconByExe.get(exeKey(s.exePath)) ? (
                              <img src={iconByExe.get(exeKey(s.exePath))!} alt="" loading="lazy" />
                            ) : (
                              <span className="sess-fallback">{s.name.slice(0, 2).toUpperCase()}</span>
                            )}
                          </span>
                          <strong title={s.name}>{s.name}</strong>
                          <span className="sess-clock">{formatClock(s.accumulated)}</span>
                          <button
                            className="stop"
                            disabled={busyId !== null}
                            onClick={() => void dropStashed(s.exePath)}
                            aria-label="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="sess-bottom">
                          <span className="sess-status">
                            Saved {formatClock(s.accumulated)} of 15:00
                          </span>
                          <PressDepth
                            variant="secondary"
                            depth={3}
                            tilt={5}
                            faceHeight={26}
                            disabled={busyId !== null}
                            onClick={() => void resumeStashed(s.exePath)}
                          >
                            Resume
                          </PressDepth>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <button className="help-toggle" type="button" onClick={onToggleHelp}>
              <span className={`chev ${helpOpen ? "open" : ""}`}>
                <ChevronDownIcon />
              </span>
              Discord doesn't see the game?
            </button>
            <div className={`collapse${helpOpen ? " open" : ""}`}>
              <div className="collapse-inner">
                <ol className="help">
                  <li>
                    Discord → Settings → <b>Privacy Settings</b> → turn on “Share detected
                    activity”. Otherwise detection is shown to no one — including you.
                  </li>
                  <li>
                    Check <b>Settings → Activity Status</b>: detected games appear there. Your
                    fake should be listed.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
