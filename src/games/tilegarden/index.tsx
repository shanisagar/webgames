import { GameHost } from "../../kit";
import { TileGardenGame } from "./TileGardenGame";

const create = () => new TileGardenGame();
export default function TileGarden() { return <GameHost create={create} />; }
