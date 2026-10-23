import { GameHost } from "../../kit";
import { WallBombsGame } from "./WallBombsGame";

const create = () => new WallBombsGame();
export default function WallBombs() { return <GameHost create={create} />; }
