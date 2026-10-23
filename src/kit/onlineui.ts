import { Art } from "./art";
import { Keyboard } from "./input";
import { Color, Ease, Mathf, Pal, V2, V3 } from "./math";
import { OnlineRoom, ROOM_CODE_LENGTH, tableInviteUrl } from "./online";
import { Time } from "./scene";
import { Sfx, Snd } from "./sfx";
import { ArcadeButton, Image, Text, UI, UIKit, UINode } from "./ui";

/**
 * Reusable screens for private online tables (pilot for other games): the PRIVATE TABLE lobby (create / join with
 * an on-screen keypad), the in-match connection overlay and quick reactions. Everything lives on the UI root, above
 * the shell's screens. The game drives it with tick(dt) every frame and reacts to its callbacks.
 */

const C = new V2(0.5, 0.5);

export interface OnlineTheme { accent: Color; accent2: Color; ink: Color }

export interface LobbyCallbacks {
  /** A table is ready: as host once the friend joined, as guest once the join succeeded. */
  onReady(room: OnlineRoom): void;
  /** Lobby closed without a table. */
  onClose?(): void;
  toast(text: string, seconds?: number): void;
}

type View = "menu" | "create" | "join";

export class TableLobby {
  private root: UINode;
  private card!: UINode;
  private views = new Map<View, UINode>();
  private view: View = "menu";
  private codeText!: Text; private waitText!: Text; private spinner!: Image; private inviteButton!: ArcadeButton;
  private boxes: Text[] = []; private boxBg: Image[] = []; private errorText!: Text; private joinStatus!: Text; private joinButton!: ArcadeButton;
  private digits = "";
  private noteText!: Text;
  private room: OnlineRoom | null = null;
  private busy = false;
  private joinedT = -1;
  private clock = 0;
  /** Board-size (or similar) note shown on the create screen. */
  createNote = "";

  constructor(private gameId: string, private theme: OnlineTheme, private cb: LobbyCallbacks, private gameGame = "") {
    this.root = UIKit.node("OnlineLobby", UI.root!).stretch();
    UIKit.dim(this.root, 0.8);
    this.card = UIKit.card(this.root, new V2(900, 1100), theme.accent);
    this.card.localScale = new V3(0.9, 0.9, 1);
    this.BuildMenu();
    this.BuildCreate();
    this.BuildJoin();
    this.root.setActive(false);
  }

  get isOpen() { return this.root.activeSelf; }

  private Title(parent: UINode, text: string) {
    UIKit.glow(UIKit.at(UIKit.label(parent, text, 58, Color.white), C, new V2(0, 450), new V2(860, 80)), Pal.Dark, 3);
  }

  private BuildMenu() {
    const v = UIKit.node("Menu", this.card).stretch();
    this.views.set("menu", v);
    this.Title(v, "PRIVATE TABLE");
    UIKit.at(UIKit.wrap(UIKit.label(v, "Play a friend on their own phone. One of you creates a table, the other joins with its code.", 32, Pal.TextDim)), C, new V2(0, 300), new V2(760, 140));
    UIKit.buttonAt(v, "CREATE TABLE", C, new V2(0, 100), new V2(600, 150), true, () => this.Create(), 52).setAccent(this.theme.accent);
    UIKit.buttonAt(v, "JOIN TABLE", C, new V2(0, -90), new V2(600, 150), true, () => this.Show("join"), 52).setAccent(this.theme.accent2);
    UIKit.buttonAt(v, "CLOSE", C, new V2(0, -420), new V2(320, 96), false, () => this.Close(), 38).setAccent(Pal.TextDim);
  }

  private BuildCreate() {
    const v = UIKit.node("Create", this.card).stretch();
    this.views.set("create", v);
    this.Title(v, "YOUR TABLE");
    UIKit.at(UIKit.label(v, "TABLE CODE", 32, Pal.TextDim), C, new V2(0, 330), new V2(600, 44));
    const box = UIKit.img(v, "CodeBg", Art.UiRound, new Color(1, 1, 1, 0.08));
    box.rectTransform.place(C, new V2(0, 210), new V2(640, 170));
    this.codeText = UIKit.at(UIKit.label(v, "·····", 130, Color.white), C, new V2(0, 210), new V2(640, 170));
    UIKit.glow(this.codeText, this.theme.accent, 5);
    this.spinner = UIKit.img(v, "Spinner", Art.UiRing, this.theme.accent);
    this.spinner.rectTransform.place(C, new V2(-300, 40), new V2(70, 70));
    this.waitText = UIKit.at(UIKit.label(v, "", 38, Color.white), C, new V2(40, 40), new V2(640, 60));
    this.inviteButton = UIKit.buttonAt(v, "INVITE A FRIEND", C, new V2(0, -120), new V2(560, 130), true, () => this.Invite(), 46);
    this.inviteButton.setAccent(this.theme.accent);
    this.noteText = UIKit.at(UIKit.wrap(UIKit.label(v, "", 28, Pal.TextDim)), C, new V2(0, -260), new V2(760, 80));
    UIKit.buttonAt(v, "CANCEL", C, new V2(0, -420), new V2(320, 96), false, () => this.Cancel(), 38).setAccent(Pal.TextDim);
  }

