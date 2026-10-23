import { GameHost } from "../../kit";
import { FruitSliceGame } from "./FruitSliceGame";

const create = () => new FruitSliceGame();
export default function FruitSlice() { return <GameHost create={create} />; }
