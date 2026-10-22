import { GameHost } from "../../kit";
import { VoltraceGame } from "./VoltraceGame";

const create = () => new VoltraceGame();
export default function Voltrace() { return <GameHost create={create} />; }
