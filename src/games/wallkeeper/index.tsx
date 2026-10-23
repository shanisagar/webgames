import { GameHost } from "../../kit";
import { KeeperGame } from "./KeeperGame";

const create = () => new KeeperGame();
export default function WallKeeper() { return <GameHost create={create} />; }
