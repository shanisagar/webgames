import { GameHost } from "../../kit";
import { GhostlineGame } from "./GhostlineGame";

const create = () => new GhostlineGame();
export default function Ghostline() { return <GameHost create={create} />; }
