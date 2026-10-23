import { GameHost } from "../../kit";
import { MoleSmashGame } from "./MoleSmashGame";

const create = () => new MoleSmashGame();
export default function MoleSmash() { return <GameHost create={create} />; }
