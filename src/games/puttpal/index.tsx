import { GameHost } from "../../kit";
import { PuttPalGame } from "./PuttPalGame";

const create = () => new PuttPalGame();
export default function PuttPal() { return <GameHost create={create} />; }
