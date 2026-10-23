import { GameHost } from "../../kit";
import { DuckGame } from "./DuckGame";

const create = () => new DuckGame();
export default function DuckShoot() { return <GameHost create={create} />; }
