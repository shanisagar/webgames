import { GameHost } from "../../kit";
import { MelodyTilesGame } from "./MelodyTilesGame";

const create = () => new MelodyTilesGame();
export default function MelodyTiles() { return <GameHost create={create} />; }
