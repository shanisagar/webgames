import { GameHost } from "../../kit";
import { ElixirLabGame } from "./ElixirLabGame";

const create = () => new ElixirLabGame();
export default function ElixirLab() { return <GameHost create={create} />; }
