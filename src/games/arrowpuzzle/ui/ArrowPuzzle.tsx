import Phaser from "phaser";
import { useEffect, useRef, type CSSProperties } from "react";
import { Background } from "../game/background";
import { BoardScene } from "../game/BoardScene";
import { game } from "../game/controller";
import { GameNav } from "../../../kit/shell";
import { Sfx } from "../game/sfx";
import { useUi } from "../game/store";
import { getTheme } from "../game/theme";
import { Hud, Levels, Lose, Menu, Settings, Toast, Win } from "./Screens";
import "./arrowpuzzle.css";

/** Arrow Puzzle: Phaser draws the board, React draws every screen on top of it. */
export default function ArrowPuzzle() {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const s = useUi();
  const t = getTheme(s.themeIndex);

  useEffect(() => {
    const host = boardRef.current!;
    const background = new Background(bgRef.current!);
    background.applyTheme(game.theme);

    const mistakePulse = () => {
      const v = vignetteRef.current;
      if (!v) return;
      v.classList.remove("ap-hit");
      void v.offsetWidth;
      v.classList.add("ap-hit");
    };
    const scene = new BoardScene(game, background, mistakePulse);

    // Render at device resolution (capped at 2x) so the neon lines stay sharp on phones.
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const size = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });
    const { w, h } = size();
    const phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: Math.round(w * dpr()),
      height: Math.round(h * dpr()),
      transparent: true,
      antialias: true,
      banner: false,
      disableContextMenu: true,
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr() },
      render: { powerPreference: "high-performance" },
      fps: { target: 60 },
      scene,
    });

    const ro = new ResizeObserver(() => {
      const { w, h } = size();
      phaser.scale.resize(Math.round(w * dpr()), Math.round(h * dpr()));
      phaser.scale.setZoom(1 / dpr());
    });
    ro.observe(host);

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") game.back(); };
    const onVisibility = () => Sfx.setSuspended(document.hidden);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      phaser.destroy(true);
    };
  }, []);

  useEffect(() => { GameNav.setPlaying(s.screen === "hud"); }, [s.screen]);
  useEffect(() => () => GameNav.setPlaying(false), []);

  const vars = {
    "--accent": t.accent, "--accent2": t.accent2, "--danger": t.danger, "--success": t.success,
    "--text": t.text, "--text-dim": t.textDim, "--panel": t.panel, "--bg": t.bgBottom,
  } as CSSProperties;

  return (
    <div className="ap-root" style={vars} onPointerDown={() => Sfx.unlock()}>
      <canvas className="ap-bg" ref={bgRef} />
      <div className="ap-board" ref={boardRef} />
      <div className="ap-vignette" ref={vignetteRef} />
      {s.screen === "menu" && <Menu />}
      {s.screen === "hud" && <Hud />}
      {s.screen === "win" && <Win />}
      {s.screen === "lose" && <Lose />}
      {s.overlay === "levels" && <Levels />}
      {s.overlay === "settings" && <Settings />}
      <Toast />
    </div>
  );
}
