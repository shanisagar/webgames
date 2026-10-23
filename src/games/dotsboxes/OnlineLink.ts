import { OnlineRoom, RoomStatus } from "../../kit";

/**
 * Game-agnostic match protocol on top of the kit's OnlineRoom (pilot for other turn-based games).
 *
 * The host (table creator) is authoritative: it starts matches and owns the full state. Moves carry a sequence
 * number; a receiver that sees a move out of order (or one the game rejects) asks the host for a snapshot. The host
 * also pushes a snapshot whenever the friend (re)connects. Player indices: host = 0, guest = 1.
 *
 * Messages (all plain JSON, field `t` = type):
 *   start    host → guest   { t, match, start }                 a new match (game-defined `start` payload)
 *   move     both           { t, seq, move }                    seq = 1 + number of moves applied before it
 *   sync?    both → host    { t }                               "send me the full state"
 *   state    host → guest   { t, match, seq, snap }             full snapshot (game-defined)
 *   react    both           { t, k }                            quick reaction index
 *   rematch  both           { t, match }                        "I want a rematch of match `match`"
 *   leave    both           { t }                               leaving on purpose (sent before the room closes)
 */

export type LinkMsg =
  | { t: "start"; match: number; start: unknown }
  | { t: "move"; seq: number; move: unknown }
  | { t: "sync?" }
  | { t: "state"; match: number; seq: number; snap: unknown }
  | { t: "react"; k: number }
  | { t: "rematch"; match: number }
  | { t: "leave" };

export interface LinkHooks<Start, Move, Snap> {
  /** A match starts (both sides; the host gets its own start too). */
  onStart(start: Start, match: number): void;
  /** Is this move legal right now for player `by`? (seq order is checked by the link) */
  validMove(move: Move, by: number): boolean;
  /** Apply the friend's move. */
  onMove(move: Move, by: number): void;
  /** Host only: the full state of the current match. */
  snapshot(): Snap;
  /** Guest only: replace the local state with the host's. */
  onSnapshot(snap: Snap, match: number): void;
  onReaction(k: number): void;
  /** Connection state of the friend: connected / lost (may come back) / left (on purpose or timed out). */
  onFriend(state: "connected" | "lost" | "left"): void;
  /** Both players asked for a rematch (host: start the next match now). */
  onRematchReady(): void;
  /** The friend asked for a rematch (for "friend wants a rematch" hints). */
  onFriendRematch?(): void;
}

export class OnlineLink<Start, Move, Snap> {
  /** Moves applied in the current match. */
  seq = 0;
  match = 0;
  private wantRematch = false;
  private friendRematch = false;
  private left = false;
  private hooks: LinkHooks<Start, Move, Snap> | null = null;

  constructor(readonly room: OnlineRoom) {
    room.onMessage((d) => this.receive(d as LinkMsg));
    room.onStatus((s) => this.status(s));
  }

  get isHost() { return this.room.role === "host"; }
  /** My player index (host 0, guest 1). */
  get me() { return this.isHost ? 0 : 1; }
  get friend() { return 1 - this.me; }
  get connected() { return this.room.status === "connected"; }

  bind(hooks: LinkHooks<Start, Move, Snap>) {
    this.hooks = hooks;
    // a guest that (re)joins a table mid-match asks for the state straight away
    if (!this.isHost) this.room.send({ t: "sync?" } satisfies LinkMsg);
  }

  /** Host: begin match number `match + 1` with this payload. */
  start(start: Start) {
    if (!this.isHost) return;
    this.match++;
    this.seq = 0;
    this.wantRematch = this.friendRematch = false;
    this.room.send({ t: "start", match: this.match, start } satisfies LinkMsg);
    this.hooks?.onStart(start, this.match);
  }

  /** Sends my own move (already applied locally). */
  sendMove(move: Move) {
    this.seq++;
    this.room.send({ t: "move", seq: this.seq, move } satisfies LinkMsg);
  }

  react(k: number) { this.room.send({ t: "react", k } satisfies LinkMsg); }

  /** I want a rematch; when the friend wants one too, the host starts it. */
  askRematch() {
    this.wantRematch = true;
    this.room.send({ t: "rematch", match: this.match } satisfies LinkMsg);
    this.checkRematch();
  }

  get waitingForRematch() { return this.wantRematch && !this.friendRematch; }

  /** Leave the table on purpose: the friend is told right away. */
  leave() {
    if (this.left) return;
    this.left = true;
    try { this.room.send({ t: "leave" } satisfies LinkMsg); } catch { /* gone */ }
    // let the message go out before the channel closes
    setTimeout(() => this.room.close(), 150);
  }

  /** Host: push the full state to the guest. */
  pushState() {
    if (!this.isHost || !this.hooks || this.match === 0) return;
    this.room.send({ t: "state", match: this.match, seq: this.seq, snap: this.hooks.snapshot() } satisfies LinkMsg);
  }

  private requestSync() {
    if (this.isHost) this.pushState(); // the host is the reference: correct the guest instead
    else this.room.send({ t: "sync?" } satisfies LinkMsg);
  }

  private checkRematch() {
    if (this.wantRematch && this.friendRematch) {
      this.wantRematch = this.friendRematch = false;
      this.hooks?.onRematchReady();
    }
  }

  private status(s: RoomStatus) {
    if (this.left) return;
    if (s === "connected") {
      this.hooks?.onFriend("connected");
      if (this.isHost) this.pushState(); else if (this.match > 0) this.room.send({ t: "sync?" } satisfies LinkMsg);
    } else if (s === "lost") this.hooks?.onFriend("lost");
  }

  private receive(m: LinkMsg) {
    const h = this.hooks;
    if (!h || this.left || !m || typeof m !== "object") return;
    switch (m.t) {
      case "start":
        if (this.isHost) return;
        this.match = m.match;
        this.seq = 0;
        this.wantRematch = this.friendRematch = false;
        h.onStart(m.start as Start, m.match);
        break;
      case "move": {
        const move = m.move as Move;
        if (m.seq === this.seq + 1 && h.validMove(move, this.friend)) {
          this.seq = m.seq;
          h.onMove(move, this.friend);
        } else if (m.seq > this.seq) this.requestSync();
        else if (this.isHost) this.pushState();
        break;
      }
      case "sync?": if (this.isHost) this.pushState(); break;
      case "state":
        if (this.isHost) return;
        this.match = m.match;
        this.seq = m.seq;
        h.onSnapshot(m.snap as Snap, m.match);
        break;
      case "react": h.onReaction(m.k); break;
      case "rematch":
        if (m.match !== this.match) return;
        this.friendRematch = true;
        h.onFriendRematch?.();
        this.checkRematch();
        break;
      case "leave":
        this.left = true;
        h.onFriend("left");
        this.room.close();
        break;
    }
  }
}
