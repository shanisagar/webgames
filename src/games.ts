import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface GameEntry {
  id: string;
  name: string;
  tagline: string;
  genre: string;
  image: string;
  description: string;
  /** Code-split: a game's code (and Phaser) only downloads when it is opened. */
  component: LazyExoticComponent<ComponentType>;
}

/** Newest first. Each game lives in src/games/<id>/ and is reachable at #/<id>. */
export const GAMES: GameEntry[] = [
  {
    id: "arrowpuzzle",
    name: "Arrow Puzzle",
    tagline: "Tap. Launch. Clear the grid.",
    genre: "Puzzle",
    image: "img/ArrowPuzzle.webp",
    description:
      "Minimal neon logic puzzle where each arrow flies off the board only if its path is clear. 100 hand-tuned levels, then endless generated ones that are always solvable.",
    component: lazy(() => import("./games/arrowpuzzle/ui/ArrowPuzzle")),
  },
];
