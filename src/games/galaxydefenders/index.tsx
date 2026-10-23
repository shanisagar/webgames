import { GameHost } from "../../kit";
import { GalaxyDefendersGame } from "./GalaxyDefendersGame";

const create = () => new GalaxyDefendersGame();
export default function GalaxyDefenders() { return <GameHost create={create} />; }
