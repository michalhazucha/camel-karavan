import "./index.css";
import { mountKaravanMapper } from "./mount";

window.__KARAVAN_MAPPER_MODE = "selection-panel";
window.__KARAVAN_MAPPER_ROLE = "secondary";

const root = document.getElementById("root");
if (root) {
    mountKaravanMapper(root);
}
