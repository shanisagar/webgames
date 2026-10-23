import { GameHost } from "../../kit";
import { DartsWallGame } from "./DartsWallGame";

const create = () => new DartsWallGame();
export default function DartsWall() { return <GameHost create={create} />; }
