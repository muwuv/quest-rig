import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDownIcon, SaveAddIcon, SaveIcon } from "./icons";
import { ShaderAnimation } from "./components/ui/shader-animation";
import { PressDepth } from "./components/ui/press-depth";
import orbUrl from "./assets/orb.webm";
import { ShaderBackground } from "./components/ui/adisyon-shader";

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
const TOKEN_KEY = "dq.token";

type VideoQuest = {
  id: string;
  name: string;
  reward: string;
  art: string | null;
  logo: string | null;
  taskKey: string;
  mobileOnly: boolean;
  target: number;
  value: number;
  enrolled: boolean;
  completed: boolean;
  claimed: boolean;
  excluded: boolean;
};

// shallow compare so refetches keep object identity for unchanged quests
// (lets memoized cards skip re-renders on the 4s watch ticker)
function sameVQ(a: VideoQuest, b: VideoQuest): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.reward === b.reward &&
    a.art === b.art &&
    a.logo === b.logo &&
    a.taskKey === b.taskKey &&
    a.mobileOnly === b.mobileOnly &&
    a.target === b.target &&
    a.value === b.value &&
    a.enrolled === b.enrolled &&
    a.completed === b.completed &&
    a.claimed === b.claimed &&
    a.excluded === b.excluded
  );
}

