// No imports: the site shell uses this without pulling the game engine into its first download.

/**
 * Leaving the game for the site's game list. The site sets `home` while a game is open; the shell then shows ALL GAMES
 * on the title screen and in the pause menu, and tags the page so the site hides its own floating back button
 * (which would overlap game HUDs).
 */
export const GameNav = {
  home: null as (() => void) | null,
  /** For games without the shell: hides the site's back button while a round is being played. */
  setPlaying(on: boolean) { document.body.classList.toggle("na-playing", on); },
};
