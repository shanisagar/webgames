import { GameHost } from "../../kit";
import { MineMeadowGame } from "./MineMeadowGame";

const create = () => new MineMeadowGame();
export default function MineMeadow() { return <GameHost create={create} />; }
