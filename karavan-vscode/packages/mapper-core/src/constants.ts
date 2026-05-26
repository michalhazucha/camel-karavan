export enum ViewMode {
    Tree = "tree",
    Flow = "flow",
}
export enum MappedNodeIDs {
  Source="source",
  Target="target"
}
export const tabs=[
    {
    label: "Tree View",
    value: ViewMode.Tree
    },
    //TODO: FUTURE FEATURE 
    //{
    // label: "Flow Diagram",
    // value: ViewMode.Flow
    // }
];