import { GameHost } from "../../kit";
import { FourUpGame } from "./FourUpGame";

const create = () => new FourUpGame();
export default function FourUp() { return <GameHost create={create} />; }
