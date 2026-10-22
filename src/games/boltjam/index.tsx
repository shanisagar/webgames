import { GameHost } from "../../kit";
import { BoltJamGame } from "./BoltJamGame";

const create = () => new BoltJamGame();
export default function BoltJam() { return <GameHost create={create} />; }
