# Porting a Unity NeonArcade game to the web kit

The web kit (`src/kit`) is a Unity-style runtime: the C# game ports **line by line** into TypeScript. Keep the
original's structure, names, numbers, art functions, sounds and texts. Do not redesign or simplify gameplay. A
faithful port is the goal; small improvements are welcome only where the web needs them (e.g. mouse hover).

Reference port: `src/games/slide2048/Slide2048Game.ts` (from `NeonArcade/Slide2048/Scripts/Slide2048Game.cs`).
Read it first, side by side with the C#.

## Files for a game `<Name>` (folder id = lowercase, e.g. `bladetoss`)

```
src/games/<id>/<Name>Game.ts     the ArcadeGame subclass (from <Name>Game.cs)
src/games/<id>/<Name>Art.ts      procedural art (from <Name>Art.cs), if the game has one
src/games/<id>/index.tsx         const create = () => new <Name>Game(); export default () => <GameHost create={create} />
```

Do **not** edit `src/kit/*`, `src/games.ts`, `src/App.tsx` or other games. If the kit lacks something, implement it
locally in your game folder and list it in your report (the kit owner will fold it in).

## Check your work

```bash
./scripts/tc-game.sh <id>                                   # typecheck kit + your game only
NODE_PATH=$(npm root -g) node scripts/smoke.cjs <id> <outDir> 10   # needs the dev server on :5173
```
The dev server is already running at http://localhost:5173 (if not: `npx vite --port 5173 --strictPort` in the
background). Open `#/dev/<id>` to load your game. **Look at the screenshots** (Read the PNGs): title, playing, mid
and end on phone + desktop. Fix anything that looks wrong compared with what the C# draws. Play it properly with a
Playwright script of your own when random input can't reach the interesting states (win, lose, level complete,
result screen, rewarded continue, pause/resume).

## Conventions

