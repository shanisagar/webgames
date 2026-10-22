import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { ArcadeGame } from "./arcadegame";
import { Art, reRegisterTextures } from "./art";
import { InputSystem, Screen } from "./input";
import { Rect } from "./math";
import { Camera, PostFX, Render } from "./render";
import { GameObject, Scene, Time } from "./scene";
import { Sfx } from "./sfx";
import { uiFont } from "./theme";
import { UI, UINode, UITicks } from "./ui";
import "./kit.css";

/**
 * Mounts one ported game: a Phaser canvas for the world, a DOM canvas for the UI, and the Unity-style player loop
 * (Update → coroutines → LateUpdate → UI ticks → render sync) driven by Phaser's frame.
 */
export function GameHost({ create }: { create: () => ArcadeGame }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const boardEl = host.querySelector<HTMLDivElement>(".na-board")!;
    const canvasEl = host.querySelector<HTMLDivElement>(".na-canvas")!;
    const probe = host.querySelector<HTMLDivElement>(".na-safe-probe")!;
    canvasEl.style.setProperty("--na-font", uiFont());

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });

    // UI root: 1080 canvas units along the short side.
    const root = new UINode("Canvas", null, canvasEl);
    UI.root = root;

    const layout = () => {
      const { w, h } = cssSize(), d = dpr();
      Screen.dpr = d;
      Screen.width = Math.round(w * d);
      Screen.height = Math.round(h * d);
      Camera.pixelWidth = Screen.width;
      Camera.pixelHeight = Screen.height;
      Camera.dpr = d;
      // safe area from CSS env() insets (Unity rect: device px, y up)
      const hb = host.getBoundingClientRect(), pb = probe.getBoundingClientRect();
      const left = Math.max(0, pb.left - hb.left), right = Math.max(0, hb.right - pb.right);
      const top = Math.max(0, pb.top - hb.top), bottom = Math.max(0, hb.bottom - pb.bottom);
      Screen.safeArea = new Rect(left * d, bottom * d, (w - left - right) * d, (h - top - bottom) * d);
      const portrait = h >= w;
      const k = portrait ? w / 1080 : h / 1080; // CSS px per canvas unit
      UI.cssScale = k;
      canvasEl.style.width = w / k + "px";
      canvasEl.style.height = h / k + "px";
      canvasEl.style.transform = `scale(${k})`;
      root.setRootSize(w / k, h / k);
    };
    layout();

    let game: ArcadeGame | null = null;
    let disposed = false;
    let last = 0;
    const start = performance.now();

    class LoopScene extends Phaser.Scene {
      constructor() { super("na-loop"); }
      create() {
        if (disposed) return; // torn down before Phaser finished booting
        Render.scene = this;
        reRegisterTextures();
        Art.makeBaseTextures();
        InputSystem.attach(host);
        const go = new GameObject("Game");
        game = go.addComponent(create());
        game.boot();
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__na = { Render, Camera, Scene, game, phaser: this.game };
      }
      update() {
        if (disposed || !game) return;
        const now = performance.now();
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
        last = now;
        Time.unscaledDeltaTime = dt;
        Time.deltaTime = dt * Time.timeScale;
        Time.unscaledTime += dt;
        Time.time += Time.deltaTime;
        Time.realtimeSinceStartup = (now - start) / 1000;
        Time.frameCount++;
        InputSystem.beginFrame();
        Sfx.engine.update();
        const live = [...Scene.behaviours].filter((b) => b.enabled && b.gameObject.activeInHierarchy);
        for (const b of live) if (b.update) b.update();
        for (const b of live) b.tickRoutines();
        for (const b of live) if (b.lateUpdate && b.gameObject.activeInHierarchy) b.lateUpdate();
        for (const t of UITicks) t();
        Render.sync();
      }
    }

    const { w, h } = cssSize();
    const phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: boardEl,
      width: Math.round(w * dpr()),
      height: Math.round(h * dpr()),
      backgroundColor: "#03050f",
      antialias: true,
      banner: false,
      disableContextMenu: true,
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr() },
      render: { powerPreference: "high-performance" },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      fps: { target: 60 },
      scene: LoopScene,
    });

    // Bloom: quarter-res copy of the frame, squared (keeps bright neon, drops darks), GPU-blurred via CSS, screen-blended.
    const bloomEl = host.querySelector<HTMLCanvasElement>(".na-bloom")!;
    const vignetteEl = host.querySelector<HTMLDivElement>(".na-vignette")!;
    const bctx = bloomEl.getContext("2d")!;
    phaser.events.on("postrender", () => {
      if (disposed) return;
      const src = phaser.canvas;
      const bw = Math.max(1, Math.round(src.width / 4)), bh = Math.max(1, Math.round(src.height / 4));
      if (bloomEl.width !== bw || bloomEl.height !== bh) { bloomEl.width = bw; bloomEl.height = bh; }
      const strength = Math.min(2, PostFX.bloom);
      bloomEl.style.opacity = String(Math.min(1, strength * 0.7));
      vignetteEl.style.opacity = String(PostFX.vignette);
      if (strength < 0.02 || phaser.renderer.type !== Phaser.WEBGL) return;
      bctx.globalCompositeOperation = "copy";
      bctx.drawImage(src, 0, 0, bw, bh);
      bctx.globalCompositeOperation = "multiply";
      bctx.drawImage(bloomEl, 0, 0);
    });

    const ro = new ResizeObserver(() => {
      layout();
      phaser.scale.resize(Screen.width, Screen.height);
      phaser.scale.setZoom(1 / dpr());
    });
    ro.observe(host);

    const unlock = () => Sfx.engine.unlock();
    const onVis = () => {
      Sfx.engine.setHidden(document.hidden);
      if (document.hidden) game?.onFocusLost();
    };
    const onBlur = () => game?.onFocusLost();
    host.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);

    return () => {
      disposed = true;
      ro.disconnect();
      host.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      for (const r of [...Scene.roots]) r.destroy();
      Scene.behaviours.clear();
      Render.renderers.clear();
      UITicks.clear();
      InputSystem.detach();
      Sfx.engine.shutdown();
      Time.timeScale = 1;
      phaser.destroy(true);
      Render.scene = null;
      for (const c of [...root.children]) c.destroy(); // keep the canvas element itself (React owns it)
      canvasEl.replaceChildren();
      UI.root = null;
    };
  }, [create]);

  return (
    <div className="na-host" ref={hostRef}>
      <div className="na-board" />
      <canvas className="na-bloom" />
      <div className="na-vignette" />
      <div className="na-ui"><div className="na-canvas" /></div>
      <div className="na-safe-probe" />
    </div>
  );
}
