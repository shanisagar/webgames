import { GameHost } from "../../kit";
import { NeuralSiegeGame } from "./NeuralSiegeGame";

const create = () => new NeuralSiegeGame();
export default function NeuralSiege() { return <GameHost create={create} />; }
