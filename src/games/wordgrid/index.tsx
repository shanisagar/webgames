import { GameHost } from "../../kit";
import { WordGridGame } from "./WordGridGame";

const create = () => new WordGridGame();
export default function WordGrid() { return <GameHost create={create} />; }
