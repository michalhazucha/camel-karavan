import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";



export const useWorkspaceStore=createWithEqualityFn((set)=>({
    files:[],
    fileContents:{},
    isLoaded:false,
    setWorkspaceFiles:(files:string[])=>{
        set({files, isLoaded:true});
    },
    setWorkspaceFileContent:(relativePath:string, content:string)=>{
        set((state)=>{
            const fileContents = {...state.fileContents, [relativePath]: content};
            return {fileContents};
        });
    },
    reset:()=>{
        set({files:[], fileContents:{}, isLoaded:false});
    }
}), shallow)

//TODO: fix this based on another implementation point 3