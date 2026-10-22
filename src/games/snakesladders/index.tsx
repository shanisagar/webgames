import { GameHost } from "../../kit";
import { SnakesLaddersGame } from "./SnakesLaddersGame";

const create = () => new SnakesLaddersGame();
export default function SnakesLadders() { return <GameHost create={create} />; }
