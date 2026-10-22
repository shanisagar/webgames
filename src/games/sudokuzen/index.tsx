import { GameHost } from "../../kit";
import { SudokuZenGame } from "./SudokuZenGame";

const create = () => new SudokuZenGame();
export default function SudokuZen() { return <GameHost create={create} />; }
