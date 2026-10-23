import { GameHost } from "../../kit";
import { CashRocketGame } from "./CashRocketGame";

const create = () => new CashRocketGame();
export default function CashRocket() { return <GameHost create={create} />; }
