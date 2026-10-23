import { GameHost } from "../../kit";
import { LagoriGame } from "./LagoriGame";

const create = () => new LagoriGame();
export default function Lagori() { return <GameHost create={create} />; }
