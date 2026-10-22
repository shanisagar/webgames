import { GameHost } from "../../kit";
import { PoolProGame } from "./PoolProGame";

const create = () => new PoolProGame();
export default function PoolPro() { return <GameHost create={create} />; }
