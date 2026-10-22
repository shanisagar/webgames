import { GameHost } from "../../kit";
import { EmberRippleGame } from "./EmberRippleGame";

const create = () => new EmberRippleGame();
export default function EmberRipple() { return <GameHost create={create} />; }
