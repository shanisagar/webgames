import { GameHost } from "../../kit";
import { HoopShotGame } from "./HoopShotGame";

const create = () => new HoopShotGame();
export default function HoopShot() { return <GameHost create={create} />; }
