import { GameHost } from "../../kit";
import { WallBlocksGame } from "./WallBlocksGame";

const create = () => new WallBlocksGame();
export default function WallBlocks() { return <GameHost create={create} />; }
