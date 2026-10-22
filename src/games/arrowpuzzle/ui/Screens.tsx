import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DIFFICULTY_NAMES, Difficulty } from "../core/level";
import { MAX_LIVES, game } from "../game/controller";
import { LOVE_NAME, loveNote } from "../game/loveNotes";
import { Save } from "../game/save";
import { Sfx } from "../game/sfx";
import { ui, useUi } from "../game/store";
import { THEMES, Theme, getTheme } from "../game/theme";
import {
  ArrowIcon, BackIcon, BulbIcon, FitIcon, ForwardIcon, GearIcon, HeartIcon, LockIcon, MenuIcon, PlayIcon, RestartIcon, StarIcon,
} from "./icons";

const LEVELS_PER_PAGE = 20;

const click = (fn: () => void) => () => { Sfx.unlock(); Sfx.play("click", 0.6); fn(); };

function Btn(props: { variant?: "primary" | "outline" | "icon" | "danger"; onClick: () => void; children: ReactNode; className?: string; label?: string; style?: CSSProperties; disabled?: boolean }) {
  const { variant = "outline", onClick, children, className = "", label, style, disabled } = props;
  return (
    <button type="button" className={`ap-btn ap-btn-${variant} ${className}`} onClick={click(onClick)} aria-label={label} style={style} disabled={disabled}>
      {children}
    </button>
  );
}

