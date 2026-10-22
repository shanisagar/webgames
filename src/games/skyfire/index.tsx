import { GameHost } from "../../kit";
import { SkyfireGame } from "./SkyfireGame";

const create = () => new SkyfireGame();
export default function Skyfire() { return <GameHost create={create} />; }
