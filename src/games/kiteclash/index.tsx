import { GameHost } from "../../kit";
import { KiteClashGame } from "./KiteClashGame";

const create = () => new KiteClashGame();
export default function KiteClash() { return <GameHost create={create} />; }
