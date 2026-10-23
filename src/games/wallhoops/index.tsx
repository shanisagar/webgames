import { GameHost } from "../../kit";
import { HoopShootoutGame } from "./HoopShootoutGame";

const create = () => new HoopShootoutGame();
export default function HoopShootout() { return <GameHost create={create} />; }
