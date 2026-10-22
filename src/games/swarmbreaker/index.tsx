import { GameHost } from "../../kit";
import { SwarmbreakerGame } from "./SwarmbreakerGame";

const create = () => new SwarmbreakerGame();
export default function Swarmbreaker() { return <GameHost create={create} />; }
