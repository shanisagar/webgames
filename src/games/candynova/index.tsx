import { GameHost } from "../../kit";
import { CandyNovaGame } from "./CandyNovaGame";

const create = () => new CandyNovaGame();
export default function CandyNova() { return <GameHost create={create} />; }
