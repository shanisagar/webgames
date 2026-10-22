import { GameHost } from "../../kit";
import { SnakeBrawlGame } from "./SnakeBrawlGame";

const create = () => new SnakeBrawlGame();
export default function SnakeBrawl() { return <GameHost create={create} />; }
