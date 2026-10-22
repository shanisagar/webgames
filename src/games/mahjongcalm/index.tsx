import { GameHost } from "../../kit";
import { MahjongGame } from "./MahjongGame";

const create = () => new MahjongGame();
export default function MahjongCalm() { return <GameHost create={create} />; }
