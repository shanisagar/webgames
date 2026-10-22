import { GameHost } from "../../kit";
import { LinkLinesGame } from "./LinkLinesGame";

const create = () => new LinkLinesGame();
export default function LinkLines() { return <GameHost create={create} />; }
