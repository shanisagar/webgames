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
    id: "bladetoss",
    name: "Blade Toss",
    tagline: "Throw. Stick. Don't hit a blade.",
    genre: "Arcade",
    icon: "img/icons/bladetoss.webp",
    feature: "img/features/bladetoss.webp",
    description: "Throw knives into the spinning log without hitting the blades already in it. Slice apples for coins, beat bosses every fifth stage and unlock new knives.",
    component: lazy(() => import("./games/bladetoss")),
  },
  {
    id: "skystack",
    name: "Sky Stack",
    tagline: "Stack the floors. Touch the stars.",
    genre: "Arcade",
    icon: "img/icons/skystack.webp",
    feature: "img/features/skystack.webp",
    description: "Drop swinging floors from the crane and stack a skyscraper through the clouds, the sunset and into space. Perfect drops build combos.",
    component: lazy(() => import("./games/skystack")),
  },
  {
    id: "hoopshot",
    name: "Hoop Shot",
    tagline: "Flick. Swish. On fire!",
    genre: "Sports",
    icon: "img/icons/hoopshot.webp",
    description: "Flick the ball to sink baskets, chain swishes to catch fire for bonus points, and keep scoring as the hoop starts to move.",
    component: lazy(() => import("./games/hoopshot")),
  },
  {
    id: "boltjam",
    name: "Bolt Jam",
    tagline: "Unscrew. Sort. Drop every plank.",
    genre: "Puzzle",
    icon: "img/icons/boltjam.webp",
    feature: "img/features/boltjam.webp",
    description: "Unscrew bolts into matching coloured tins, use the holding tray wisely and drop every plank. Hundreds of levels of satisfying screw-sorting.",
    component: lazy(() => import("./games/boltjam")),
  },
  {
    id: "hexasort",
    name: "Hexa Sort",
    tagline: "Stack. Sort. Clear the colours.",
    genre: "Puzzle",
    icon: "img/icons/hexasort.webp",
    description: "Place stacks of hexagon tiles on the board; neighbouring colours slide together and full stacks of ten clear away. Reach the goal before the board fills.",
    component: lazy(() => import("./games/hexasort")),
  },
  {
    id: "minemeadow",
    name: "Mine Meadow",
    tagline: "Dig safe. Flag the mines.",
    genre: "Puzzle",
    icon: "img/icons/minemeadow.webp",
    description: "Classic minesweeper in a sunny meadow: dig safe squares, read the numbers, flag every mine. Three board sizes and best times.",
    component: lazy(() => import("./games/minemeadow")),
  },
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
