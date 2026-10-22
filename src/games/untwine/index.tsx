import { GameHost } from "../../kit";
import { UntwineGame } from "./UntwineGame";

const create = () => new UntwineGame();
export default function Untwine() { return <GameHost create={create} />; }
