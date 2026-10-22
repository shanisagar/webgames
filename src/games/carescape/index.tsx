import { GameHost } from "../../kit";
import { CarEscapeGame } from "./CarEscapeGame";

const create = () => new CarEscapeGame();
export default function CarEscape() { return <GameHost create={create} />; }