  private BuildJoin() {
    const v = UIKit.node("Join", this.card).stretch();
    this.views.set("join", v);
    this.Title(v, "JOIN A TABLE");
    const n = ROOM_CODE_LENGTH, w = 120, gap = 18, x0 = -((n - 1) * (w + gap)) / 2;
    for (let i = 0; i < n; i++) {
      const bg = UIKit.img(v, "Box", Art.UiRound, new Color(1, 1, 1, 0.1));
      bg.rectTransform.place(C, new V2(x0 + i * (w + gap), 320), new V2(w, 140));
      this.boxBg.push(bg);
      this.boxes.push(UIKit.at(UIKit.label(v, "", 86, Color.white), C, new V2(x0 + i * (w + gap), 320), new V2(w, 140)));
    }
    this.errorText = UIKit.at(UIKit.wrap(UIKit.label(v, "", 30, Pal.Danger)), C, new V2(0, 210), new V2(800, 70));
    this.joinStatus = UIKit.at(UIKit.label(v, "", 32, Color.white), C, new V2(0, 210), new V2(800, 50));
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "JOIN"];
    keys.forEach((k, i) => {
      const x = ((i % 3) - 1) * 230, y = 70 - Math.floor(i / 3) * 135;
      const b = UIKit.buttonAt(v, k, C, new V2(x, y), new V2(210, 120), k === "JOIN", () => this.Key(k), k === "JOIN" ? 44 : 60);
      b.setAccent(k === "JOIN" ? this.theme.accent2 : Color.white);
      if (k === "JOIN") this.joinButton = b;
    });
    UIKit.buttonAt(v, "BACK", C, new V2(0, -470), new V2(300, 84), false, () => this.Back(), 34).setAccent(Pal.TextDim);
  }

  // ------------------------------------------------------------------ flow

  open(view: View = "menu", code = "") {
    this.root.setActive(true);
    this.root.setAsLastSibling();
    this.digits = code;
    this.errorText.text = "";
    this.joinStatus.text = "";
    this.Show(view);
    if (view === "join" && code.length === ROOM_CODE_LENGTH) void this.Join();
  }

  private Show(v: View) {
    this.view = v;
    for (const [k, n] of this.views) n.setActive(k === v);
    if (v === "join") this.RefreshBoxes();
  }

  private Close() {
    this.Cancel(false);
    this.root.setActive(false);
    this.cb.onClose?.();
  }

  /** Closes the lobby after a table is ready (the room stays open). */
  hide() { this.root.setActive(false); this.room = null; this.joinedT = -1; }

  private Back() { if (this.busy) return; this.Show("menu"); }

  private Cancel(toMenu = true) {
    if (this.room) { this.room.close(); this.room = null; }
    this.joinedT = -1;
    this.busy = false;
    if (toMenu) this.Show("menu");
  }

  private async Create() {
    if (this.busy) return;
    this.busy = true;
    this.Show("create");
    this.codeText.text = "·".repeat(ROOM_CODE_LENGTH);
    this.waitText.text = "Opening a table…";
    this.inviteButton.interactable = false;
    this.noteText.text = this.createNote;
    try {
      const room = await OnlineRoom.create(this.gameId);
      if (this.view !== "create") { room.close(); return; }
      this.room = room;
      this.codeText.text = room.code;
      this.waitText.text = "Waiting for your friend…";
      this.inviteButton.interactable = true;
      room.onStatus((s) => {
        if (s === "connected" && this.room === room && this.joinedT < 0) {
          this.waitText.text = "FRIEND JOINED!";
          this.waitText.color = this.theme.accent;
          Sfx.play(Snd.PowerUp, 0.8);
          this.joinedT = 1.2;
        }
      });
    } catch (e) {
      this.waitText.text = (e as Error).message;
      this.waitText.color = Pal.Danger;
    } finally { this.busy = false; }
  }

  private async Invite() {
    if (!this.room) return;
    const url = tableInviteUrl(this.room.code);
    const text = `Join my table in ${this.gameGame || "the game"}: code ${this.room.code}`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: this.gameGame, text, url }); return; } catch { /* cancelled or blocked: copy instead */ }
    }
    try { await navigator.clipboard.writeText(url); this.cb.toast("Invite link copied! Send it to your friend.", 2.5); }
    catch { this.cb.toast(`Tell your friend the code: ${this.room.code}`, 3); }
  }

  private Key(k: string) {
    if (this.busy) return;
    this.errorText.text = "";
    if (k === "⌫") this.digits = this.digits.slice(0, -1);
    else if (k === "JOIN") { void this.Join(); return; }
    else if (this.digits.length < ROOM_CODE_LENGTH) this.digits += k;
    this.RefreshBoxes();
  }

  private RefreshBoxes() {
    for (let i = 0; i < this.boxes.length; i++) {
      this.boxes[i].text = this.digits[i] ?? "";
      this.boxBg[i].color = i === this.digits.length ? this.theme.accent2.withAlpha(0.35) : new Color(1, 1, 1, 0.1);
    }
    this.joinButton.interactable = this.digits.length === ROOM_CODE_LENGTH && !this.busy;
  }

  private async Join() {
    if (this.busy) return;
    this.busy = true;
    this.errorText.text = "";
    this.joinStatus.text = "Joining…";
    this.RefreshBoxes();
    try {
      const room = await OnlineRoom.join(this.gameId, this.digits);
      this.joinStatus.text = "Joined! Starting…";
      Sfx.play(Snd.PowerUp, 0.8);
      this.busy = false;
      this.hide();
      this.cb.onReady(room);
    } catch (e) {
      this.joinStatus.text = "";
      this.errorText.text = (e as Error).message;
      Sfx.play(Snd.Deny, 0.6);
      this.busy = false;
      this.RefreshBoxes();
    }
  }

  tick(dt: number) {
    if (!this.root.activeSelf) return;
    this.clock += dt;
    this.spinner.rectTransform.localEulerAngles = new V3(0, 0, -this.clock * 360);
    this.spinner.gameObject.setActive(this.view === "create" && !!this.room && this.joinedT < 0);
    if (this.view === "join") {
      for (const ch of Keyboard.typed) {
        if (/^\d$/.test(ch)) this.Key(ch);
        else if (ch === "Backspace") this.Key("⌫");
        else if (ch === "Enter" && this.digits.length === ROOM_CODE_LENGTH) this.Key("JOIN");
      }
    }
    if (this.joinedT > 0) {
      this.joinedT -= dt;
      const s = 1 + 0.08 * Math.sin(this.clock * 12);
      this.waitText.rectTransform.localScale = new V3(s, s, 1);
      if (this.joinedT <= 0 && this.room) {
        const room = this.room;
        this.waitText.rectTransform.localScale = V3.one;
        this.hide();
        this.cb.onReady(room);
      }
    }
  }
}