function QuestRing({ name, pct, done }: { art: string | null; name: string; pct: number; done: boolean }) {
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

const QuestCard = memo(function QuestCard({
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

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

// real discord tokens are either mfa.xxx or three base64url parts;
// anything else is rejected locally without hitting the api
function looksLikeToken(t: string): boolean {
  const s = t.trim();
  if (/^mfa\.[A-Za-z0-9_-]{20,}$/.test(s)) return true;
  const parts = s.split(".");
  return (
    parts.length === 3 &&
    parts.every((p) => /^[A-Za-z0-9_-]{6,}$/.test(p)) &&
    s.length >= 50
  );
}

function isUnauthorized(msg: string): boolean {
  return /discord 401/i.test(msg) || /\b401\b/.test(msg);
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type PlayQuest = {
  questId: string;
  name: string;
  appName: string;
  reward: string;
  endsAt: string | null;
};

function rewardOf(cfg: any): string {
  const rc = cfg?.rewards_config ?? cfg?.rewardsConfig ?? cfg?.rewards ?? [];
  return (
    str(cfg?.messages?.reward_text) ||
    str(rc?.[0]?.messages?.reward_text) ||
    str(rc?.[0]?.name) ||
    "Reward"
  );
}

function questNameOf(cfg: any, fallback: string): string {
  return (
    str(cfg?.messages?.quest_name) || str(cfg?.messages?.questName) || str(cfg?.name) || fallback
  );
}

// play quests from the same response, for the "completable now" list
function parsePlayQuests(raw: unknown): PlayQuest[] {
  const list = (raw as any)?.quests;
  if (!Array.isArray(list)) return [];
  const out: PlayQuest[] = [];
  for (const q of list) {
    const id = str(q?.id);
    if (!id) continue;
    const cfg = q?.config ?? {};
    const tasks =
      cfg?.task_config_v2?.tasks ?? cfg?.task_config?.tasks ?? cfg?.taskConfig?.tasks ?? {};
    if (!tasks?.PLAY_ON_DESKTOP) continue;
    const app = cfg?.application ?? {};
    out.push({
      questId: id,
      name: questNameOf(cfg, id),
      appName: str(app?.name),
      reward: rewardOf(cfg),
      endsAt: str(cfg?.expires_at) || null,
    });
  }
  return out;
}

// quest banner art lives somewhere inside config, find the first image url
function findQuestArt(node: unknown, depth = 0): string | null {
  if (depth > 4 || node == null) return null;
  if (typeof node === "string") {
    if (
      node.startsWith("https://cdn.discordapp.com/quests/") &&
      /\.(jpg|jpeg|png|webp)(\?|$)/i.test(node)
    ) {
      return node;
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findQuestArt(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      const hit = findQuestArt(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// banner straight from config.assets: "quests/{quest_id}/{hash}.jpg"
function artOf(cfg: any): string | null {
  const hero = str(cfg?.assets?.hero);
  if (hero && hero !== "PLACEHOLDER") return `https://cdn.discordapp.com/${hero}`;
  return findQuestArt(cfg);
}

// partner logotype for the title row
function logoOf(cfg: any): string | null {
  const logo = str(cfg?.assets?.logotype_dark) || str(cfg?.assets?.logotype);
  if (logo && logo !== "PLACEHOLDER") return `https://cdn.discordapp.com/${logo}`;
  return null;
}
function parseVideoQuests(raw: unknown): VideoQuest[] {
  const lists = [
    { items: (raw as any)?.quests, excluded: false },
    { items: (raw as any)?.excluded_quests, excluded: true },
  ];
  const out: VideoQuest[] = [];
  for (const { items, excluded } of lists) {
    if (!Array.isArray(items)) continue;
    for (const q of items) {
      const id = str(q?.id);
      if (!id) continue;
      const cfg = q?.config ?? {};
      const tasks =
        cfg?.task_config_v2?.tasks ?? cfg?.task_config?.tasks ?? cfg?.taskConfig?.tasks ?? {};
      const taskKey = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"].find((k) => tasks?.[k]);
      if (!taskKey) continue;
      const us = q?.user_status ?? q?.userStatus ?? {};
      const prog = us?.progress ?? {};
      const reward = rewardOf(cfg);
      const name = questNameOf(cfg, id);
      const entry: VideoQuest = {
        id,
        name,
        reward,
        art: artOf(cfg),
        logo: logoOf(cfg),
        taskKey,
        mobileOnly: taskKey === "WATCH_VIDEO_ON_MOBILE",
        target: num(tasks[taskKey]?.target),
        value: num(prog?.[taskKey]?.value),
        enrolled: Boolean(us?.enrolled_at ?? us?.enrolledAt),
        completed: Boolean(us?.completed_at ?? us?.completedAt),
        claimed: Boolean(us?.claimed_at ?? us?.claimedAt),
        excluded,
      };
      // the API sometimes returns the same quest twice: keep one copy,
      // preferring the usable (non-excluded) one
      const dup = out.findIndex((v) => v.id === id || (name !== id && v.name === name));
      if (dup >= 0) {
        if (!excluded && out[dup].excluded) out[dup] = entry;
        continue;
      }
      out.push(entry);
    }
  }
  return out;
}

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

const BOOT_TIPS = [
  "Connecting to Discord…",
  "Loading game catalog…",
  "Matching executables…",
];

function TitleBar({
  nav,
  onReloadCatalog,
  onForgetToken,
  hasToken,
}: {
  nav: ReactNode;
  onReloadCatalog: () => void;
  onForgetToken: () => void;
  hasToken: boolean;
}) {
  const win = getCurrentWindow();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="menu-wrap">
          <button
            type="button"
            className="menu-btn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h10M4 12h16M7 19h10" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <span className="menu-overlay" onClick={() => setMenuOpen(false)} />
              <span className="menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onReloadCatalog();
                  }}
                >
                  Reload catalog
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasToken}
                  onClick={() => {
                    setMenuOpen(false);
                    onForgetToken();
                  }}
                >
                  Forget token
                </button>
                <span className="menu-sep" />
                <span className="menu-foot">QuestRig v0.5.0</span>
              </span>
            </>
          )}
        </span>
        <span className="app-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7.5 21.7a8.95 8.95 0 0 1 9 0 1 1 0 0 0 1-1.73c-.6-.35-1.24-.64-1.9-.87.54-.3 1.05-.65 1.52-1.07a3.98 3.98 0 0 0 5.49-1.8.77.77 0 0 0-.24-.95 3.98 3.98 0 0 0-2.02-.76A4 4 0 0 0 23 10.47a.76.76 0 0 0-.71-.71 4.06 4.06 0 0 0-1.6.22 3.99 3.99 0 0 0 .54-5.35.77.77 0 0 0-.95-.24c-.75.36-1.37.95-1.77 1.67V6a4 4 0 0 0-4.9-3.9.77.77 0 0 0-.6.72 4 4 0 0 0 3.7 4.17c.89 1.3 1.3 2.95 1.3 4.51 0 3.66-2.75 6.5-6 6.5s-6-2.84-6-6.5c0-1.56.41-3.21 1.3-4.51A4 4 0 0 0 11 2.82a.77.77 0 0 0-.6-.72 4.01 4.01 0 0 0-4.9 3.96A4.02 4.02 0 0 0 3.73 4.4a.77.77 0 0 0-.95.24 3.98 3.98 0 0 0 .55 5.35 4 4 0 0 0-1.6-.22.76.76 0 0 0-.72.71l-.01.28a4 4 0 0 0 2.65 3.77c-.75.06-1.45.33-2.02.76-.3.22-.4.62-.24.95a4 4 0 0 0 5.49 1.8c.47.42.98.78 1.53 1.07-.67.23-1.3.52-1.91.87a1 1 0 1 0 1 1.73Z" />
          </svg>
        </span>
        <span className="wordmark">
          Quest<em>Rig</em>
        </span>
      </div>
      <div className="titlebar-center">{nav}</div>
      <div className="window-btns">
        <button type="button" className="wbtn" aria-label="Minimize" onClick={() => void win.minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button type="button" className="wbtn" aria-label="Maximize" onClick={() => void win.toggleMaximize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
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

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  // landscape banner: Steam header art resolved through the catalog SKU table
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
  // pinned games sit on top outside search, so hide them from results
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
  const [vfilter, setVfilter] = useState<"all" | "done" | "todo">("all");
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
  }, [mode, vfilter, vquests.length]);
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

  // backend reports full paths, catalog has bare names: match on file name
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

  const visibleQuests = useMemo(
    () =>
      vquests.filter((vq) =>
        vfilter === "all" ? true : vfilter === "done" ? vq.completed || vq.claimed : !vq.completed && !vq.claimed,
      ),
    [vquests, vfilter],
  );

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

              {token.trim() !== "" && playable.length > 0 && (
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
            </>
          ) : (
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
                    <div className="token-empty">
                      <form
                      className="token-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitToken();
                      }}
                    >
                      <span className="token-field">
                        <input
                          id="dq-token"
                          type="password"
                          value={tokenDraft}
                          onChange={(e) => {
                            setTokenDraft(e.target.value);
                            localStorage.setItem("dq.tokenDraft", e.target.value);
                            if (tokenErr) setTokenErr(null);
                          }}
                          placeholder=" "
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <label htmlFor="dq-token">Discord token</label>
                      </span>
                      <PressDepth
                        type="submit"
                        variant="primary"
                        icon
                        join="right"
                        depth={4}
                        tilt={4}
                        faceHeight={30}
                        style={{ width: 44, flex: "none" }}
                        disabled={!tokenDraft.trim() || tokenChecking}
                        title="Save token"
                        ariaLabel="Save token"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M13.3 4.3 6.5 11.1 2.7 7.3" />
                        </svg>
                      </PressDepth>
                    </form>
                    {tokenErr && <p className="vq-err token-err">{tokenErr}</p>}
                    <p className="hint">
                      Stored only on this PC, sent only to discord.com. A token is full
                      account access: never share it, and change your password to revoke it.
                    </p>
                    </div>
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
                          onClick={() => void loadVQuests()}
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
                            onWatch={startWatch}
                            onClaim={claimQuest}
                            onStop={stopWatch}
                          />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </section>
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
