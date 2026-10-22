import { GameHost } from "../../kit";
import { HexaSortGame } from "./HexaSortGame";

const create = () => new HexaSortGame();
export default function HexaSort() { return <GameHost create={create} />; }
