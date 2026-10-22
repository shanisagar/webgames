import { GameHost } from "../../kit";
import { TowerConquestGame } from "./TowerConquestGame";

const create = () => new TowerConquestGame();
export default function TowerConquest() { return <GameHost create={create} />; }
