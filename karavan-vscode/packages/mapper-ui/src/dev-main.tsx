import { mountKaravanMapper } from "./mount";
import type { KaravanMapperHost } from "./karavan-host";

const devHost: KaravanMapperHost = {
    getContext: () => ({
        xslt: "",
        sourcePath: "source-order.xsd",
        targetPath: "target-order.xsd",
        workspaceXsdFiles: ["source-order.xsd", "target-order.xsd"],
    }),
    pickWorkspaceFile: () => undefined,
    openXsltInEditor: (content) => console.log("openXsltInEditor", content.length),
    saveToActivity: (payload) => console.log("saveToActivity", payload),
    subscribe: () => () => undefined,
};

const el = document.getElementById("root");
if (el) {
    mountKaravanMapper(el, devHost);
}
