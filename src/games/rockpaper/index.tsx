import { GameHost } from "../../kit";
import { RockPaperGame } from "./RockPaperGame";

const create = () => new RockPaperGame();
export default function RockPaper() { return <GameHost create={create} />; }
