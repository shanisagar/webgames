import { GameHost } from "../../kit";
import { SunnySolitaireGame } from "./SunnySolitaireGame";

const create = () => new SunnySolitaireGame();
export default function SunnySolitaire() { return <GameHost create={create} />; }
