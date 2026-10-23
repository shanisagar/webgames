import { GameHost } from "../../kit";
import { DotsBoxesGame } from "./DotsBoxesGame";

const create = () => new DotsBoxesGame();
export default function DotsBoxes() { return <GameHost create={create} />; }
