# Web games by Shani Sagar

Browser-native versions of my Unity games, built with **React** (menus and screens) and **Phaser 3** (the game board).
Each game is a few hundred KB instead of the ~17 MB Unity WebGL build, starts in about a second and uses far less memory.

Live (after the first deploy): https://shanisagar.github.io/webgames/ · Arrow Puzzle: https://shanisagar.github.io/webgames/#/arrowpuzzle

| | Unity WebGL | This version |
|---|---|---|
| Download (Arrow Puzzle) | ~17 MB | ~410 KB gzipped (Phaser included) |
| Engine | Unity + WebAssembly | Phaser 3 (WebGL, canvas fallback) |

## Games
- **Arrow Puzzle** (`src/games/arrowpuzzle`): a line-by-line port of the Unity project. Same rules, the same 100
  hand-tuned levels (exported from `LevelDatabase.asset`), the same procedural generator for endless levels after that,
  5 themes, synthesized sound effects and music, hints, lives, stars, level select, love notes.

## Develop
```bash
npm install
npm run dev        # http://localhost:5173/#/arrowpuzzle
npm test           # checks all 100 levels + 60 generated ones are solvable
npm run build      # production build in dist/
```

## Layout
```
src/
  App.tsx, games.ts              games list + hash routing (#/<id>); each game is code-split
  games/arrowpuzzle/
    core/                        pure game logic: rules, solver, shapes, generator, levels.json
    game/                        controller, Phaser board scene, background shader, sound, save, themes
    ui/                          React screens (menu, HUD, win, lose, level select, settings)
```

## Add a game
1. Put it in `src/games/<id>/` with a default-exported React component.
2. Add an entry to `src/games.ts` and its feature graphic to `public/img/`.

## Deploy
Pushing to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`).
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
