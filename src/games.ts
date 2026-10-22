import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface GameEntry {
  id: string;
  name: string;
  tagline: string;
  genre: string;
  /** Square store icon (256px). */
  icon: string;
  /** Wide feature graphic (1024x500) for the showcase hero, when the game has one. */
  feature?: string;
  description: string;
  /** Code-split: a game's code (and Phaser) only downloads when it is opened. */
  component: LazyExoticComponent<ComponentType>;
}

/** Newest first. Each game lives in src/games/<id>/ and is reachable at #/<id>. */
export const GAMES: GameEntry[] = [
  {
    id: "tilegarden",
    name: "Tile Garden",
    tagline: "Tap three alike. Clear the garden.",
    genre: "Puzzle",
    icon: "img/icons/tilegarden.webp",
    feature: "img/features/tilegarden.webp",
    description: "A calm tile-matching puzzle: pick free tiles into the tray, match three alike to clear them, and empty every garden without filling the tray.",
    component: lazy(() => import("./games/tilegarden")),
  },
  {
    id: "sudokuzen",
    name: "Sudoku Zen",
    tagline: "Classic sudoku, calm and clean.",
    genre: "Board",
    icon: "img/icons/sudokuzen.webp",
    feature: "img/features/sudokuzen.webp",
    description: "Unlimited sudoku puzzles with a unique solution from Easy to Expert, with pencil notes, hints, undo and a three-mistake rule.",
    component: lazy(() => import("./games/sudokuzen")),
  },
  {
    id: "fourup",
    name: "Four Up",
    tagline: "Drop discs. Connect four.",
    genre: "Board",
    icon: "img/icons/fourup.webp",
    description: "The classic connect-four duel against a smart CPU with three difficulty levels, hints and winning streaks.",
    component: lazy(() => import("./games/fourup")),
  },
  {
    id: "fruitfusion",
    name: "Fruit Fusion",
    tagline: "Drop. Merge. Grow a watermelon!",
    genre: "Puzzle",
    icon: "img/icons/fruitfusion.webp",
    feature: "img/features/fruitfusion.webp",
    description: "Drop fruit into the jar and merge matching pairs into bigger fruit, all the way up to the watermelon, before the jar overflows.",
    component: lazy(() => import("./games/fruitfusion")),
  },
  {
    id: "prismblocks",
    name: "Prism Blocks",
    tagline: "Drag. Drop. Shatter the lines.",
    genre: "Puzzle",
    icon: "img/icons/prismblocks.webp",
    feature: "img/features/prismblocks.webp",
    description: "Drag glowing blocks onto the 8x8 board and fill rows and columns to shatter them. Chain clears for combos and keep the board alive.",
    component: lazy(() => import("./games/prismblocks")),
  },
  {
    id: "linklines",
    name: "Link Lines",
    tagline: "Connect the dots. Fill the board.",
    genre: "Puzzle",
    icon: "img/icons/linklines.webp",
    description: "Link every pair of matching dots with pipes that never cross, and fill the whole board. Endless levels from 5x5 upwards.",
    component: lazy(() => import("./games/linklines")),
  },
  {
    id: "slide2048",
    name: "Slide 2048",
    tagline: "Swipe. Merge. Reach 2048!",
    genre: "Puzzle",
    icon: "img/icons/slide2048.webp",
    description: "The classic number-sliding puzzle: swipe to slide every tile, merge equal numbers and chase the 2048 tile.",
    component: lazy(() => import("./games/slide2048")),
  },
  {
    id: "arrowpuzzle",
    name: "Arrow Puzzle",
    tagline: "Tap. Launch. Clear the grid.",
    genre: "Puzzle",
    icon: "img/icons/arrowpuzzle.webp",
    feature: "img/features/arrowpuzzle.webp",
    description:
      "Minimal neon logic puzzle where each arrow flies off the board only if its path is clear. 100 hand-tuned levels, then endless generated ones that are always solvable.",
    component: lazy(() => import("./games/arrowpuzzle/ui/ArrowPuzzle")),
  },
];
