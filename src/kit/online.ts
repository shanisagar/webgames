/**
 * Private tables: two players on their own devices join one game with a short code.
 *
 * Transport: Supabase Realtime broadcast + presence on a channel named after the game and the code (no tables, no
 * server code; works with the project's public anon key). Without Supabase settings in the build (dev preview, local
 * tests) it falls back to a BroadcastChannel, which links tabs of the same browser, so the flow can be tested offline.
 *
 * The kit only moves messages. Each game decides what it sends (moves, state snapshots) and who is authoritative;
 * the host (the player who created the table) is the natural place for both.
 */
const env = import.meta.env as Record<string, string | undefined>;
const RT_URL = (env.VITE_REALTIME_URL ?? env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const RT_KEY = env.VITE_REALTIME_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";

/** Digits only: easy to read aloud and to type on a phone keypad. */
export const ROOM_CODE_LENGTH = 5;
const PING_MS = 2500;
/** No message (pings included) for this long = the other player is treated as disconnected. */
const LOST_MS = 9000;

export type RoomRole = "host" | "guest";
export interface RoomPeer { id: string; role: RoomRole; at: number }
export type RoomStatus = "waiting" | "connected" | "lost" | "closed";

interface Envelope { from: string; kind: "msg" | "ping" | "bye"; data?: unknown }

interface Transport {
  send(e: Envelope): void;
  /** Everyone currently present, me included. */
  members(): RoomPeer[];
  close(): void;
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const newCode = () => Array.from({ length: ROOM_CODE_LENGTH }, () => Math.floor(Math.random() * 10)).join("");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when rooms work across devices (Supabase configured); false = same-browser test mode. */
export const onlineAcrossDevices = !!(RT_URL && RT_KEY);

async function supabaseTransport(channel: string, me: RoomPeer, onEnvelope: (e: Envelope) => void, onPresence: () => void): Promise<Transport> {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(RT_URL, RT_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 30 } } });
  const ch = sb.channel(channel, { config: { broadcast: { self: false }, presence: { key: me.id } } });
  ch.on("broadcast", { event: "e" }, ({ payload }) => onEnvelope(payload as Envelope));
  ch.on("presence", { event: "sync" }, onPresence);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Could not reach the game server. Check your connection.")), 10000);
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); await ch.track(me); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error("Could not reach the game server. Check your connection.")); }
    });
  });
  return {
    send: (e) => { void ch.send({ type: "broadcast", event: "e", payload: e }); },
    members: () => Object.values(ch.presenceState<RoomPeer>()).flat().map((p) => ({ id: p.id, role: p.role, at: p.at })),
    close: () => { void ch.untrack().finally(() => sb.removeChannel(ch)); },
  };
}

/** Same-browser stand-in: presence is kept with hello/here/bye messages and pings. */
function localTransport(channel: string, me: RoomPeer, onEnvelope: (e: Envelope) => void, onPresence: () => void): Transport {
  const bc = new BroadcastChannel(`webgames:${channel}`);
  const seen = new Map<string, { peer: RoomPeer; at: number }>();
  type Local = { presence?: "hello" | "here" | "bye"; peer?: RoomPeer; env?: Envelope };
  const post = (m: Local) => bc.postMessage(m);
  bc.onmessage = (ev: MessageEvent<Local>) => {
    const m = ev.data;
    if (m.presence && m.peer && m.peer.id !== me.id) {
      if (m.presence === "bye") seen.delete(m.peer.id);
      else seen.set(m.peer.id, { peer: m.peer, at: Date.now() });
      if (m.presence === "hello") post({ presence: "here", peer: me });
      onPresence();
    }
    if (m.env && m.env.from !== me.id) {
      const s = seen.get(m.env.from);
      if (s) s.at = Date.now();
      onEnvelope(m.env);
    }
  };
  post({ presence: "hello", peer: me });
  const sweep = setInterval(() => {
    let changed = false;
    for (const [id, s] of seen) if (Date.now() - s.at > LOST_MS * 2) { seen.delete(id); changed = true; }
    if (changed) onPresence();
  }, 1000);
  return {
    send: (e) => post({ env: e }),
    members: () => [me, ...[...seen.values()].map((s) => s.peer)],
    close: () => { clearInterval(sweep); post({ presence: "bye", peer: me }); bc.close(); },
  };
}

export class OnlineRoom {
  readonly id: string;
  private transport!: Transport;
  private messageFns: ((data: unknown) => void)[] = [];
  private statusFns: ((s: RoomStatus) => void)[] = [];
  private _status: RoomStatus = "waiting";
  private _peer: RoomPeer | null = null;
  private lastHeard = 0;
  private pinger = 0;

  private constructor(readonly game: string, readonly code: string, readonly role: RoomRole) {
    this.id = randomId();
  }

