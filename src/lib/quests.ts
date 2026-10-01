// pure discord/catalog/quest helpers: no react, no side effects

// backend reports full paths, catalog has bare names: match on file name
export function exeKey(p: string): string {
  return p.split(/[\\/]/).pop()?.toLowerCase() ?? p.toLowerCase();
}
export type ProcessInfo = {
  pid: number;
  name: string;
  exePath: string;
  startedAt: number;
  accumulated: number;
};

export type StashedSession = {
  name: string;
  exePath: string;
  accumulated: number;
};

export type FarmState = {
  totals: { sec: number; runs: number };
  stash: StashedSession[];
};

export type DiscordExecutable = {
  name?: string;
  os?: string;
  is_launcher?: boolean;
};

export type ThirdPartySku = {
  distributor?: string;
  id?: string;
};

export type DiscordApp = {
  id: string;
  name: string;
  aliases?: string[];
  icon_hash?: string | null;
  icon?: string | null;
  third_party_skus?: ThirdPartySku[];
  executables?: DiscordExecutable[];
};

export type GameRow = {
  id: string;
  name: string;
  exeName: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  searchText: string;
};

export const QUEST_TARGET_SEC = 15 * 60;
export const PIN_KEY = "dq.pinned";
export const TOKEN_KEY = "dq.token";
export type VideoQuest = {
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
export function sameVQ(a: VideoQuest, b: VideoQuest): boolean {
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
export function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

// real discord tokens are either mfa.xxx or three base64url parts;
// anything else is rejected locally without hitting the api
export function looksLikeToken(t: string): boolean {
  const s = t.trim();
  if (/^mfa\.[A-Za-z0-9_-]{20,}$/.test(s)) return true;
  const parts = s.split(".");
  return (
    parts.length === 3 &&
    parts.every((p) => /^[A-Za-z0-9_-]{6,}$/.test(p)) &&
    s.length >= 50
  );
}

export function isUnauthorized(msg: string): boolean {
  return /discord 401/i.test(msg) || /\b401\b/.test(msg);
}
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type PlayQuest = {
  questId: string;
  name: string;
  appName: string;
  reward: string;
  endsAt: string | null;
};
export function rewardOf(cfg: any): string {
  const rc = cfg?.rewards_config ?? cfg?.rewardsConfig ?? cfg?.rewards ?? [];
  return (
    str(cfg?.messages?.reward_text) ||
    str(rc?.[0]?.messages?.reward_text) ||
    str(rc?.[0]?.name) ||
    "Reward"
  );
}

export function questNameOf(cfg: any, fallback: string): string {
  return (
    str(cfg?.messages?.quest_name) || str(cfg?.messages?.questName) || str(cfg?.name) || fallback
  );
}

// play quests from the same response, for the "completable now" list
export function parsePlayQuests(raw: unknown): PlayQuest[] {
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
export function findQuestArt(node: unknown, depth = 0): string | null {
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
export function artOf(cfg: any): string | null {
  const hero = str(cfg?.assets?.hero);
  if (hero && hero !== "PLACEHOLDER") return `https://cdn.discordapp.com/${hero}`;
  return findQuestArt(cfg);
}

// partner logotype for the title row
export function logoOf(cfg: any): string | null {
  const logo = str(cfg?.assets?.logotype_dark) || str(cfg?.assets?.logotype);
  if (logo && logo !== "PLACEHOLDER") return `https://cdn.discordapp.com/${logo}`;
  return null;
}
export function parseVideoQuests(raw: unknown): VideoQuest[] {
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
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatTotal(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m`;
}

export function win32Exe(app: DiscordApp): string | null {
  const list = app.executables ?? [];
  const windows = list.filter((exe) => (exe.os ?? "").toLowerCase() === "win32" && exe.name);
  const preferred = windows.find((exe) => !exe.is_launcher) ?? windows[0] ?? null;
  return preferred?.name?.trim() || null;
}

export function iconUrl(app: DiscordApp): string | null {
  const hash = app.icon_hash || app.icon;
  if (!hash) return null;
  return `https://cdn.discordapp.com/app-icons/${app.id}/${hash}.png?size=512`;
}

export function bannerUrl(app: DiscordApp): string | null {
  // landscape banner: Steam header art resolved through the catalog SKU table
  const steamId = (app.third_party_skus ?? []).find(
    (s) => (s.distributor ?? "").toLowerCase() === "steam" && s.id,
  )?.id;
  if (!steamId) return null;
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamId}/header.jpg`;
}

export function toGameRow(app: DiscordApp): GameRow | null {
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
export function orderGames(all: GameRow[], pinned: string[]): GameRow[] {
  const rank = new Map(pinned.map((id, i) => [id, i]));
  return [...all].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) return (ra ?? 1e9) - (rb ?? 1e9);
    return a.name.localeCompare(b.name, "en");
  });
}

export function filterGames(ordered: GameRow[], query: string, pinned: string[]): GameRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return ordered.slice(0, 200);
  // pinned games sit on top outside search, so hide them from results
  const pinSet = new Set(pinned);
  return ordered.filter((g) => !pinSet.has(g.id) && g.searchText.includes(q)).slice(0, 200);
}