// ------------------------------------------------------------------ in-match overlay + reactions

export const Reactions = ["NICE!", "WOW!", "HAHA", "GG"];

export class TableOverlay {
  private root: UINode; private card: UINode;
  private title!: Text; private body!: Text; private menuButton!: ArcadeButton;
  private lostAt = 0; private lostSeconds = 30; private mode: "none" | "lost" | "left" | "rematch" = "none";
  private bar: UINode; private reactButtons: ArcadeButton[] = [];
  private bubbles: { t: Text; age: number }[] = [];
  private cooldown = 0;
  onTimeout: (() => void) | null = null;

  constructor(private theme: OnlineTheme, onMenu: () => void, onReact: (k: number) => void) {
    this.root = UIKit.node("OnlineOverlay", UI.root!).stretch();
    UIKit.dim(this.root, 0.7);
    this.card = UIKit.card(this.root, new V2(820, 520), theme.accent2);
    this.title = UIKit.at(UIKit.wrap(UIKit.label(this.card, "", 48, Color.white)), C, new V2(0, 150), new V2(760, 130));
    this.body = UIKit.at(UIKit.wrap(UIKit.label(this.card, "", 34, Pal.TextDim)), C, new V2(0, 10), new V2(760, 120));
    this.menuButton = UIKit.buttonAt(this.card, "MENU", C, new V2(0, -170), new V2(340, 110), true, onMenu, 44);
    this.menuButton.setAccent(theme.accent);
    this.root.setActive(false);
    // quick reactions (in the HUD area, bottom left)
    this.bar = UIKit.node("Reactions", UI.root!);
    Reactions.forEach((r, i) => {
      const b = UIKit.buttonAt(this.bar, r, C, new V2((i - 1.5) * 120, 0), new V2(110, 84), false, () => this.Send(i, onReact), 28);
      b.setAccent(theme.accent2);
      this.reactButtons.push(b);
    });
    this.bar.setActive(false);
    for (let i = 0; i < 4; i++) {
      const t = UIKit.label(UI.root!, "", 64, Color.white);
      UIKit.glow(t, Pal.Dark, 5);
      t.gameObject.setActive(false);
      this.bubbles.push({ t, age: 9 });
    }
  }