function difficultyColor(t: Theme, d: Difficulty) {
  return [t.success, t.accent, t.accent2, t.danger][d] ?? t.danger;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// ------------------------------------------------------------------ menu

export function Menu() {
  const s = useUi();
  const t = getTheme(s.themeIndex);
  void s.saveVersion; // re-read saved stats whenever progress changes
  return (
    <div className="ap-screen ap-menu ap-fade">
      <div className="ap-dim" />
      <div className="ap-menu-title">
        <h1 className="ap-title-a">ARROW</h1>
        <h2 className="ap-title-b">PUZZLE</h2>
        <p className="ap-love">// MADE WITH LOVE FOR {LOVE_NAME.toUpperCase()} //</p>
        <div className="ap-line" />
      </div>
      <div className="ap-menu-actions">
        <p className="ap-level-info">LEVEL {Save.currentLevel} <span style={{ color: difficultyColor(t, s.difficulty) }}>· {DIFFICULTY_NAMES[s.difficulty]}</span></p>
        <Btn variant="primary" className="ap-play" onClick={() => game.playLevel(Save.currentLevel)}><PlayIcon className="ap-ico" /> PLAY</Btn>
        <div className="ap-row">
          <Btn onClick={() => ui.set({ overlay: "levels" })}>LEVELS</Btn>
          <Btn onClick={() => ui.set({ overlay: "settings" })}>SETTINGS</Btn>
        </div>
      </div>
      <div className="ap-menu-footer">
        <p>STARS {Save.totalStars} &nbsp;//&nbsp; CLEARED {Save.unlockedLevel - 1} &nbsp;//&nbsp; HINTS {Save.hints}</p>
        <p className="ap-faint">TAP ARROWS · CLEAR THE GRID · DON'T CRASH</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ HUD

export function Hud() {
  const s = useUi();
  const t = getTheme(s.themeIndex);
  const dc = difficultyColor(t, s.difficulty);
  const hearts = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (s.mistakes === 0 || !hearts.current) return;
    const row = hearts.current;
    row.classList.remove("ap-shake");
    void row.offsetWidth; // restart the animation
    row.classList.add("ap-shake");
  }, [s.mistakes]);

  return (
    <div className="ap-screen ap-hud ap-fade">
      <div className="ap-top">
        <Btn variant="icon" className="ap-corner-l" label="Menu" onClick={() => game.goToMenu()}><MenuIcon /></Btn>
        <Btn variant="icon" className="ap-corner-r" label="Settings" onClick={() => ui.set({ overlay: "settings" })}><GearIcon /></Btn>
        <div className="ap-level">LEVEL {s.levelNumber}</div>
        <div className="ap-pill" style={{ color: dc, borderColor: dc }}>{DIFFICULTY_NAMES[s.difficulty]}</div>
        <div className="ap-status">
          <div className="ap-hearts" ref={hearts}>
            {Array.from({ length: MAX_LIVES }, (_, i) => (
              <HeartIcon key={i} className={`ap-heart ${i < s.lives ? "" : "ap-lost"} ${i === s.lives && s.mistakes > 0 ? "ap-pop" : ""}`} />
            ))}
          </div>
          <div className="ap-count"><ArrowIcon className="ap-count-ico" /> {s.remaining}</div>
        </div>
      </div>

      {s.tutorial && <div className="ap-tutorial">{s.tutorial}</div>}

      <div className="ap-bottom">
        <div className="ap-tool">
          <Btn variant="icon" className="ap-big" label="Hint" onClick={() => game.useHint()}><BulbIcon /></Btn>
          <span className="ap-badge">{s.hints}</span>
          <span className="ap-tool-label">HINT</span>
        </div>
        <div className="ap-tool" style={{ visibility: s.zoomedIn ? "visible" : "hidden" }}>
          <Btn variant="icon" label="Fit board to screen" onClick={() => game.board.resetView()}><FitIcon /></Btn>
          <span className="ap-tool-label">VIEW</span>
        </div>
        <div className="ap-tool">
          <Btn variant="icon" className="ap-big" label="Restart level" onClick={() => game.restartLevel()}><RestartIcon /></Btn>
          <span className="ap-tool-label">RESET</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ win / lose

export function Win() {
  const s = useUi();
  const w = s.win;
  useEffect(() => {
    if (!w) return;
    const timers = Array.from({ length: w.stars }, (_, i) => setTimeout(() => Sfx.play("star", 0.8, 1 + i * 0.12), (0.25 + i * 0.22) * 1000));
    return () => timers.forEach(clearTimeout);
  }, [w]);
  if (!w) return null;
  return (
    <div className="ap-screen ap-modal ap-fade">
      <div className="ap-card">
        <h2 className="ap-card-title" style={{ color: "var(--accent)" }}>SECTOR CLEARED</h2>
        <p className="ap-dim-text">LEVEL {s.levelNumber}</p>
        <div className="ap-stars">
          {[0, 1, 2].map((i) => (
            <StarIcon key={i} className={`ap-star ${i === 1 ? "ap-star-mid" : ""} ${i < w.stars ? "ap-star-on" : ""}`} style={{ animationDelay: `${0.25 + i * 0.22}s` }} />
          ))}
        </div>
        <p className="ap-stats">TIME&nbsp; {formatTime(w.time)} &nbsp;&nbsp;&nbsp;&nbsp; MISTAKES&nbsp; {w.mistakes}</p>
        <p className="ap-love-note">{loveNote(s.levelNumber)}</p>
        {w.bonusHint && <p className="ap-bonus">+1 HINT UNLOCKED</p>}
        <Btn variant="primary" className="ap-wide" onClick={() => game.nextLevel()}>NEXT LEVEL <ForwardIcon className="ap-ico" /></Btn>
        <div className="ap-row">
          <Btn onClick={() => game.restartLevel()}>REPLAY</Btn>
          <Btn onClick={() => game.goToMenu()}>MENU</Btn>
        </div>
      </div>
    </div>
  );
}

export function Lose() {
  const s = useUi();
  return (
    <div className="ap-screen ap-modal ap-fade">
      <div className="ap-card">
        <h2 className="ap-card-title" style={{ color: "var(--danger)" }}>SYSTEM FAILURE</h2>
        <p className="ap-dim-text">ALL LIVES LOST</p>
        <HeartIcon className="ap-lose-heart" />
        {s.canContinue && (
          <Btn variant="primary" className="ap-wide" onClick={() => game.continueWithExtraLife()}><HeartIcon className="ap-ico" /> CONTINUE +1 LIFE</Btn>
        )}
        <Btn className="ap-wide" onClick={() => game.restartLevel()}><RestartIcon className="ap-ico" /> RETRY</Btn>
        <Btn onClick={() => game.goToMenu()}>MENU</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ level select

export function Levels() {
  const s = useUi();
  void s.saveVersion;
  const unlocked = Save.unlockedLevel;
  const maxPage = Math.max(0, Math.floor((unlocked - 1) / LEVELS_PER_PAGE) + 1);
  const [page, setPage] = useState(() => Math.floor((Save.currentLevel - 1) / LEVELS_PER_PAGE));
  const p = Math.min(Math.max(page, 0), maxPage);
  const first = p * LEVELS_PER_PAGE + 1;
  const pad = (n: number) => n.toString().padStart(3, "0");

  return (
    <div className="ap-screen ap-levels ap-fade">
      <Btn variant="icon" className="ap-corner-l" label="Back" onClick={() => ui.set({ overlay: null })}><BackIcon /></Btn>
      <h2 className="ap-levels-title">SECTORS</h2>
      <div className="ap-level-grid">
        {Array.from({ length: LEVELS_PER_PAGE }, (_, i) => {
          const level = first + i;
          const locked = level > unlocked;
          const stars = Save.stars(level);
          return (
            <button
              type="button"
              key={level}
              className={`ap-btn ap-btn-outline ap-level-cell ${level === Save.currentLevel ? "ap-current" : ""}`}
              disabled={locked}
              onClick={click(() => { ui.set({ overlay: null }); game.playLevel(level); })}
            >
              {locked ? <LockIcon className="ap-lock" /> : (
                <>
                  <span className="ap-level-num">{level}</span>
                  <span className="ap-cell-stars">{[0, 1, 2].map((k) => <StarIcon key={k} className={k < stars ? "ap-star-on" : ""} />)}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="ap-pager">
        <Btn variant="icon" label="Previous page" onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0}><BackIcon /></Btn>
        <span>{pad(first)} - {pad(first + LEVELS_PER_PAGE - 1)}</span>
        <Btn variant="icon" label="Next page" onClick={() => setPage(Math.min(maxPage, p + 1))} disabled={p >= maxPage}><ForwardIcon /></Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings

export function Settings() {
  const s = useUi();
  const t = getTheme(s.themeIndex);
  const [, force] = useState(0);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const toggle = (label: string, on: boolean, flip: () => void) => (
    <div className="ap-setting">
      <span>{label}</span>
      <Btn variant={on ? "primary" : "outline"} className="ap-toggle" onClick={() => { flip(); force((n) => n + 1); }}>{on ? "ON" : "OFF"}</Btn>
    </div>
  );

  return (
    <div className="ap-screen ap-modal ap-fade">
      <div className="ap-card ap-settings">
        <h2 className="ap-card-title" style={{ color: "var(--accent)" }}>SETTINGS</h2>
        {toggle("SOUND FX", Save.sound, () => { Save.sound = !Save.sound; })}
        {toggle("MUSIC", Save.music, () => { Save.music = !Save.music; Sfx.applySettings(); })}
        {"vibrate" in navigator && toggle("HAPTICS", Save.haptics, () => { Save.haptics = !Save.haptics; })}
        <div className="ap-setting">
          <span>THEME</span>
          <div className="ap-theme-pick">
            <Btn variant="icon" label="Previous theme" onClick={() => game.setTheme(s.themeIndex - 1 + THEMES.length)}><BackIcon /></Btn>
            <div className="ap-theme-name">
              <span style={{ color: t.accent }}>{t.name}</span>
              <span className="ap-swatches">{t.arrows.map((c) => <i key={c} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />)}</span>
            </div>
            <Btn variant="icon" label="Next theme" onClick={() => game.setTheme(s.themeIndex + 1)}><ForwardIcon /></Btn>
          </div>
        </div>
        <Btn variant="danger" className="ap-wide" onClick={() => {
          if (armed) { setArmed(false); ui.set({ overlay: null }); game.resetProgress(); } else setArmed(true);
        }}>{armed ? "TAP AGAIN TO CONFIRM" : "RESET PROGRESS"}</Btn>
        <Btn variant="primary" onClick={() => ui.set({ overlay: null })}>DONE</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toast

export function Toast() {
  const { toast } = useUi();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), toast.duration * 1000);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return <div className={`ap-toast ${visible ? "ap-toast-on" : ""}`} key={toast.id}>{toast.text}</div>;
}
