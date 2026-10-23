import { GameHost } from "../../kit";
import { TopRumbleGame } from "./TopRumbleGame";

const create = () => new TopRumbleGame();
export default function TopRumble() { return <GameHost create={create} />; }
