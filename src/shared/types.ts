
export const VIEW_TYPE_MIND_MAP = "obsimap-view";

export interface MindMapSettings {
    exportFolder: string;
    theme: string;
    hotkeys: {
        addChild: string;
        addSibling: string;
        delete: string;
        rename: string;
        reorderUp: string;
        reorderDown: string;
        promote: string;
        demote: string;
        searchNote: string;
        createNote: string;
        openNote: string;
        toggleCollapse: string;
    };
    stripMetadata: boolean;
    showHoverPreview: boolean;
    maxNodeLength: number;
    nodeStyle: "pill" | "rect";
}

export const DEFAULT_SETTINGS: MindMapSettings = {
    exportFolder: "",
    theme: "default",
    hotkeys: {
        addChild: "Tab",
        addSibling: "Enter",
        delete: "Delete",
        rename: "Shift+Enter",
        reorderUp: "Shift+ArrowUp",
        reorderDown: "Shift+ArrowDown",
        promote: "Shift+ArrowLeft",
        demote: "Shift+ArrowRight",
        searchNote: "Shift+Ctrl+Enter",
        createNote: "Ctrl+Shift+N",
        openNote: "Ctrl+Shift+L",
        toggleCollapse: "Ctrl+/",
    },
    stripMetadata: true,
    showHoverPreview: true,
    maxNodeLength: 20,
    nodeStyle: "pill",
};

export interface MindMapNode {
    id: string;
    text: string;
    children: MindMapNode[];
    parent?: string;
    x?: number;
    y?: number;
    collapsed?: boolean;
}
