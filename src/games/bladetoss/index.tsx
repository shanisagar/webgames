import { GameHost } from "../../kit";
import { BladeTossGame } from "./BladeTossGame";

const create = () => new BladeTossGame();
export default function BladeToss() { return <GameHost create={create} />; }
