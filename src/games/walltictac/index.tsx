import { GameHost } from "../../kit";
import { WallTicTacGame } from "./WallTicTacGame";

const create = () => new WallTicTacGame();
export default function WallTicTac() { return <GameHost create={create} />; }
