import { GameHost } from "../../kit";
import { CarromGame } from "./CarromGame";

const create = () => new CarromGame();
export default function Carrom() { return <GameHost create={create} />; }