  /** Where the reactions bar sits (canvas units, anchored bottom-left) and where friend reactions pop up. */
  place(bar: { anchor: V2; pos: V2 }, popup: { anchor: V2; pos: V2 }) {
    this.bar.place(bar.anchor, bar.pos, new V2(480, 90));
    this.popupAt = popup;
  }
  private popupAt = { anchor: new V2(0.5, 1), pos: new V2(0, -330) };

  showBar(on: boolean) { this.bar.setActive(on); if (on) this.bar.setAsLastSibling(); }

  private Send(k: number, onReact: (k: number) => void) {
    if (this.cooldown > 0) return;
    this.cooldown = 1.2;
    onReact(k);
    this.Pop(k, false);
  }

  /** A reaction bubble: the friend's near their side (big), mine near my bar (small). */
  Pop(k: number, friend: boolean) {
    const b = this.bubbles.find((x) => x.age > 1.6) ?? this.bubbles[0];
    b.age = 0;
    b.t.text = Reactions[k] ?? "";
    b.t.fontSize = friend ? 84 : 52;
    b.t.color = friend ? this.theme.accent2 : this.theme.accent;
    const at = friend ? this.popupAt : { anchor: this.bar.anchorMin, pos: this.bar.anchoredPosition.add(new V2(0, 110)) };
    b.t.rectTransform.place(at.anchor, at.pos, new V2(600, 120));
    b.t.gameObject.setActive(true);
    b.t.rectTransform.setAsLastSibling();
    if (friend) Sfx.play(Snd.Pickup, 0.7, 1.2);
  }

  /** Friend dropped: countdown before giving up. */
  lost(seconds = 30) {
    this.mode = "lost"; this.lostAt = Time.unscaledTime; this.lostSeconds = seconds;
    this.title.text = "Friend disconnected — waiting…";
    this.menuButton.node.setActive(true);
    this.show(true);
  }

  /** Friend left for good. */
  left(text = "Your friend left", body = "The table is closed.") {
    this.mode = "left";
    this.title.text = text;
    this.body.text = body;
    this.menuButton.node.setActive(true);
    this.show(true);
  }

  /** Waiting for the friend to accept a rematch. */
  waitingRematch() {
    this.mode = "rematch";
    this.title.text = "REMATCH";
    this.body.text = "Waiting for your friend…";
    this.menuButton.node.setActive(true);
    this.show(true);
  }

  hide() { this.mode = "none"; this.show(false); }
  get busy() { return this.mode !== "none"; }
  get state() { return this.mode; }

  private show(on: boolean) { this.root.setActive(on); if (on) this.root.setAsLastSibling(); }

  tick() {
    const dt = Time.unscaledDeltaTime;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const b of this.bubbles) {
      if (b.age > 1.6) continue;
      b.age += dt;
      if (b.age > 1.6) { b.t.gameObject.setActive(false); continue; }
      const s = Mathf.lerp(0.3, 1, Ease.outBack(Mathf.clamp01(b.age / 0.3)));
      b.t.rectTransform.localScale = new V3(s, s, 1);
      b.t.color = b.t.color.withAlpha(b.age > 1.2 ? (1.6 - b.age) / 0.4 : 1);
    }
    if (this.mode === "lost") {
      const left = Math.max(0, Math.ceil(this.lostSeconds - (Time.unscaledTime - this.lostAt)));
      this.body.text = `They have ${left} s to come back.`;
      if (left <= 0) { this.mode = "none"; this.onTimeout?.(); }
    } else if (this.mode === "rematch") {
      this.body.text = "Waiting for your friend" + ".".repeat(1 + (Math.floor(Time.unscaledTime * 2) % 3));
    }
  }
}
