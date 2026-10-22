import { GameHost } from "../../kit";
import { DashRushGame } from "./DashRushGame";

const create = () => new DashRushGame();
export default function DashRush() { return <GameHost create={create} />; }
