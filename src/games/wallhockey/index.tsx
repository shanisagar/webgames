import { GameHost } from "../../kit";
import { HockeyWallGame } from "./HockeyWallGame";

const create = () => new HockeyWallGame();
export default function WallHockey() { return <GameHost create={create} />; }
