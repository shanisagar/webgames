import { GameHost } from "../../kit";
import { SkyStackGame } from "./SkyStackGame";

const create = () => new SkyStackGame();
export default function SkyStack() { return <GameHost create={create} />; }
