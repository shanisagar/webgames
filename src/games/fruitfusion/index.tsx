import { GameHost } from "../../kit";
import { FruitFusionGame } from "./FruitFusionGame";

const create = () => new FruitFusionGame();
export default function FruitFusion() { return <GameHost create={create} />; }
