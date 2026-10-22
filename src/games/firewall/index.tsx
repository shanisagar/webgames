import { GameHost } from "../../kit";
import { FirewallGame } from "./FirewallGame";

const create = () => new FirewallGame();
export default function Firewall() { return <GameHost create={create} />; }
