import { GameHost } from "../../kit";
import { FlapFlockGame } from "./FlapFlockGame";

const create = () => new FlapFlockGame();
export default function FlapFlock() { return <GameHost create={create} />; }
