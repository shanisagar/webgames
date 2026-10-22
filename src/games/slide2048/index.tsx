import { GameHost } from "../../kit";
import { Slide2048Game } from "./Slide2048Game";

const create = () => new Slide2048Game();
export default function Slide2048() { return <GameHost create={create} />; }
