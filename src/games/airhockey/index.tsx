import { GameHost } from "../../kit";
import { AirHockeyGame } from "./AirHockeyGame";

const create = () => new AirHockeyGame();
export default function AirHockey() { return <GameHost create={create} />; }
