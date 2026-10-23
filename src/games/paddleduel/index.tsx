import { GameHost } from "../../kit";
import { PaddleDuelGame } from "./PaddleDuelGame";

const create = () => new PaddleDuelGame();
export default function PaddleDuel() { return <GameHost create={create} />; }