  /** Opens a new table and waits there; share `code` with the friend. */
  static async create(game: string): Promise<OnlineRoom> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = new OnlineRoom(game, newCode(), "host");
      await room.open();
      await wait(1200);
      // Someone already sits at a table with this code: pick another one.
      if (room.transport.members().some((p) => p.id !== room.id)) { room.close(); continue; }
      return room;
    }
    throw new Error("Could not open a table. Please try again.");
  }

  /** Joins a friend's table by its code. Fails when there is no such table or it already has two players. */
  static async join(game: string, code: string): Promise<OnlineRoom> {
    if (!new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code)) throw new Error(`Enter the ${ROOM_CODE_LENGTH}-digit table code.`);
    const room = new OnlineRoom(game, code, "guest");
    await room.open();
    for (let t = 0; t < 40 && !room.findHost(); t++) await wait(100);
    if (!room.findHost()) { room.close(); throw new Error("No table with that code. Check the code with your friend."); }
    // Two guests raced for one seat: the earlier one keeps it.
    const rivals = room.transport.members().filter((p) => p.role === "guest" && p.id !== room.id);
    if (rivals.some((p) => p.at <= room.joinedAt)) { room.close(); throw new Error("That table is already full."); }
    return room;
  }

  private joinedAt = Date.now();

  private async open() {
    const me: RoomPeer = { id: this.id, role: this.role, at: this.joinedAt };
    const channel = `t-${this.game}-${this.code}`;
    const onEnvelope = (e: Envelope) => this.receive(e);
    const onPresence = () => this.presenceChanged();
    this.transport = onlineAcrossDevices
      ? await supabaseTransport(channel, me, onEnvelope, onPresence)
      : localTransport(channel, me, onEnvelope, onPresence);
    this.pinger = window.setInterval(() => this.tick(), PING_MS);
    window.addEventListener("pagehide", this.onHide);
  }

  private findHost() { return this.transport.members().find((p) => p.role === "host" && p.id !== this.id) ?? null; }

  private readonly onHide = () => this.close();

  private presenceChanged() {
    if (this._status === "closed") return;
    const other = this.transport.members()
      .filter((p) => p.id !== this.id && p.role !== this.role)
      .sort((a, b) => a.at - b.at)[0] ?? null;
    if (other && (!this._peer || other.id !== this._peer.id)) {
      this._peer = other;
      this.lastHeard = Date.now();
      this.setStatus("connected");
    }
  }

  private receive(e: Envelope) {
    if (this._status === "closed") return;
    if (this._peer && e.from !== this._peer.id) return; // a third device on the channel is ignored
    this.lastHeard = Date.now();
    if (!this._peer) this.presenceChanged();
    if (e.kind === "bye") { this.setStatus("lost"); return; }
    if (this._status === "lost" && this._peer) this.setStatus("connected");
    if (e.kind === "msg") for (const fn of this.messageFns) fn(e.data);
  }

  private tick() {
    if (this._status === "closed") return;
    this.transport.send({ from: this.id, kind: "ping" });
    if (this._status === "connected" && Date.now() - this.lastHeard > LOST_MS) this.setStatus("lost");
  }

  private setStatus(s: RoomStatus) {
    if (this._status === s) return;
    this._status = s;
    for (const fn of this.statusFns) fn(s);
  }

  /** waiting = no friend yet; connected; lost = the friend dropped (they may come back); closed = left. */
  get status() { return this._status; }
  get peer() { return this._peer; }

  /** Sends any JSON-serialisable value to the other player. */
  send(data: unknown) { if (this._status !== "closed") this.transport.send({ from: this.id, kind: "msg", data }); }
  onMessage(fn: (data: unknown) => void) { this.messageFns.push(fn); }
  onStatus(fn: (s: RoomStatus) => void) { this.statusFns.push(fn); }

  /** Leaves the table and tells the other player. */
  close() {
    if (this._status === "closed") return;
    try { this.transport?.send({ from: this.id, kind: "bye" }); } catch { /* already gone */ }
    clearInterval(this.pinger);
    window.removeEventListener("pagehide", this.onHide);
    this._status = "closed";
    for (const fn of this.statusFns) fn("closed");
    this.transport?.close();
  }
}

/** A table code passed in the page address (…#/c/acme/dotsboxes?table=12345), for invite links. */
export function tableCodeFromUrl(): string | null {
  const q = new URLSearchParams(location.hash.split("?").slice(1).join("?"));
  const code = q.get("table");
  return code && new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}

/** An invite link to this game with the table code (shared with the Web Share API when available). */
export function tableInviteUrl(code: string) {
  const base = location.href.split("#")[0];
  const route = location.hash.replace(/^#/, "").split("?")[0];
  return `${base}#${route}?table=${code}`;
}
