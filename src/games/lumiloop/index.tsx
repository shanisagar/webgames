import { type ArcadeGame, GameHost } from "../../kit";
import { LumiloopGame } from "./LumiloopGame";

// Lumiloop runs its own small framework rather than ArcadeGame; the host only calls boot() and onFocusLost().
const create = () => new LumiloopGame() as unknown as ArcadeGame;
export default function Lumiloop() { return <GameHost create={create} />; }
