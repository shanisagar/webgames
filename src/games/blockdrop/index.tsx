import { GameHost } from "../../kit";
import { BlockDropGame } from "./BlockDropGame";

const create = () => new BlockDropGame();
export default function BlockDrop() { return <GameHost create={create} />; }
