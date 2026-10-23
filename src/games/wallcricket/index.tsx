import { GameHost } from "../../kit";
import { CricketBowlingGame } from "./CricketBowlingGame";

const create = () => new CricketBowlingGame();
export default function CricketBowling() { return <GameHost create={create} />; }
