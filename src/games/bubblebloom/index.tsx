import { GameHost } from "../../kit";
import { BubbleBloomGame } from "./BubbleBloomGame";

const create = () => new BubbleBloomGame();
export default function BubbleBloom() { return <GameHost create={create} />; }
