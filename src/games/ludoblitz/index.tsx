import { GameHost } from "../../kit";
import { LudoBlitzGame } from "./LudoBlitzGame";

const create = () => new LudoBlitzGame();
export default function LudoBlitz() { return <GameHost create={create} />; }
