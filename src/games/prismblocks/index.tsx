import { GameHost } from "../../kit";
import { PrismBlocksGame } from "./PrismBlocksGame";

const create = () => new PrismBlocksGame();
export default function PrismBlocks() { return <GameHost create={create} />; }
