import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image,
  Mathf, Pal, Phase, Quaternion, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor, Time,
  TouchScheme, UIKit, V2, V3, CasualArt,
} from "../../kit";
import { BladeTossArt } from "./BladeTossArt";

/**
 * BLADE TOSS: tap to throw a knife into the spinning target. Every knife must stick without touching one that is
 * already there. Use up all your knives to smash the target and move on; every fifth stage is a boss target with
 * tricky spins. Slice apples on the rim for coins and spend them on new knife skins. A rewarded ad lets you retry the
 * stage once, keeping your score. (Port of BladeTossGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 260, BottomBand = 60;
const TargetR = 1.55, KnifeScale = 0.34, KnifeLen = KnifeScale * 4; // the sprite is 1 x 4 units at scale 1
const Embed = 0.42, ThrowSpeed = 34, GapDeg = 10.5, AppleDeg = 13;
const MaxStuck = 24, MaxFlying = 16;

const Ink = Pal.hex(0x2e2545), Gold = Pal.hex(0xffc93c), Apple = Pal.hex(0xe8243c), Mint = Pal.hex(0x50e3a4);

class Stuck {
  constructor(public Sr: SpriteRenderer) {}
  Angle = 0; // local angle on the target (degrees), where the knife points from centre outward
  Active = false;
}

class Loose {
  constructor(public Sr: SpriteRenderer) {}
  Pos = V2.zero; Vel = V2.zero;
  Rot = 0; Spin = 0;
  Active = false;
}

class AppleItem {
  constructor(public Sr: SpriteRenderer) {}
  Angle = 0;
  Active = false;
}

export class BladeTossGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject; private targetRoot!: GameObject;
  private bgCover!: SpriteRenderer; private targetSr!: SpriteRenderer; private targetShadow!: SpriteRenderer;
  private readyKnife!: SpriteRenderer; private flyingKnife!: SpriteRenderer;
  private readonly stuck: Stuck[] = [];
  private readonly loose: Loose[] = [];
  private readonly apples: AppleItem[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();

  private targetPos = V2.zero; private throwFrom = V2.zero;
  private targetAngle = 0; private spinT = 0; private hitPulse = 0; private flyY = 0; private readyAnim = 1;
  private stageTimer = 0; private failTimer = 0; private smashTimer = 0; private attractTimer = 0;
  private stage = 0; private knivesLeft = 0; private knivesTotal = 0; private score = 0; private applesRun = 0; private pattern = 0;
  private targetKind = 0;
  private flying = false; private failing = false; private smashing = false; private revived = false;
  private baseSpeed = 0;

  // HUD
  private scoreText!: Text; private stageText!: Text; private coinText!: Text;
  private readonly knifeIcons: Image[] = [];
  private readonly stageDots: Image[] = [];
  private skinPreview: Image | null = null;
  private skinName!: Text; private skinInfo!: Text;
  private skinPrev!: ArcadeButton; private skinNext!: ArcadeButton; private skinAction!: ArcadeButton;
  private browseSkin = 0;

  private throwClip!: AudioClip; private thunkClip!: AudioClip; private clankClip!: AudioClip; private smashClip!: AudioClip; private appleClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "bladetoss",
      Title: "BLADE TOSS",
      Tagline: "THROW. STICK. DON'T HIT A BLADE.",
      Accent: Pal.hex(0xff8a3d),
      Accent2: Gold,
      BgTop: Pal.hex(0x5b4b8a),
      BgBottom: Pal.hex(0x2e2545),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 120, rootHz: 110, degrees: [0, 5, 3, 4], seed: 88, energy: 0.65, major: false },
      Reminders: [
        "The target is spinning|Your knives are sharp and ready.",
        "A boss is waiting|Can you beat stage " + 5 + "?",
        "Apples on the rim|Slice them for coins and a shiny new knife.",
      ],
      HowTo: [
        howTo(BladeTossArt.Knife(0), Color.white, "TAP anywhere to throw a knife into the spinning target."),
        howTo(Art.Diamond, Pal.Danger, "Don't hit a knife that's already stuck, or the stage is lost!"),
        howTo(BladeTossArt.Target(0), Color.white, "Throw all your knives to SMASH the target and reach the next stage."),
        howTo(BladeTossArt.Target(1), Color.white, "Every 5th stage is a BOSS with tricky spins."),
        howTo(BladeTossArt.Apple, Color.white, "Hit APPLES on the rim for coins. Buy new knives on the title screen."),
      ],
      Tips: [
        "Watch the gaps, not the target.",
        "When the target slows down, that's your moment.",
        "Bosses reverse direction: wait for the turn.",
        "An apple is worth the risk only if the gap is wide.",
        "Rhythm helps: count the spins.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 11 : 8.6; }

  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Skin() { return Mathf.clamp(this.Data.get("skin"), 0, BladeTossArt.Skins - 1); }
  private Owned(s: number) { return s === 0 || this.Data.get("own" + s) === 1; }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST ${Fmt.n(best)}   ·   STAGE ${this.Data.get("bestStage")}` : "HOW FAR CAN YOU GO?";
  }

  protected StatsLine() { return `${Fmt.n(this.Coins)} COINS   ·   ${Fmt.n(this.Data.get("knives"))} KNIVES THROWN   ·   ${this.Data.get("bosses")} BOSSES`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("BladeWorld", this.gameObject);
    CasualLook.calm(this, 1.2, 0.25);
    this.bgCover = CasualLook.cover(this.world, BladeTossArt.Forest, -910);

    this.targetRoot = new GameObject("Target", this.world);
    this.targetShadow = Art.spr(this.world, "TargetShadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), TargetR * 2.6, 4, Art.Flat);
    this.targetSr = Art.spr(this.targetRoot, "TargetBody", BladeTossArt.Target(0), Color.white, TargetR * 2, 10, Art.Flat);
    for (let i = 0; i < MaxStuck; i++) {
      const sr = Art.spr(this.targetRoot, "Knife", BladeTossArt.Knife(0), Color.white, KnifeScale, 8, Art.Flat);
      sr.gameObject.setActive(false);
      this.stuck.push(new Stuck(sr));
    }
    for (let i = 0; i < MaxFlying; i++) {
      const sr = Art.spr(this.world, "Loose", BladeTossArt.Knife(0), Color.white, KnifeScale, 30, Art.Flat);
      sr.gameObject.setActive(false);
      this.loose.push(new Loose(sr));
    }
    this.readyKnife = Art.spr(this.world, "Ready", BladeTossArt.Knife(0), Color.white, KnifeScale, 20, Art.Flat);
    this.flyingKnife = Art.spr(this.world, "Flying", BladeTossArt.Knife(0), Color.white, KnifeScale, 20, Art.Flat);
    this.flyingKnife.gameObject.setActive(false);
    this.fx = CasualFx.create(this.world, 40, 260);

    const noise = new SysRandom(2);
    const N = () => noise.nextDouble() * 2 - 1;
    this.throwClip = Sfx.make("bt-throw", 0.14, (t) => N() * Sfx.env(t, 0.01, 0.1) * 0.18 * (1 - t * 5));
    let lp = 0;
    this.thunkClip = Sfx.make("bt-thunk", 0.18, (t) => { lp += (N() - lp) * 0.3; return (Sfx.sinP(Sfx.glide(t, 260, 120, 0.1)) * 0.6 + lp * 0.6) * Sfx.env(t, 0.001, 0.12) * 0.45; });
    this.clankClip = Sfx.make("bt-clank", 0.4, (t) => (Sfx.sinP(1830 * t) * 0.4 + Sfx.sinP(2710 * t) * 0.3 + Sfx.sinP(4120 * t) * 0.2 + N() * 0.2 * Sfx.env(t, 0.001, 0.03)) * Sfx.env(t, 0.001, 0.3) * 0.3);
    let lp2 = 0;
    this.smashClip = Sfx.make("bt-smash", 0.6, (t) => { lp2 += (N() - lp2) * 0.2; return (lp2 * 0.9 + Sfx.sinP(Sfx.glide(t, 140, 50, 0.4)) * 0.5) * Sfx.env(t, 0.002, 0.5) * 0.5; });
    this.appleClip = Sfx.make("bt-apple", 0.22, (t) => (N() * 0.4 * Sfx.env(t, 0.001, 0.05) + Sfx.sinP(Sfx.glide(t, 700, 1300, 0.15)) * 0.4 * Sfx.env(t, 0.003, 0.18)) * 0.4);

    this.BuildHud();
    this.Layout();
    this.ApplySkin();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 86, Color.white), new V2(0.5, 1), new V2(0, -80), new V2(400, 100));
    UIKit.glow(this.scoreText, Ink, 4);
    this.stageText = UIKit.at(UIKit.label(hud, "STAGE 1", 32, Gold), new V2(0.5, 1), new V2(0, -150), new V2(500, 44));
    UIKit.glow(this.stageText, Ink, 3);
    for (let i = 0; i < 5; i++) {
      const dot = UIKit.img(hud, "StageDot", i === 4 ? Art.Star : Art.UiCircle, new Color(1, 1, 1, 0.3));
      dot.rectTransform.place(new V2(0.5, 1), new V2((i - 2) * 56, -205), i === 4 ? new V2(44, 44) : new V2(28, 28));
      this.stageDots.push(dot);
    }
    const coin = UIKit.img(hud, "CoinIcon", BladeTossArt.Apple, Color.white);
    coin.rectTransform.place(new V2(0, 1), new V2(70, -80), new V2(56, 56));
    this.coinText = UIKit.at(UIKit.label(hud, "0", 40, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(210, -80), new V2(220, 56));
    UIKit.glow(this.coinText, Ink, 3);
    for (let i = 0; i < 12; i++) {
      const k = UIKit.img(hud, "KnifeIcon", BladeTossArt.Knife(0), Color.white);
      k.rectTransform.place(new V2(0, 0), new V2(60, 90 + i * 52), new V2(16, 64));
      k.rectTransform.localRotation = Quaternion.euler(0, 0, -45);
      this.knifeIcons.push(k);
    }

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.15, 0.11, 0.24, 0.86));
      this.skinPreview = UIKit.img(this.UI.TitleExtra, "Skin", BladeTossArt.Knife(0), Color.white);
      this.skinPreview.rectTransform.place(UIKit.Center, new V2(-250, 0), new V2(30, 120));
      this.skinPreview.rectTransform.localRotation = Quaternion.euler(0, 0, -60);
      this.skinName = UIKit.at(UIKit.label(this.UI.TitleExtra, "", 32, Color.white), UIKit.Center, new V2(-40, 22), new V2(300, 44));
      this.skinInfo = UIKit.at(UIKit.label(this.UI.TitleExtra, "", 24, Gold), UIKit.Center, new V2(-40, -22), new V2(300, 34));
      this.skinPrev = UIKit.buttonAt(this.UI.TitleExtra, "<", UIKit.Center, new V2(-420, 0), new V2(110, 96), false, () => this.BrowseSkin(-1), 46);
      this.skinNext = UIKit.buttonAt(this.UI.TitleExtra, ">", UIKit.Center, new V2(420, 0), new V2(110, 96), false, () => this.BrowseSkin(1), 46);
      this.skinAction = UIKit.buttonAt(this.UI.TitleExtra, "EQUIP", UIKit.Center, new V2(220, 0), new V2(230, 96), false, () => this.SkinAction(), 30);
      for (const b of [this.skinPrev, this.skinNext, this.skinAction]) b.setAccent(Pal.hex(0xff8a3d));
      this.browseSkin = this.Skin;
      this.RefreshSkin();
    }
  }

  private BrowseSkin(d: number) {
    this.browseSkin = (this.browseSkin + d + BladeTossArt.Skins) % BladeTossArt.Skins;
    Sfx.play(Snd.Click, 0.6);
    this.RefreshSkin();
  }

  private SkinAction() {
    if (this.Owned(this.browseSkin)) {
      this.Data.set("skin", this.browseSkin);
      Sfx.play(Snd.Confirm, 0.6);
    } else {
      const cost = BladeTossArt.SkinCost[this.browseSkin];
      if (this.Coins < cost) {
        Sfx.play(Snd.Deny, 0.6);
        this.UI.Toast(`Need ${cost - this.Coins} more coins. Slice apples to earn them!`, 2.5);
        return;
      }
      this.Coins -= cost;
      this.Data.set("own" + this.browseSkin, 1);
      this.Data.set("skin", this.browseSkin);
      Sfx.play(Snd.PowerUp, 0.8);
      this.UI.Toast(BladeTossArt.SkinNames[this.browseSkin] + " knife unlocked!", 2);
    }
    this.Data.flush();
    this.ApplySkin();
    this.RefreshSkin();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshSkin() {
    if (!this.skinPreview) return;
    this.skinPreview.sprite = BladeTossArt.Knife(this.browseSkin);
    this.skinName.text = BladeTossArt.SkinNames[this.browseSkin] + " KNIFE";
    const owned = this.Owned(this.browseSkin), equipped = this.browseSkin === this.Skin;
    this.skinInfo.text = equipped ? "EQUIPPED" : owned ? "OWNED" : `${BladeTossArt.SkinCost[this.browseSkin]} COINS`;
    if (this.skinAction.label) this.skinAction.label.text = equipped ? "IN USE" : owned ? "EQUIP" : "BUY";
    this.skinAction.interactable = !equipped;
  }

  private ApplySkin() {
    const s = BladeTossArt.Knife(this.Skin);
    this.readyKnife.sprite = s;
    this.flyingKnife.sprite = s;
    for (const k of this.knifeIcons) k.sprite = s;
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(TopBand, BottomBand, 0.2);
    this.targetPos = new V2(0, rect.yMax - TargetR - 1.2);
    this.throwFrom = new V2(0, rect.yMin + KnifeLen * 0.5 + 0.4);
    if (this.throwFrom.y > this.targetPos.y - TargetR - KnifeLen - 1.5) this.throwFrom = this.throwFrom.withY(this.targetPos.y - TargetR - KnifeLen - 1.5);
    this.targetRoot.localPosition = new V3(this.targetPos.x, this.targetPos.y, 0);
    this.targetShadow.transform.localPosition = new V3(this.targetPos.x + 0.15, this.targetPos.y - 0.25, 0);
    this.readyKnife.transform.localPosition = new V3(this.throwFrom.x, this.throwFrom.y, 0);
  }

  // ------------------------------------------------------------------ stages

  private IsBoss(s: number) { return s % 5 === 0; }

  private SetupStage(s: number) {
    for (const k of this.stuck) { k.Active = false; k.Sr.gameObject.setActive(false); }
    for (const a of this.apples) { a.Active = false; a.Sr.gameObject.setActive(false); }
    this.rng = new SysRandom(s * 977 + Math.trunc(Time.realtimeSinceStartup * 10));
    const boss = this.IsBoss(s);
    this.targetKind = boss ? 1 + ((Math.trunc(s / 5) - 1) % (BladeTossArt.Targets - 1)) : 0;
    this.targetSr.sprite = BladeTossArt.Target(this.targetKind);
    this.knivesTotal = boss ? 9 + Math.min(3, Math.trunc(s / 10)) : 6 + Math.min(4, (s % 5) + Math.trunc(s / 8));
    this.knivesLeft = this.knivesTotal;
    this.baseSpeed = Math.min(260, 110 + s * 6) * (this.rng.next(2) === 0 ? 1 : -1);
    this.pattern = boss ? 2 + this.rng.next(3) : s < 3 ? 0 : this.rng.next(s < 7 ? 2 : 5);
    this.spinT = 0;
    this.targetAngle = this.rng.nextDouble() * 360;
    // pre-stuck knives
    const pre = boss ? 2 + this.rng.next(3) : Math.min(Math.trunc(s / 2), 4);
    for (let i = 0; i < pre; i++) {
      const a = this.rng.nextDouble() * 360;
      if (!this.Clear(a, GapDeg * 2.2)) continue;
      this.AddStuck(a);
    }
    // apples
    const nApples = this.rng.nextDouble() < 0.6 ? 1 + (this.rng.nextDouble() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < nApples; i++) {
      const a = this.rng.nextDouble() * 360;
      if (!this.Clear(a, AppleDeg * 1.5)) continue;
      let ap = this.apples.find((x) => !x.Active);
      if (!ap) {
        ap = new AppleItem(Art.spr(this.targetRoot, "Apple", BladeTossArt.Apple, Color.white, 0.7, 12, Art.Flat));
        this.apples.push(ap);
      }
      ap.Active = true;
      ap.Angle = a;
      ap.Sr.gameObject.setActive(true);
    }
    this.flying = this.failing = this.smashing = false;
    this.flyingKnife.gameObject.setActive(false);
    this.readyAnim = 0;
    this.stageTimer = 0;
    this.targetSr.color = Color.white;
    this.targetRoot.localScale = V3.one;
    this.PlaceStuck();
  }

  private Clear(angle: number, gap: number) {
    for (const k of this.stuck) if (k.Active && Math.abs(Mathf.deltaAngle(k.Angle, angle)) < gap) return false;
    for (const a of this.apples) if (a.Active && Math.abs(Mathf.deltaAngle(a.Angle, angle)) < gap) return false;
    return true;
  }

  private AddStuck(angle: number) {
    for (const k of this.stuck) {
      if (k.Active) continue;
      k.Active = true;
      k.Angle = angle;
      k.Sr.sprite = BladeTossArt.Knife(this.Skin);
      k.Sr.gameObject.setActive(true);
      return;
    }
  }

  private PlaceStuck() {
    const dist = TargetR - Embed + KnifeLen * 0.5;
    for (const k of this.stuck) {
      if (!k.Active) continue;
      const a = k.Angle * Mathf.Deg2Rad;
      // stored in target-local space; the target root itself rotates
      k.Sr.transform.localPosition = new V3(Math.cos(a) * dist, Math.sin(a) * dist, 0);
      k.Sr.transform.localRotation = Quaternion.euler(0, 0, k.Angle + 90); // tip points to the centre
    }
    for (const ap of this.apples) {
      if (!ap.Active) continue;
      const a = ap.Angle * Mathf.Deg2Rad;
      ap.Sr.transform.localPosition = new V3(Math.cos(a) * (TargetR + 0.22), Math.sin(a) * (TargetR + 0.22), 0);
      ap.Sr.transform.localRotation = Quaternion.euler(0, 0, ap.Angle - 90);
    }
  }

  private SpinRate(t: number) {
    switch (this.pattern) {
      case 1: return this.baseSpeed * (1 + 0.55 * Math.sin(t * 1.7));                    // wobble
      case 2: return this.baseSpeed * (Mathf.repeat(t, 3.2) < 1.6 ? 1.15 : -1.15);       // reverse
      case 3: return this.baseSpeed * (Mathf.repeat(t, 2.4) < 1.5 ? 1.6 : 0.12);         // stop and go
      case 4: return this.baseSpeed * Math.sin(t * 1.25) * 1.7;                          // pendulum
      default: return this.baseSpeed;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    for (const l of this.loose) { l.Active = false; l.Sr.gameObject.setActive(false); }
    this.stage = 1;
    this.SetupStage(1);
    this.attractTimer = 0.8;
    this.ApplySkin();
    this.browseSkin = this.Skin;
    this.RefreshSkin();
  }

  protected BeginRun() {
    this.Layout();
    this.ApplySkin();
    for (const l of this.loose) { l.Active = false; l.Sr.gameObject.setActive(false); }
    this.fx.clear();
    this.stage = 1;
    this.score = this.applesRun = 0;
    this.revived = false;
    this.SetupStage(this.stage);
    this.pointer.reset();
    this.pointer.topBand = 0.06;
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap to throw. Don't hit the other knives!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.4);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Spin(dt);
    this.UpdateLoose(dt);
    if (this.State !== Phase.Title) return;
    if (this.flying) { this.Fly(dt, false); return; }
    if (this.smashing) { this.UpdateSmash(dt, false); return; }
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 0.9;
      // only throw when it's safe (the demo never misses)
      const local = Mathf.repeat(-90 - this.targetAngle, 360);
      if (this.Clear(local, GapDeg * 1.6)) this.Throw(false);
      else this.attractTimer = 0.1;
    }
    this.AnimateReady(dt);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.Spin(dt);
    this.UpdateLoose(dt);
    this.AnimateReady(dt);
    this.stageTimer += dt;

    if (this.failing) {
      this.failTimer += dt;
      if (this.failTimer > 1.1 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if (this.smashing) { this.UpdateSmash(dt, true); return; }
    if (this.flying) { this.Fly(dt, true); this.UpdateHud(); return; }

    if ((this.pointer.down || this.Controls.actionPressed) && this.knivesLeft > 0 && this.readyAnim > 0.6) this.Throw(true);
    this.UpdateHud();
  }

  private Spin(dt: number) {
    if (this.smashing) return;
    this.spinT += dt;
    this.targetAngle += this.SpinRate(this.spinT) * dt;
    this.hitPulse = Mathf.moveTowards(this.hitPulse, 0, dt * 6);
    this.targetRoot.localRotation = Quaternion.euler(0, 0, this.targetAngle);
    const s = 1 + this.hitPulse * 0.04;
    if (!this.smashing) this.targetRoot.localScale = new V3(s, s, 1);
    this.targetRoot.localPosition = new V3(this.targetPos.x, this.targetPos.y + this.hitPulse * 0.12, 0);
  }

  private AnimateReady(dt: number) {
    this.readyAnim = Math.min(1, this.readyAnim + dt * 6);
    const show = !this.flying && !this.failing && !this.smashing && (this.State !== Phase.Playing || this.knivesLeft > 0);
    this.readyKnife.gameObject.setActive(show);
    this.readyKnife.transform.localPosition = new V3(this.throwFrom.x, this.throwFrom.y - (1 - Ease.outCubic(this.readyAnim)) * 1.2, 0);
  }

  private Throw(real: boolean) {
    this.flying = true;
    this.flyY = this.throwFrom.y;
    this.flyingKnife.gameObject.setActive(true);
    this.flyingKnife.transform.localRotation = Quaternion.identity;
    this.flyingKnife.transform.localPosition = new V3(this.throwFrom.x, this.flyY, 0);
    Sfx.playClip(this.throwClip, real ? 0.8 : 0.3);
    if (real) {
      this.knivesLeft--;
      this.Data.add("knives", 1);
      this.UI.Hint(null);
    }
  }

  private Fly(dt: number, real: boolean) {
    this.flyY += ThrowSpeed * dt;
    const tipY = this.flyY + KnifeLen * 0.5;
    const contact = this.targetPos.y - TargetR + Embed;
    // a stuck knife hanging below the target is hit before the rim
    const local = Mathf.repeat(-90 - this.targetAngle, 360);
    const handleReach = this.targetPos.y - TargetR - KnifeLen + Embed + 0.1;
    let blocked = false;
    for (const k of this.stuck) if (k.Active && Math.abs(Mathf.deltaAngle(k.Angle, local)) < GapDeg) { blocked = true; break; }
    if (blocked && tipY >= handleReach) {
      this.Bounce(real);
      return;
    }
    if (tipY >= contact) {
      this.Stick(local, real);
      return;
    }
    this.flyingKnife.transform.localPosition = new V3(this.throwFrom.x, this.flyY, 0);
  }

  private Stick(local: number, real: boolean) {
    this.flying = false;
    this.flyingKnife.gameObject.setActive(false);
    this.AddStuck(local);
    this.PlaceStuck();
    this.hitPulse = 1;
    const hit = new V2(this.targetPos.x, this.targetPos.y - TargetR);
    this.fx.pop(hit, this.ChipColor(), 8, 4, 0.14, 0.35);
    for (let i = 0; i < 4; i++)
      this.fx.emit(hit, new V2((this.rng.nextDouble() - 0.5) * 5, -1 - this.rng.nextDouble() * 3), this.ChipColor(), 0.18, 0.6, BladeTossArt.Chip, 14, (this.rng.nextDouble() - 0.5) * 600, false, 0.5);
    Sfx.playClip(this.thunkClip, real ? 0.9 : 0.35, 0.95 + this.rng.nextDouble() * 0.1);
    this.readyAnim = 0;

    // apple slice
    for (const ap of this.apples) {
      if (!ap.Active || Math.abs(Mathf.deltaAngle(ap.Angle, local)) > AppleDeg) continue;
      ap.Active = false;
      ap.Sr.gameObject.setActive(false);
      const at = new V2(this.targetPos.x, this.targetPos.y - TargetR - 0.25);
      this.fx.pop(at, Apple, 14, 5, 0.22, 0.5);
      this.fx.pop(at, Pal.hex(0xfff1d6), 6, 3, 0.18, 0.4);
      Sfx.playClip(this.appleClip, 0.8);
      if (real) {
        this.applesRun++;
        this.Coins += 2;
        this.UI.Float(at, "+2", Gold, 1);
      }
    }

    if (!real) {
      let n = 0;
      for (const k of this.stuck) if (k.Active) n++;
      if (n >= 9) this.StartSmash();
      return;
    }
    this.score++;
    Fx.haptic();
    this.Fx.shake(0.05);
    if (this.knivesLeft <= 0) this.StartSmash();
  }

  private ChipColor() {
    switch (this.targetKind) {
      case 1: return Pal.hex(0xf5c84b);
      case 2: return Pal.hex(0x3e4149);
      case 3: return Pal.hex(0xe8eef5);
      case 4: return Pal.hex(0xff9a1f);
      case 5: return Pal.hex(0x8a8f99);
      default: return Pal.hex(0xe8b97a);
    }
  }

  private Bounce(real: boolean) {
    this.flying = false;
    this.flyingKnife.gameObject.setActive(false);
    this.SpawnLoose(new V2(this.throwFrom.x, this.flyY), new V2((this.rng.nextDouble() - 0.5) * 6, -6), 0, (this.rng.nextDouble() > 0.5 ? 1 : -1) * 900);
    const at = new V2(this.throwFrom.x, this.flyY + KnifeLen * 0.5);
    this.fx.sparkle(at, Color.white, 8, 0.3, 0.35);
    Sfx.playClip(this.clankClip, real ? 1 : 0.4);
    if (!real) return;
    this.failing = true;
    this.failTimer = 0;
    this.Fx.shake(0.35);
    Fx.haptic(true);
    this.UI.Announce("CLANG!", Pal.Danger, 1);
    Sfx.play(Snd.Lose, 0.6);
  }

  private SpawnLoose(pos: V2, vel: V2, rot: number, spin: number) {
    for (const l of this.loose) {
      if (l.Active) continue;
      l.Active = true;
      l.Pos = pos;
      l.Vel = vel;
      l.Rot = rot;
      l.Spin = spin;
      l.Sr.sprite = BladeTossArt.Knife(this.Skin);
      l.Sr.gameObject.setActive(true);
      return;
    }
  }

  private UpdateLoose(dt: number) {
    for (const l of this.loose) {
      if (!l.Active) continue;
      l.Vel = l.Vel.withY(l.Vel.y - 22 * dt);
      l.Pos = l.Pos.add(l.Vel.mul(dt));
      l.Rot += l.Spin * dt;
      l.Sr.transform.localPosition = new V3(l.Pos.x, l.Pos.y, 0);
      l.Sr.transform.localRotation = Quaternion.euler(0, 0, l.Rot);
      if (l.Pos.y < -this.ViewSize.y * 0.5 - 3) { l.Active = false; l.Sr.gameObject.setActive(false); }
    }
  }

  private StartSmash() {
    this.smashing = true;
    this.smashTimer = 0;
    // stuck knives fly off
    for (const k of this.stuck) {
      if (!k.Active) continue;
      const wa = (k.Angle + this.targetAngle) * Mathf.Deg2Rad;
      const dir = new V2(Math.cos(wa), Math.sin(wa));
      this.SpawnLoose(this.targetPos.add(dir.mul(TargetR + 0.6)), dir.mul(8).add(V2.up.mul(4)), k.Angle + this.targetAngle + 90, (this.rng.nextDouble() - 0.5) * 700);
      k.Active = false;
      k.Sr.gameObject.setActive(false);
    }
    for (const a of this.apples) { a.Active = false; a.Sr.gameObject.setActive(false); }
    for (let i = 0; i < 30; i++) {
      const a = this.rng.nextDouble() * Math.PI * 2;
      const d = new V2(Math.cos(a), Math.sin(a));
      this.fx.emit(this.targetPos.add(d.mul(this.rng.nextDouble() * TargetR)), d.mul(4 + this.rng.nextDouble() * 6).add(V2.up.mul(3)), this.ChipColor(),
        0.3 + this.rng.nextDouble() * 0.3, 1.1, BladeTossArt.Chip, 16, (this.rng.nextDouble() - 0.5) * 800, false, 0.4);
    }
    this.fx.pop(this.targetPos, this.ChipColor(), 24, 7, 0.3, 0.6);
    Sfx.playClip(this.smashClip, this.State === Phase.Playing ? 1 : 0.4);
    if (this.State === Phase.Playing) {
      this.Fx.shake(0.4);
      Fx.haptic(true);
      if (this.IsBoss(this.stage)) {
        this.UI.Announce("BOSS DEFEATED!", Gold, 1.5);
        this.Coins += 5;
        this.Data.add("bosses", 1);
        this.fx.confetti(this.targetPos, 50, 8, [Gold, Apple, Mint, Color.white]);
      } else this.UI.Announce("SMASH!", Pal.hex(0xff8a3d), 0.9);
    }
  }

  private UpdateSmash(dt: number, real: boolean) {
    this.smashTimer += dt;
    const k = Mathf.clamp01(this.smashTimer / 0.25);
    this.targetRoot.localScale = new V3(1 + k * 0.4, 1 + k * 0.4, 1);
    this.targetSr.color = new Color(1, 1, 1, 1 - k);
    if (this.smashTimer < 1.0) return;
    if (real) this.stage++;
    this.SetupStage(real ? this.stage : 1);
    if (real) {
      this.Data.max("bestStage", this.stage);
      this.UI.Announce(this.IsBoss(this.stage) ? `BOSS: ${BladeTossArt.TargetNames[this.targetKind]}` : `STAGE ${this.stage}`, this.IsBoss(this.stage) ? Pal.Danger : Gold, 1.3);
      if (this.IsBoss(this.stage)) Sfx.play(Snd.Alarm, 0.5);
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    BladeTossGame.SetText(this.scoreText, String(this.score));
    BladeTossGame.SetText(this.stageText, this.IsBoss(this.stage) ? "BOSS STAGE" : "STAGE " + this.stage);
    this.stageText.color = this.IsBoss(this.stage) ? Pal.hex(0xff6a6a) : Gold;
    BladeTossGame.SetText(this.coinText, Fmt.n(this.Coins));
    for (let i = 0; i < this.knifeIcons.length; i++) {
      const on = i < this.knivesTotal;
      this.knifeIcons[i].gameObject.setActive(on);
      if (on) this.knifeIcons[i].color = i < this.knivesLeft ? Color.white : new Color(0.2, 0.15, 0.3, 0.6);
    }
    const inRound = (this.stage - 1) % 5;
    for (let i = 0; i < this.stageDots.length; i++)
      this.stageDots[i].color = i < inRound ? Gold : i === inRound ? Color.white : new Color(1, 1, 1, 0.3);
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Data.max("bestStage", this.stage);
    this.Finish(new Result({
      Headline: newBest ? "NEW RECORD!" : "BLADES CLASHED",
      HeadlineColor: newBest ? Gold : Pal.hex(0xffc2b0),
      Value: String(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `REACHED STAGE ${this.stage}` + (this.IsBoss(this.stage) ? " (BOSS)" : ""),
      Stats: [
        ["SCORE", String(this.score)],
        ["STAGE", String(this.stage)],
        ["APPLES", String(this.applesRun)],
        ["COINS", Fmt.n(this.Coins)],
      ],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "RETRY THIS STAGE (WATCH AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    for (const l of this.loose) { l.Active = false; l.Sr.gameObject.setActive(false); }
    // the knives thrown in this stage are taken back
    this.score = Math.max(0, this.score - (this.knivesTotal - this.knivesLeft - 1));
    this.SetupStage(this.stage);
    this.pointer.reset();
    this.Revive();
    this.UI.Announce(`STAGE ${this.stage}`, Gold, 1.1);
    Sfx.play(Snd.PowerUp);
  }
}
