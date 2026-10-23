import { GameHost } from "../../kit";
import { DodgeGame } from "./DodgeGame";

const create = () => new DodgeGame();
export default function WallDodge() { return <GameHost create={create} />; }
