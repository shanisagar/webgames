import { GameHost } from "../../kit";
import { BalloonGame } from "./BalloonGame";

const create = () => new BalloonGame();
export default function BalloonBurst() { return <GameHost create={create} />; }
