import { GameHost } from "../../kit";
import { WordWonderGame } from "./WordWonderGame";

const create = () => new WordWonderGame();
export default function WordWonder() { return <GameHost create={create} />; }
