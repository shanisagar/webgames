import { GameHost } from "../../kit";
import { HoleHungryGame } from "./HoleHungryGame";

const create = () => new HoleHungryGame();
export default function HoleHungry() { return <GameHost create={create} />; }
