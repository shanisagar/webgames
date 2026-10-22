import { GameHost } from "../../kit";
import { PinballGame } from "./PinballGame";

const create = () => new PinballGame();
export default function Pinball() { return <GameHost create={create} />; }
