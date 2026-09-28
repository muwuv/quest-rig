import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDownIcon, SaveAddIcon, SaveIcon } from "./icons";

type ProcessInfo = {
  pid: number;
  name: string;
  exePath: string;
  startedAt: number;
  accumulated: number;
};

type StashedSession = {
  name: string;
  exePath: string;
  accumulated: number;
};

type FarmState = {
  totals: { sec: number; runs: number };
  stash: StashedSession[];
};

type DiscordExecutable = {
  name?: string;
  os?: string;
  is_launcher?: boolean;
};

type ThirdPartySku = {
  distributor?: string;
  id?: string;
};

type DiscordApp = {
  id: string;
  name: string;
  aliases?: string[];
  icon_hash?: string | null;
  icon?: string | null;
  third_party_skus?: ThirdPartySku[];
  executables?: DiscordExecutable[];
};

type GameRow = {
  id: string;
  name: string;
  exeName: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  searchText: string;
};

const QUEST_TARGET_SEC = 15 * 60;
const PIN_KEY = "dq.pinned";

const BOOT_TIPS = [
  "Connecting to Discord…",
  "Loading game catalog…",
  "Matching executables…",
];

function TitleBar() {
  const win = getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="app-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7.5 21.7a8.95 8.95 0 0 1 9 0 1 1 0 0 0 1-1.73c-.6-.35-1.24-.64-1.9-.87.54-.3 1.05-.65 1.52-1.07a3.98 3.98 0 0 0 5.49-1.8.77.77 0 0 0-.24-.95 3.98 3.98 0 0 0-2.02-.76A4 4 0 0 0 23 10.47a.76.76 0 0 0-.71-.71 4.06 4.06 0 0 0-1.6.22 3.99 3.99 0 0 0 .54-5.35.77.77 0 0 0-.95-.24c-.75.36-1.37.95-1.77 1.67V6a4 4 0 0 0-4.9-3.9.77.77 0 0 0-.6.72 4 4 0 0 0 3.7 4.17c.89 1.3 1.3 2.95 1.3 4.51 0 3.66-2.75 6.5-6 6.5s-6-2.84-6-6.5c0-1.56.41-3.21 1.3-4.51A4 4 0 0 0 11 2.82a.77.77 0 0 0-.6-.72 4.01 4.01 0 0 0-4.9 3.96A4.02 4.02 0 0 0 3.73 4.4a.77.77 0 0 0-.95.24 3.98 3.98 0 0 0 .55 5.35 4 4 0 0 0-1.6-.22.76.76 0 0 0-.72.71l-.01.28a4 4 0 0 0 2.65 3.77c-.75.06-1.45.33-2.02.76-.3.22-.4.62-.24.95a4 4 0 0 0 5.49 1.8c.47.42.98.78 1.53 1.07-.67.23-1.3.52-1.91.87a1 1 0 1 0 1 1.73Z" />
          </svg>
        </span>
        <span className="wordmark">
          Discord <em>Quest</em>
        </span>
        <span className="tb-stat">v0.4.0</span>
      </div>
      <div className="window-btns">
        <button type="button" className="wbtn" aria-label="Minimize" onClick={() => void win.minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button type="button" className="wbtn close" aria-label="Close" onClick={() => void win.close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4L4 12" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function formatTotal(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m`;
}

function win32Exe(app: DiscordApp): string | null {
  const list = app.executables ?? [];
  const windows = list.filter((exe) => (exe.os ?? "").toLowerCase() === "win32" && exe.name);
  const preferred = windows.find((exe) => !exe.is_launcher) ?? windows[0] ?? null;
  return preferred?.name?.trim() || null;
}

function iconUrl(app: DiscordApp): string | null {
  const hash = app.icon_hash || app.icon;
  if (!hash) return null;
  return `https://cdn.discordapp.com/app-icons/${app.id}/${hash}.png?size=512`;
}

function bannerUrl(app: DiscordApp): string | null {
  // real landscape banner: Steam header art via the catalog's own SKU mapping
  const steamId = (app.third_party_skus ?? []).find(
    (s) => (s.distributor ?? "").toLowerCase() === "steam" && s.id,
  )?.id;
  if (!steamId) return null;
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamId}/header.jpg`;
}

function toGameRow(app: DiscordApp): GameRow | null {
  const exeName = win32Exe(app);
  if (!exeName) return null;
  return {
    id: app.id,
    name: app.name,
    exeName,
    iconUrl: iconUrl(app),
    bannerUrl: bannerUrl(app),
    searchText: `${app.name} ${(app.aliases ?? []).join(" ")} ${exeName}`.toLowerCase(),
  };
}

function QuestBar({ elapsed }: { elapsed: number }) {
  const pct = Math.min(100, (elapsed / QUEST_TARGET_SEC) * 100);
  const done = elapsed >= QUEST_TARGET_SEC;
  return (
    <div className={`qbar ${done ? "done" : ""}`}>
      <div className="qbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function orderGames(all: GameRow[], pinned: string[]): GameRow[] {
  const rank = new Map(pinned.map((id, i) => [id, i]));
  return [...all].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) return (ra ?? 1e9) - (rb ?? 1e9);
    return a.name.localeCompare(b.name, "en");
  });
}

function filterGames(ordered: GameRow[], query: string, pinned: string[]): GameRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return ordered.slice(0, 200);
  // pinned live on top outside search — hide them from results
  const pinSet = new Set(pinned);
  return ordered.filter((g) => !pinSet.has(g.id) && g.searchText.includes(q)).slice(0, 200);
}

export default function App() {
  const [games, setGames] = useState<GameRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [farm, setFarm] = useState<FarmState>({ totals: { sec: 0, runs: 0 }, stash: [] });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [leavingPid, setLeavingPid] = useState<number | null>(null);
  const [leavingStash, setLeavingStash] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [bootFade, setBootFade] = useState(false);
  const [tipIdx, setTipIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const commitPin = (next: string[]) => {
    setPinned(next);
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  };

  const togglePin = (id: string) => {
    const isPin = pinned.includes(id);
    const inSearch = query.trim().length > 0;
    const nextPinned = isPin ? pinned.filter((p) => p !== id) : [id, ...pinned.filter((p) => p !== id)];
    // reordering must not yank selection onto another game — follow the selected one
    const followSelection = () => {
      const selId = selected?.id;
      if (!selId) return;
      const idx = filterGames(orderGames(games, nextPinned), query, nextPinned).findIndex(
        (g) => g.id === selId,
      );
      setSelectedIdx(idx >= 0 ? idx : 0);
    };
    if (!isPin && inSearch) {
      // pin from search: fade the row out, then drop it from results
      if (leavingId) return;
      setLeavingId(id);
      window.setTimeout(() => {
        commitPin(nextPinned);
        setLeavingId(null);
        followSelection();
      }, 240);
    } else {
      commitPin(nextPinned);
      followSelection();
      setFlashId(id);
      window.setTimeout(() => setFlashId((f) => (f === id ? null : f)), 950);
    }
  };

  const refreshProcesses = useCallback(async () => {
    try {
      setProcesses(await invoke<ProcessInfo[]>("list_processes"));
      setFarm(await invoke<FarmState>("get_farm_state"));
    } catch {
      /* ignore */
    }
  }, []);

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    setLoadError(null);
    try {
      let raw: DiscordApp[] | null = null;
      try {
        const res = await fetch("https://discord.com/api/v9/applications/detectable");
        if (res.ok) {
          raw = (await res.json()) as DiscordApp[];
        }
      } catch {
        raw = null;
      }
      if (!raw) {
        raw = await invoke<DiscordApp[]>("get_detectable_games");
      }
      const mapped = raw
        .map(toGameRow)
        .filter((row): row is GameRow => row !== null)
        .sort((a, b) => a.name.localeCompare(b.name, "en"));
      setGames(mapped);
    } catch (e) {
      setLoadError(typeof e === "string" ? e : String(e));
    } finally {
      setLoadingGames(false);
    }
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  // boot splash: fade out once the first catalog load settles
  useEffect(() => {
    if (!loadingGames && !booted) {
      setBootFade(true);
      const t = window.setTimeout(() => setBooted(true), 380);
      return () => window.clearTimeout(t);
    }
  }, [loadingGames, booted]);

  // rotate splash tips while loading
  useEffect(() => {
    if (booted) return;
    const t = window.setInterval(() => setTipIdx((i) => i + 1), 2200);
    return () => window.clearInterval(t);
  }, [booted]);

  useEffect(() => {
    void refreshProcesses();
    const t = window.setInterval(() => {
      void refreshProcesses();
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [refreshProcesses]);

  const ordered = useMemo(() => orderGames(games, pinned), [games, pinned]);

  const filtered = useMemo(
    () => filterGames(ordered, query, pinned),
    [ordered, query, pinned],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const selected = filtered[Math.min(selectedIdx, Math.max(0, filtered.length - 1))] ?? null;

  // backend reports full paths, catalog has bare names — match on file name
  const exeKey = (p: string) => p.split(/[\\/]/).pop()?.toLowerCase() ?? p.toLowerCase();

  const runningExes = useMemo(
    () => new Set(processes.map((p) => exeKey(p.exePath))),
    [processes],
  );

  const iconByExe = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const g of games) {
      const k = exeKey(g.exeName);
      if (!m.has(k)) m.set(k, g.iconUrl);
    }
    return m;
  }, [games]);

  const startGame = async (game: GameRow) => {
    if (busyId) return;
    if (runningExes.has(exeKey(game.exeName))) return;
    setBusyId(game.id);
    try {
      const pid = await invoke<number>("start_dummy_process", {
        exeName: game.exeName,
        gameName: game.name,
      });
      setProcesses((prev) => [
        {
          pid,
          name: game.name,
          exePath: game.exeName,
          startedAt: Math.floor(Date.now() / 1000),
          accumulated: 0,
        },
        ...prev.filter((p) => p.pid !== pid),
      ]);
      void refreshProcesses();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const stopProcess = async (pid: number) => {
    if (busyId) return;
    setBusyId(`pid-${pid}`);
    setLeavingPid(pid);
    try {
      await invoke("stop_dummy_process", { pid });
      // let the row fade/collapse out before unmounting it
      await new Promise((r) => setTimeout(r, 260));
      setProcesses((prev) => prev.filter((p) => p.pid !== pid));
    } catch (e) {
      console.error(e);
    } finally {
      setLeavingPid(null);
      setBusyId(null);
    }
  };

  const resumeStashed = async (exePath: string) => {
    if (busyId) return;
    setBusyId(`stash-${exePath}`);
    try {
      await invoke<number>("resume_stashed_process", { exePath });
      void refreshProcesses();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const dropStashed = async (exePath: string) => {
    if (busyId) return;
    setBusyId(`stash-${exePath}`);
    setLeavingStash(exePath);
    try {
      await invoke("drop_stashed_process", { exePath });
      await new Promise((r) => setTimeout(r, 260));
      void refreshProcesses();
    } catch (e) {
      console.error(e);
    } finally {
      setLeavingStash(null);
      setBusyId(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalRunSec = processes.reduce((acc, p) => acc + (nowSec - p.startedAt), 0);
  const questDoneCount = processes.filter((p) => nowSec - p.startedAt >= QUEST_TARGET_SEC).length;
  const isPinned = selected ? pinned.includes(selected.id) : false;
  const selectedRunning = selected ? runningExes.has(exeKey(selected.exeName)) : false;

  return (
    <div className="shell">
      <div className="frame">
        <div className="grid-bg" aria-hidden="true" />
        <TitleBar />

        <main className="body">
          {/* ── Library ─────────────────────────────── */}
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
                  <div key={i} className="cover skeleton" style={{ "--d": `${(i % 6) * 60}ms` } as React.CSSProperties} />
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

          {/* ── Detail / control panel ──────────────── */}
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
                        <button
                          className={`launch ${selectedRunning ? "live" : ""}`}
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
                        </button>
                        <button
                          className={`pin-icon-btn ${isPinned ? "on" : ""}`}
                          title={isPinned ? "Unpin" : "Pin to top"}
                          aria-pressed={isPinned}
                          onClick={() => togglePin(selected.id)}
                        >
                          <span className="save-swap" key={isPinned ? "saved" : "add"}>
                            {isPinned ? <SaveIcon /> : <SaveAddIcon />}
                          </span>
                        </button>
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
                              <button
                                className="resume"
                                disabled={busyId !== null}
                                onClick={() => void resumeStashed(s.exePath)}
                              >
                                Resume
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card">
                <button className="help-toggle" type="button" onClick={() => setHelpOpen((v) => !v)}>
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
        </main>

        {!booted && (
          <div className={`boot${bootFade ? " hide" : ""}`} aria-hidden="true">
            <span className="boot-logo">
              <svg viewBox="0 0 24 24">
                <path d="M7.5 21.7a8.95 8.95 0 0 1 9 0 1 1 0 0 0 1-1.73c-.6-.35-1.24-.64-1.9-.87.54-.3 1.05-.65 1.52-1.07a3.98 3.98 0 0 0 5.49-1.8.77.77 0 0 0-.24-.95 3.98 3.98 0 0 0-2.02-.76A4 4 0 0 0 23 10.47a.76.76 0 0 0-.71-.71 4.06 4.06 0 0 0-1.6.22 3.99 3.99 0 0 0 .54-5.35.77.77 0 0 0-.95-.24c-.75.36-1.37.95-1.77 1.67V6a4 4 0 0 0-4.9-3.9.77.77 0 0 0-.6.72 4 4 0 0 0 3.7 4.17c.89 1.3 1.3 2.95 1.3 4.51 0 3.66-2.75 6.5-6 6.5s-6-2.84-6-6.5c0-1.56.41-3.21 1.3-4.51A4 4 0 0 0 11 2.82a.77.77 0 0 0-.6-.72 4.01 4.01 0 0 0-4.9 3.96A4.02 4.02 0 0 0 3.73 4.4a.77.77 0 0 0-.95.24 3.98 3.98 0 0 0 .55 5.35 4 4 0 0 0-1.6-.22.76.76 0 0 0-.72.71l-.01.28a4 4 0 0 0 2.65 3.77c-.75.06-1.45.33-2.02.76-.3.22-.4.62-.24.95a4 4 0 0 0 5.49 1.8c.47.42.98.78 1.53 1.07-.67.23-1.3.52-1.91.87a1 1 0 1 0 1 1.73Z" />
              </svg>
            </span>
            <span className="boot-name">
              Discord <em>Quest</em>
            </span>
            <span className="boot-spinner" />
            <span className="boot-tip" key={tipIdx % BOOT_TIPS.length}>
              {BOOT_TIPS[tipIdx % BOOT_TIPS.length]}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
