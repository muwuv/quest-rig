import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShaderAnimation } from "./components/ui/shader-animation";
import { TitleBar } from "./components/TitleBar";
import { GamesView } from "./views/GamesView";
import { VideoView, type VFilter } from "./views/VideoView";
import {
  PIN_KEY,
  TOKEN_KEY,
  exeKey,
  filterGames,
  formatClock,
  isUnauthorized,
  looksLikeToken,
  orderGames,
  parsePlayQuests,
  parseVideoQuests,
  sameVQ,
  toGameRow,
  type DiscordApp,
  type FarmState,
  type GameRow,
  type PlayQuest,
  type ProcessInfo,
  type VideoQuest,
} from "./lib/quests";

const BOOT_TIPS = [
  "Connecting to Discord…",
  "Loading game catalog…",
  "Matching executables…",
];

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
  const [mode, setMode] = useState<"games" | "video">("games");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [glider, setGlider] = useState({ left: 0, width: 0 });
  const [booted, setBooted] = useState(false);
  const [bootFade, setBootFade] = useState(false);
  const [tipIdx, setTipIdx] = useState(0);
  const bootStart = useRef(Date.now());
  const BOOT_MIN_MS = 3500;

  // boot waits for both: catalog loaded AND the intro animation played out
  useEffect(() => {
    if (loadingGames || booted) return;
    const delay = Math.max(0, BOOT_MIN_MS - (Date.now() - bootStart.current));
    const t1 = window.setTimeout(() => setBootFade(true), delay);
    const t2 = window.setTimeout(() => setBooted(true), delay + 380);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loadingGames, booted]);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem("dq.tokenDraft") ?? "");
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  // a bad token saved earlier must not open the video tab: re-check once on start
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved?.trim() || !looksLikeToken(saved)) {
      if (saved && !looksLikeToken(saved ?? "")) {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
      }
      return;
    }
    (async () => {
      try {
        await invoke("quest_me", { token: saved.trim() });
      } catch (e) {
        const msg = typeof e === "string" ? e : String(e);
        if (!isUnauthorized(msg)) return; // offline or discord hiccup: keep the token
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setTokenErr("Saved token was rejected by Discord — paste a fresh one.");
      }
    })();
  }, []);
  const [vquests, setVquests] = useState<VideoQuest[]>([]);
  const [vraw, setVraw] = useState<unknown>(null);
  const [vloading, setVloading] = useState(false);
  const [verror, setVerror] = useState<string | null>(null);
  const [watching, setWatching] = useState<{ id: string; target: number; base: number; t0: number } | null>(null);
  const [vfilter, setVfilter] = useState<VFilter>("all");
  const [vbusy, setVbusy] = useState<string | null>(null);
  const [vnote, setVnote] = useState<{ id: string; text: string } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const root = tabsRef.current;
      if (!root) return;
      const active = root.querySelector(".tab.on") as HTMLElement | null;
      if (!active) return;
      setGlider({ left: active.offsetLeft, width: active.offsetWidth });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mode, vquests]);
  const searchRef = useRef<HTMLInputElement>(null);

  const commitPin = (next: string[]) => {
    setPinned(next);
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  };

  const togglePin = (id: string) => {
    const isPin = pinned.includes(id);
    const inSearch = query.trim().length > 0;
    const nextPinned = isPin ? pinned.filter((p) => p !== id) : [id, ...pinned.filter((p) => p !== id)];
    // reordering must not move selection to another game, follow the selected one
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

  // rotate splash tips while loading
  useEffect(() => {
    if (booted) return;
    const t = window.setInterval(() => setTipIdx((i) => i + 1), 2200);
    return () => window.clearInterval(t);
  }, [booted]);

  useEffect(() => {
    // games timers only tick on the games tab: no 1s re-renders in video mode
    if (mode !== "games") return;
    void refreshProcesses();
    const t = window.setInterval(() => {
      void refreshProcesses();
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [refreshProcesses, mode]);

  const ordered = useMemo(() => orderGames(games, pinned), [games, pinned]);

  const filtered = useMemo(
    () => filterGames(ordered, query, pinned),
    [ordered, query, pinned],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const selected = filtered[Math.min(selectedIdx, Math.max(0, filtered.length - 1))] ?? null;

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

  const playQuests = useMemo(() => parsePlayQuests(vraw), [vraw]);

  const playable = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const out: { game: GameRow; quest: PlayQuest }[] = [];
    const used = new Set<string>();
    for (const pq of playQuests) {
      const cands = [pq.appName, pq.name.replace(/\s*quest\s*$/i, "")]
        .map(norm)
        .filter((c) => c.length > 2);
      const game = games.find((g) => {
        const n = norm(g.name);
        return cands.some((c) => n === c || n.includes(c) || c.includes(n));
      });
      if (game && !used.has(game.id)) {
        used.add(game.id);
        out.push({ game, quest: pq });
      }
    }
    return out;
  }, [playQuests, games]);

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
      // wait out the fade before unmounting the row
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

  const loadVQuests = useCallback(async () => {
    if (!token.trim()) return;
    setVloading(true);
    setVerror(null);
    try {
      const raw = await invoke<unknown>("quest_list", { token: token.trim() });
      setVraw(raw);
      const next = parseVideoQuests(raw);
      // keep object identity for unchanged quests so memoized cards skip re-renders
      setVquests((prev) => {
        if (next.length === prev.length && next.every((q, i) => sameVQ(q, prev[i]))) {
          return prev;
        }
        const old = new Map(prev.map((q) => [q.id, q]));
        return next.map((q) => {
          const p = old.get(q.id);
          return p && sameVQ(p, q) ? p : q;
        });
      });
    } catch (e) {
      setVerror(typeof e === "string" ? e : String(e));
    } finally {
      setVloading(false);
    }
  }, [token]);

  const stopWatch = useCallback(() => setWatching(null), []);

  const forgetToken = useCallback(() => {
    stopWatch();
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setVquests([]);
    setVerror(null);
  }, [stopWatch]);

  const updateDraft = useCallback((v: string) => {
    setTokenDraft(v);
    localStorage.setItem("dq.tokenDraft", v);
    setTokenErr((e) => (e ? null : e));
  }, []);

  // random words don't open the video tab: format check + live check via users/@me
  const submitToken = useCallback(async () => {
    const t = tokenDraft.trim();
    if (!t || tokenChecking) return;
    if (!looksLikeToken(t)) {
      setTokenErr("That doesn't look like a Discord token — paste the full token.");
      return;
    }
    setTokenChecking(true);
    setTokenErr(null);
    try {
      await invoke("quest_me", { token: t });
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.removeItem("dq.tokenDraft");
      setToken(t);
      setTokenDraft("");
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      setTokenErr(
        isUnauthorized(msg)
          ? "Discord rejected this token (401). Check it and try again."
          : `Couldn't reach Discord: ${msg}`,
      );
    } finally {
      setTokenChecking(false);
    }
  }, [tokenDraft, tokenChecking]);

  const startWatch = useCallback(
    async (vq: VideoQuest) => {
      console.log("[vq] watch pressed", vq.id, vq.name);
      stopWatch();
      setVerror(null);
      setVbusy(vq.id);
      try {
        if (!vq.enrolled) {
          console.log("[vq] enrolling", vq.id);
          try {
            await invoke("quest_enroll", { token: token.trim(), questId: vq.id });
            console.log("[vq] enrolled ok");
          } catch (e) {
            // already enrolled counts as success, anything else aborts
            const msg = typeof e === "string" ? e : String(e);
            console.log("[vq] enroll result:", msg);
            if (!/already enroll/i.test(msg)) throw e;
          }
        }
        setWatching({ id: vq.id, target: vq.target, base: vq.value, t0: Date.now() });
        setVnote({ id: vq.id, text: "started, reporting progress…" });
        await loadVQuests();
      } catch (e) {
        console.log("[vq] start failed", e);
        setVerror(typeof e === "string" ? e : String(e));
      } finally {
        setVbusy(null);
      }
    },
    [token, loadVQuests, stopWatch],
  );

  const claimQuest = useCallback(
    async (vq: VideoQuest) => {
      console.log("[vq] claim pressed", vq.id);
      setVerror(null);
      setVbusy(vq.id);
      try {
        await invoke("quest_claim", { token: token.trim(), questId: vq.id });
        await loadVQuests();
      } catch (e) {
        console.log("[vq] claim failed", e);
        setVerror(typeof e === "string" ? e : String(e));
      } finally {
        setVbusy(null);
      }
    },
    [token, loadVQuests],
  );

  // report watch progress roughly every 4s at 1x speed, like the real player
  useEffect(() => {
    if (!watching || !token.trim()) return;
    let dead = false;
    const tick = async () => {
      const elapsed = (Date.now() - watching.t0) / 1000;
      const ts = Math.min(watching.target, watching.base + elapsed) + Math.random() * 0.4;
      try {
        await invoke("quest_video_progress", {
          token: token.trim(),
          questId: watching.id,
          timestamp: ts,
        });
        if (dead) return;
        console.log("[vq] reported", Math.floor(ts), "s");
        setVnote({ id: watching.id, text: `reported ${formatClock(Math.floor(ts))}` });
        await loadVQuests();
        if (ts >= watching.target) setWatching(null);
      } catch (e) {
        if (dead) return;
        console.log("[vq] progress failed", e);
        setVerror(typeof e === "string" ? e : String(e));
        setWatching(null);
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 4000);
    return () => {
      dead = true;
      window.clearInterval(t);
    };
  }, [watching, token, loadVQuests]);

  useEffect(() => {
    if (token.trim()) void loadVQuests();
  }, [token, loadVQuests]);

  const unclaimedCount = useMemo(() => vquests.filter((q) => !q.claimed).length, [vquests]);

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

  const isPinned = selected ? pinned.includes(selected.id) : false;
  const selectedRunning = selected ? runningExes.has(exeKey(selected.exeName)) : false;

  const tabs = (
    <div className="tabs" role="tablist" aria-label="Mode" ref={tabsRef}>
      <span
        className="tab-glider"
        aria-hidden="true"
        style={{ left: glider.left, width: glider.width }}
      />
      <button
        type="button"
        role="tab"
        aria-selected={mode === "games"}
        className={`tab${mode === "games" ? " on" : ""}`}
        onClick={() => setMode("games")}
      >
        Games
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "video"}
        className={`tab${mode === "video" ? " on" : ""}`}
        onClick={() => setMode("video")}
      >
        Video
        {unclaimedCount > 0 && (
          <span className="tab-badge">{unclaimedCount}</span>
        )}
      </button>
    </div>
  );

  return (
    <div className="shell">
      <div className="frame">
        <div className="grid-bg" aria-hidden="true" />
        <TitleBar nav={tabs} onReloadCatalog={() => void loadGames()} onForgetToken={forgetToken} hasToken={token.trim() !== ""} />

        <main className="body">
          {mode === "games" ? (
            <GamesView
              loadingGames={loadingGames}
              loadError={loadError}
              loadGames={() => void loadGames()}
              query={query}
              setQuery={setQuery}
              searchRef={searchRef}
              filtered={filtered}
              selected={selected}
              setSelectedIdx={setSelectedIdx}
              leavingId={leavingId}
              flashId={flashId}
              pinned={pinned}
              runningExes={runningExes}
              busyId={busyId}
              isPinned={isPinned}
              selectedRunning={selectedRunning}
              startGame={(game) => void startGame(game)}
              togglePin={togglePin}
              hasToken={token.trim() !== ""}
              playable={playable}
              processes={processes}
              nowSec={nowSec}
              leavingPid={leavingPid}
              stopProcess={(pid) => void stopProcess(pid)}
              farm={farm}
              iconByExe={iconByExe}
              leavingStash={leavingStash}
              dropStashed={(exePath) => void dropStashed(exePath)}
              resumeStashed={(exePath) => void resumeStashed(exePath)}
              helpOpen={helpOpen}
              onToggleHelp={() => setHelpOpen((v) => !v)}
            />
          ) : (
            <VideoView
              token={token}
              draft={tokenDraft}
              onDraft={updateDraft}
              onSubmitToken={() => void submitToken()}
              tokenChecking={tokenChecking}
              tokenErr={tokenErr}
              vquests={vquests}
              vfilter={vfilter}
              setVfilter={setVfilter}
              watching={watching}
              vbusy={vbusy}
              vnote={vnote}
              vloading={vloading}
              verror={verror}
              onReload={() => void loadVQuests()}
              onWatch={(vq) => void startWatch(vq)}
              onClaim={(vq) => void claimQuest(vq)}
              onStop={stopWatch}
            />
          )}
        </main>

        {!booted && (
          <div className={`boot${bootFade ? " hide" : ""}`} aria-hidden="true">
            <div className="boot-shader">
              <ShaderAnimation />
            </div>
            <span className="boot-logo">
              <svg viewBox="0 0 24 24">
                <path d="M7.5 21.7a8.95 8.95 0 0 1 9 0 1 1 0 0 0 1-1.73c-.6-.35-1.24-.64-1.9-.87.54-.3 1.05-.65 1.52-1.07a3.98 3.98 0 0 0 5.49-1.8.77.77 0 0 0-.24-.95 3.98 3.98 0 0 0-2.02-.76A4 4 0 0 0 23 10.47a.76.76 0 0 0-.71-.71 4.06 4.06 0 0 0-1.6.22 3.99 3.99 0 0 0 .54-5.35.77.77 0 0 0-.95-.24c-.75.36-1.37.95-1.77 1.67V6a4 4 0 0 0-4.9-3.9.77.77 0 0 0-.6.72 4 4 0 0 0 3.7 4.17c.89 1.3 1.3 2.95 1.3 4.51 0 3.66-2.75 6.5-6 6.5s-6-2.84-6-6.5c0-1.56.41-3.21 1.3-4.51A4 4 0 0 0 11 2.82a.77.77 0 0 0-.6-.72 4.01 4.01 0 0 0-4.9 3.96A4.02 4.02 0 0 0 3.73 4.4a.77.77 0 0 0-.95.24 3.98 3.98 0 0 0 .55 5.35 4 4 0 0 0-1.6-.22.76.76 0 0 0-.72.71l-.01.28a4 4 0 0 0 2.65 3.77c-.75.06-1.45.33-2.02.76-.3.22-.4.62-.24.95a4 4 0 0 0 5.49 1.8c.47.42.98.78 1.53 1.07-.67.23-1.3.52-1.91.87a1 1 0 1 0 1 1.73Z" />
              </svg>
            </span>
            <span className="boot-name">
              Quest<em>Rig</em>
            </span>
            <span className="boot-tip" key={tipIdx % BOOT_TIPS.length}>
              {BOOT_TIPS[tipIdx % BOOT_TIPS.length]}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
