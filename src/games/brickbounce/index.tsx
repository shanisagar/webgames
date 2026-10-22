import { GameHost } from "../../kit";
import { BrickBounceGame } from "./BrickBounceGame";

const create = () => new BrickBounceGame();
export default function BrickBounce() { return <GameHost create={create} />; }
