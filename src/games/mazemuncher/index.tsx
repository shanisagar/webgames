import { GameHost } from "../../kit";
import { MazeMuncherGame } from "./MazeMuncherGame";

const create = () => new MazeMuncherGame();
export default function MazeMuncher() { return <GameHost create={create} />; }
