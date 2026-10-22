import { GameHost } from "../../kit";
import { PixelCrossGame } from "./PixelCrossGame";

const create = () => new PixelCrossGame();
export default function PixelCross() { return <GameHost create={create} />; }