| C# (Unity / NeonArcade) | TypeScript (kit) |
|---|---|
| `class XGame : ArcadeGame` | `export class XGame extends ArcadeGame` |
| `protected override GameInfo Describe() => new GameInfo { ... }` | `protected Describe() { return new GameInfo({ Id: ..., HowTo: [howTo(icon, color, text)], Music: { bpm, rootHz, degrees, seed, energy, major } }) }` |
| ArcadeGame hooks/members (`Build`, `BeginRun`, `TickRun`, `Finish`, `Revive`, `UI`, `Fx`, `Back`, `Data`, `Controls`, `ViewSize`, `PlayRect`, `FitShortSide`, `State`, `Phase.Playing`, `Hitstop`, `SlowMo`, `RunTime`) | same names, PascalCase; `protected get ShortSide()` / `protected get AimOrigin()` are getters |
| `UI.Hint/Announce/Float/Toast/ShowChoices/SetPauseButton/Hud/TitleExtra/ScreenToHud` | same (PascalCase). `UI.WorldToHud(world)` is a helper |
| `new Result { Headline = ..., Stats = new[] { ("A", "1") } }` | `new Result({ Headline: ..., Stats: [["A", "1"]] })` |
| `Data.Get/Set/Add/Max/Min/Flush` | `this.Data.get/set/add/max/min` (camelCase) |
| `Vector2/Vector3/Color` structs | `V2/V3/Color`, **immutable**: `v = v.withX(3)`, `v = v.add(o)`, `c = c.withAlpha(0.5)`. `a + b` → `a.add(b)`, `a * k` → `a.mul(k)`, `-v` → `v.neg()`, `color * k` → `color.mul(k)` (includes alpha, like Unity) |
| `Vector2Int` | `V2i` (use `.equals()`, never `===`; `.key` for maps) |
| `new Vector2(x, y)` / `Vector2.zero/up/right` | `new V2(x, y)` / `V2.zero/up/right` |
| `Vector2.Lerp/Distance/Dot/MoveTowards/ClampMagnitude/SignedAngle/Perpendicular/Reflect` | `V2.lerp/distance/dot/moveTowards/clampMagnitude/signedAngle/perpendicular/reflect` |
| `Mathf.X` | `Mathf.x` camelCase (`Mathf.clamp01`, `Mathf.lerp`, `Mathf.moveTowards`, `Mathf.perlinNoise`, `Mathf.roundToInt` (banker's rounding like C#), `Mathf.smoothStep`, `Mathf.repeat`, `Mathf.pingPong`, `Mathf.deltaAngle`, `Mathf.smoothDamp(cur, target, {v}, time, dt)`) |
| `Random.Range(float, float)` | `Random.range(a, b)` |
| `Random.Range(int, int)` (max exclusive!) | `Random.rangeInt(a, b)` |
| `Random.value / insideUnitCircle / onUnitCircle` | same, camelCase |
| `System.Random rng; rng.Next(n); rng.NextDouble()` | `SysRandom`: `rng.next(n)`, `rng.next(a, b)`, `rng.nextDouble()` |
| `Pal.Hex(0x...)`, `Pal.Cyan`, `.WithAlpha(a)` | `Pal.hex(0x...)`, `Pal.Cyan`, `.withAlpha(a)` |
| `Ease.OutCubic`, `Fmt.N(v)`, `Fmt.Clock` | `Ease.outCubic`, `Fmt.n(v)`, `Fmt.clock` |
| `new GameObject("x").transform` / `transform.SetParent(p, false)` | `new GameObject("x", parent)` (GameObject **is** the transform: `go.transform === go`) |
| `t.localPosition = new Vector3(...)`, `localScale`, `localRotation = Quaternion.Euler(0,0,a)`, `position`, `rotation`, `eulerAngles`, `right`, `up` | same names camelCase; also `localEulerZ` (degrees). `Quaternion.euler(0,0,a)`, `q.rotate(v)` for `q * v` |
| `go.SetActive(b)`, `activeSelf`, `Destroy(go)` | `go.setActive(b)`, `go.activeSelf`, `go.destroy()` (or `destroy(x)`) |
| `Art.Spr(parent, name, sprite, color, size, order, mat)` | `Art.spr(...)` → `SpriteRenderer` (`.sprite .color .material .sortingOrder .flipX .enabled .transform .gameObject`) |
| `Art.Line(...)` / `LineRenderer` | `Art.line(...)` → `LineRenderer` (`positionCount`, `setPosition(i, p)`, `setPositions`, `startColor/endColor`, `widthMultiplier`, `startWidth/endWidth`, `loop`) |
| `Art.MeshObject(parent, name, mesh, mat, order)` + `Mesh` | `Art.meshObject(...)` → `MeshRenderer`; `Mesh` with `vertices/triangles/colors` arrays; call `mesh.markDirty()` after editing in place |
| `TextMesh` | `TextMesh` renderer (`text`, `fontSize`, `characterSize`, `color`, `anchor`) |
| `Art.Disc/Glow/Ring/...` sprites, `Art.Additive/Solid/Flat/LineMat` materials | `Art.Disc/Glow/Ring/...`, `Art.Additive/Solid/Flat/LineMat` |
| `Art.Shape(key, p => alpha)` | `Art.shape(key, (p) => alpha, size?, ppu?, border?)` |
| `CasualArt.Make(key, w, h, p => Color, border, ppu)` | `CasualArt.make(key, w, h, (p) => Color, border, ppu)` (border: number or `[l, b, r, t]`) |
| `CasualArt.Fill/SdBox/SdCircle/SdSegment/Over/Lighten/Darken/Smooth/Ball/Gradient/Panel/Soft/Dot/StarShape` | camelCase: `CasualArt.fill/sdBox/...`, getters `CasualArt.Soft/Dot/StarShape` |
| `CasualLook.Calm/Cover/FitCover/TitleCard/Fit` | `CasualLook.calm/cover/fitCover/titleCard/fit` |
| `CasualFx.Create(...)`, `fx.Pop/Confetti/Sparkle/Emit/Clear` | `CasualFx.create(...)`, `fx.pop/confetti/sparkle/emit/clear` |
| `Fx.Shake/Kick/Burst/Spray/Ring/ClearParticles`, `Fx.CameraTarget`, `Fx.Haptic(strong)` | `this.Fx.shake/kick/burst/spray/ring/clearParticles`, `this.Fx.CameraTarget`, `Fx.haptic(strong)` (static) |
| `Back.SetDanger/Flash` | `this.Back.setDanger(x)`, `this.Back.Flash(color, amount)` |
| `Sfx.Play(Snd.Coin, vol, pitch)`, `Sfx.PlayClip(clip, vol, pitch)`, `Sfx.Make(name, secs, t => ...)`, `Sfx.SinP/SawP/SqrP/TriP/Glide/Env`, `Sfx.SetIntensity`, `Sfx.Duck`, `Sfx.I.CreateLoop(clip)` / `AudioSource` volume+pitch | `Sfx.play/playClip/make/sinP/sawP/sqrP/triP/glide/env/setIntensity/duck`, `Sfx.createLoop(clip)` → `LoopSource` (set `.volume`, `.pitch` each frame) |
| `UIKit.Node/Img/Label/Button/ButtonAt/Layer/Dim/Card/Meter/SetMeter` | `UIKit.node/img/label/button/buttonAt/layer/dim/card/meter/setMeter` (`meter` returns `[node, fillImage]`) |
| extension methods `rt.Place(a, p, s)`, `rt.Stretch(i)`, `text.At(...)`, `text.Wrap()`, `text.Glow(c, d)` | `node.place(...)`, `node.stretch(i)`, `UIKit.at(text, ...)`, `UIKit.wrap(text)`, `UIKit.glow(text, c, d)` |
| `RectTransform` (`anchoredPosition`, `sizeDelta`, `anchorMin/Max`, `pivot`, `offsetMin/Max`, `rect`, `localScale`, `SetAsFirstSibling`, `Find`, `GetChild`, `childCount`) | `UINode` with the same members in camelCase. `img.rectTransform`, `text.rectTransform`, `button.node` |
| `Image` (`color`, `sprite`, `enabled`, `fillAmount`, `type = Filled`, `raycastTarget`, `pixelsPerUnitMultiplier`) | `Image` same names camelCase; `ImageType.Filled` + `fillMethod` |
| `Text` (`text`, `fontSize`, `color`, `alignment = TextAnchor.X`, `fontStyle`) | `Text` same; rich text `<color=#hex>`, `<size=n>`, `<b>` supported |
| `ArcadeButton` (`OnClick`, `Label`, `Interactable`, `Held`, `SetAccent`, `Press`) | `ArcadeButton` (`onClick`, `label`, `interactable`, `held`, `setAccent`, `press`) |
| `CanvasGroup` (`alpha`, `blocksRaycasts`, `interactable`) | `new CanvasGroup(node)` |
| `CasualUI.Booster/UseOrEarn/SetText`, `LevelPath` | `CasualUI.booster/useOrEarn/setText`, `LevelPath` (`refresh(data, level)`) |
| `AdService.RewardedAvailable`, `AdService.ShowRewarded(cb)` | `AdService.rewardedAvailable`, `AdService.showRewarded(cb)` |
| `Keyboard.current.xKey.wasPressedThisFrame` | `Keyboard.letter("x").wasPressedThisFrame`; arrows `Keyboard.left/right/up/down`, `Keyboard.space/enter/escape`, `Keyboard.digit(n)`, `Keyboard.typed` (chars this frame) |
| `Mouse.current`, `Touchscreen.current`, `Gamepad.current` | `Mouse`, `Touchscreen`, `Gamepad` objects (`Mouse.position`, `Mouse.leftButton.isPressed`, `Mouse.scroll`) |
| `Controls.Move/Aim/Fire/Steer/Tapped/TapScreen/...` | `this.Controls.move/aim/fire/steer/tapped/tapScreen/...` (camelCase) |
| `TapPointer` (`Down/Held/Up/Tap/Screen/StartScreen/HeldTime/TopBand`, `Dp`) | `TapPointer` (`down/held/up/tap/screen/startScreen/heldTime/topBand`, `TapPointer.dp`) |
| `Screen.width/height/dpi/safeArea` | `Screen.width/height/dpi/safeArea` (device px, y up like Unity) |
| `ScreenToWorld(screen)`, `Cam.ScreenToWorldPoint` | `this.ScreenToWorld(screen)` |
| `Grid2D` | `Grid2D` (camelCase methods, `Grid2D.Dirs4`) |
| `Time.deltaTime/unscaledDeltaTime/time/timeScale` | `Time.deltaTime/...` |
| coroutines `IEnumerator X() { yield return new WaitForSeconds(t); }` + `StartCoroutine` | generator `*X() { yield wait(t); }` / `waitReal(t)`; `this.startCoroutine(this.X())` |
| `List<T>` / `Dictionary<K,V>` / `HashSet<T>` | arrays / `Map` / `Set`. `list.RemoveAt(i)` → `splice(i, 1)` |
| `int` division `a / b` | `Math.trunc(a / b)` (or `Math.floor` for non-negative); `%` on negatives behaves like C# |
| `float.MaxValue` | `Number.MAX_VALUE` |
| `out` / `ref` params | return a tuple or object |

### Coordinates and units
World units, y up, degrees counter-clockwise: exactly like Unity. UI is in canvas units (1080 along the short side),
y up, anchored like uGUI. Screen points are device pixels with y up (Unity convention).

### Things to watch
- **Value semantics**: C# code that mutates a struct copy (`var p = pos; p.x += 1;`) must become `p = p.withX(p.x + 1)`.
- **Integer math**: C# `int` division truncates; `(int)x` truncates; `Mathf.FloorToInt` floors.
- **Static sprites**: C# `static Sprite X => CasualArt.Make(...)` becomes a function or getter; `CasualArt.make` caches by key, so calling it repeatedly is cheap.
- **`OnLayoutChanged`** runs on resize; `Build()` runs once. Lay out after `Build` too if the C# relies on `Layout()` being called from `BeginRun`.
- **Per-frame allocations** are fine at this scale; avoid creating Phaser objects per frame (pool like the C# does).
- Keep comments short and only where the C# has them.

## Report back
1. Files created, and which C# files they come from.
2. Typecheck + smoke results; what you verified by looking at screenshots / scripted play.
3. Kit gaps you worked around locally (with the local code location), and anything you could not port faithfully.
