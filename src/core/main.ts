import {
    Plugin,
    PluginSettingTab,
    FuzzySuggestModal,
    Modal,
    Menu,
    setIcon,
    setTooltip,
    Notice,
    TFile,
    TFolder,
    Setting,
    WorkspaceLeaf,
    App,
    MetadataCache,
    TextFileView,
} from "obsidian";
import {
    VIEW_TYPE_MIND_MAP,
    MindMapSettings,
    DEFAULT_SETTINGS,
    MindMapNode
} from "../shared/types";

export default class MindMapPlugin extends Plugin {
    settings: MindMapSettings;
    isInternalRenaming = false;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_MIND_MAP,
            (leaf) => new MindMapView(leaf, this)
        );

        this.registerExtensions(["mindmap"], VIEW_TYPE_MIND_MAP);

        this.addRibbonIcon("network", "Open mind map", () => {
            void this.activateView();
        });

        this.addSettingTab(new MindMapSettingTab(this.app, this));

        this.addCommand({
            id: "import-markdown",
            name: "Import current note",
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);
                const view = leaves.length > 0 ? leaves[0].view : null;
                if (view instanceof MindMapView) {
                    void view.importMarkdown();
                } else {
                    void this.activateView().then(() => {
                        const newLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);
                        const newView = newLeaves.length > 0 ? newLeaves[0].view : null;
                        if (newView instanceof MindMapView) void newView.importMarkdown();
                    });
                }
            },
        });

        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (this.isInternalRenaming) return;
                if (file instanceof TFile && (file.extension === "md" || file.extension === "mindmap")) {
                    void this.handleFileRename(file, oldPath);
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                if (leaf && leaf.view instanceof MindMapView) {
                    leaf.view.focusContainer();
                }
            })
        );
    }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        if (data && data.hotkeys) {
            this.settings.hotkeys = Object.assign({}, DEFAULT_SETTINGS.hotkeys, data.hotkeys);
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async handleFileRename(file: TFile, oldPath: string) {
        const oldFileObj = this.getOldFileData(oldPath);
        const newName = file.basename;
        const oldName = oldFileObj.basename;

        if (oldName === newName) return;

        const mindmapFiles = this.app.vault.getFiles().filter(f => f.extension === "mindmap");

        for (const mmFile of mindmapFiles) {
            let content = await this.app.vault.read(mmFile);
            // Handle both exact matches and matches with aliases [[OldName|Alias]]
            const oldLinkRegex = new RegExp(`\\[\\[${this.escapeRegExp(oldName)}(\\|[^\\]]+)?\\]\\]`, 'g');

            if (content.match(oldLinkRegex)) {
                const updatedContent = content.replace(oldLinkRegex, (match, alias) => {
                    return alias ? `[[${newName}${alias}]]` : `[[${newName}]]`;
                });

                await this.app.vault.modify(mmFile, updatedContent);

                // If the file is currently open in a view, we should notify it to reload
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);
                for (const leaf of leaves) {
                    const view = leaf.view;
                    if (view instanceof MindMapView && view.file && view.file.path === mmFile.path) {
                        if (view.render) view.render();
                    }
                }
            }
        }
    }

    getOldFileData(oldPath: string): { basename: string; extension: string } {
        const lastSlash = oldPath.lastIndexOf("/");
        const fileName = lastSlash === -1 ? oldPath : oldPath.substring(lastSlash + 1);
        const lastDot = fileName.lastIndexOf(".");
        if (lastDot === -1) return { basename: fileName, extension: "" };
        return {
            basename: fileName.substring(0, lastDot),
            extension: fileName.substring(lastDot + 1)
        };
    }

    escapeRegExp(string: string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async activateView() {
        const { workspace } = this.app;

        const folder = this.settings.exportFolder || "";
        await this.ensureFolderExists(folder);

        let fileName = "Untitled.mindmap";
        let path = folder ? `${folder}/${fileName}` : fileName;
        let counter = 1;

        while (this.app.vault.getAbstractFileByPath(path)) {
            fileName = `Untitled (${counter}).mindmap`;
            path = folder ? `${folder}/${fileName}` : fileName;
            counter++;
        }

        const emptyData = {
            root: { id: "root", text: "Central idea", children: [] },
        };
        const content = `---\ntype: mindmap\n---\n\n\`\`\`json\n${JSON.stringify(emptyData, null, 2)}\n\`\`\``;

        try {
            const file = await this.app.vault.create(path, content);
            const leaf = workspace.getLeaf("tab");
            await leaf.openFile(file);

            if (leaf.view instanceof MindMapView) {
                // Auto-trigger rename to mimic "New Note" behavior
                setTimeout(() => {
                    (leaf.view as MindMapView).renameFile();
                }, 300);
            }
        } catch (e) {
            new Notice(`Error creating mind map: ${e.message}`);
        }
    }

    async ensureFolderExists(folderPath: string) {
        if (!folderPath) return;
        const parts = folderPath.split("/");
        let currentPath = "";
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const folder = this.app.vault.getAbstractFileByPath(currentPath);
            if (!folder) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }
}

class MindMapSettingTab extends PluginSettingTab {
    plugin: MindMapPlugin;

    constructor(app: App, plugin: MindMapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();


        new Setting(containerEl)
            .setName("Export folder")
            .setDesc("Default folder for exported files and new notes.")
            .addText((text) =>
                text
                    .setPlaceholder("Example: mind-maps/exports")
                    .setValue(this.plugin.settings.exportFolder)
                    .onChange((value) => {
                        this.plugin.settings.exportFolder = value;
                        void this.plugin.saveSettings();
                    })
            )
            .addButton((btn) =>
                btn.setButtonText("Select folder").onClick(() => {
                    new FolderSuggestModal(this.app, (folder) => {
                        this.plugin.settings.exportFolder = folder.path;
                        void this.plugin.saveSettings();
                        this.display();
                    }).open();
                })
            );

        new Setting(containerEl)
            .setName("Theme")
            .setDesc("Select a color theme for your mindmap nodes.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("default", "Default Obsidian")
                    .addOption("vibrant", "Vibrant colors")
                    .addOption("contrast", "High contrast")
                    .setValue(this.plugin.settings.theme)
                    .onChange((value) => {
                        this.plugin.settings.theme = value;
                        void this.plugin.saveSettings();
                        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);
                        const view = leaves.length > 0 ? leaves[0].view : null;
                        if (view instanceof MindMapView) view.updateTheme(this.plugin.settings.theme);
                    })
            );

        new Setting(containerEl)
            .setName("Strip metadata from full note")
            .setDesc("Automatically remove YAML frontmatter/properties when exporting content.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.stripMetadata)
                    .onChange((value) => {
                        this.plugin.settings.stripMetadata = value;
                        void this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show hover preview")
            .setDesc("Show the full node text when hovering over truncated nodes.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showHoverPreview)
                    .onChange((value) => {
                        this.plugin.settings.showHoverPreview = value;
                        void this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Max node text length")
            .setDesc("The maximum number of characters to show in a node before truncating with '...'.")
            .addSlider((slider) =>
                slider
                    .setLimits(5, 100, 1)
                    .setValue(this.plugin.settings.maxNodeLength)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.plugin.settings.maxNodeLength = value;
                        void this.plugin.saveSettings();
                        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);
                        const view = leaves.length > 0 ? leaves[0].view : null;
                        if (view instanceof MindMapView) view.render();
                    })
            );


        new Setting(containerEl).setName("Node operations").setHeading();
        const opsSection = containerEl.createDiv();
        const createOpsHotkey = (name: string, key: keyof MindMapSettings["hotkeys"]) => {
            new Setting(opsSection).setName(name).addText((text) => {
                text.setValue(this.plugin.settings.hotkeys[key]);
                text.inputEl.placeholder = "Press keys...";
                text.inputEl.addEventListener("keydown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Escape" || e.key === "Backspace") {
                        this.plugin.settings.hotkeys[key] = "";
                        text.setValue("");
                        void this.plugin.saveSettings();
                        return;
                    }
                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
                    const modifiers = [];
                    if (e.ctrlKey || e.metaKey) modifiers.push("Ctrl");
                    if (e.shiftKey) modifiers.push("Shift");
                    if (e.altKey) modifiers.push("Alt");
                    const mainKey = e.key === " " ? "Space" : e.key;
                    const fullKey =
                        (modifiers.length > 0 ? modifiers.join("+") + "+" : "") +
                        (mainKey.length === 1 ? mainKey.toUpperCase() : mainKey);
                    this.plugin.settings.hotkeys[key] = fullKey;
                    text.setValue(fullKey);
                    void this.plugin.saveSettings();
                });
            });
        };

        createOpsHotkey("Add child node", "addChild");
        createOpsHotkey("Add sibling node", "addSibling");
        createOpsHotkey("Delete node", "delete");
        createOpsHotkey("Rename node", "rename");
        createOpsHotkey("Search & link note", "searchNote");
        createOpsHotkey("Create note from node", "createNote");
        createOpsHotkey("Open linked note", "openNote");

        new Setting(containerEl)
            .setName("Node style")
            .setDesc("Choose the visual appearance of nodes.")
            .addDropdown(dropdown => dropdown
                .addOption("pill", "Pill (rounded)")
                .addOption("rect", "Rectangle (sharp)")
                .setValue(this.plugin.settings.nodeStyle)
                .onChange((value: "pill" | "rect") => {
                    this.plugin.settings.nodeStyle = value;
                    void this.plugin.saveSettings();
                    // Refresh current view if open
                    this.app.workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP).forEach(leaf => {
                        if (leaf.view instanceof MindMapView) leaf.view.render();
                    });
                }));

        new Setting(containerEl).setName("Navigation and movement").setHeading();
        containerEl.createEl("p", { text: "Configure how you navigate and move nodes.", cls: "setting-item-description" });
        const moveSection = containerEl.createDiv();

        new Setting(moveSection)
            .setName("Multi-node selection")
            .setDesc("Modifier key to select multiple nodes during navigation.")
            .addText(text => text.setDisabled(true).setValue("Cmd / Ctrl (fixed)"));

        const createMoveHotkey = (name: string, key: keyof MindMapSettings["hotkeys"]) => {
            new Setting(moveSection).setName(name).addText((text) => {
                text.setValue(this.plugin.settings.hotkeys[key]);
                text.inputEl.placeholder = "Press keys...";
                text.inputEl.addEventListener("keydown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Escape" || e.key === "Backspace") {
                        this.plugin.settings.hotkeys[key] = "";
                        text.setValue("");
                        void this.plugin.saveSettings();
                        return;
                    }
                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
                    const modifiers = [];
                    if (e.ctrlKey || e.metaKey) modifiers.push("Ctrl");
                    if (e.shiftKey) modifiers.push("Shift");
                    if (e.altKey) modifiers.push("Alt");
                    const mainKey = e.key === " " ? "Space" : e.key;
                    const fullKey =
                        (modifiers.length > 0 ? modifiers.join("+") + "+" : "") +
                        (mainKey.length === 1 ? mainKey.toUpperCase() : mainKey);
                    this.plugin.settings.hotkeys[key] = fullKey;
                    text.setValue(fullKey);
                    void this.plugin.saveSettings();
                });
            });
        };

        createMoveHotkey("Move node up (Shift+)", "reorderUp");
        createMoveHotkey("Move node down (Shift+)", "reorderDown");
        createMoveHotkey("Demote node (Shift+move right)", "demote");
        createMoveHotkey("Fold/unfold subtree", "toggleCollapse");

        new Setting(containerEl).setName("Support").setHeading();
        const supportDiv = containerEl.createDiv();
        supportDiv.createEl("p", { text: "If you find this plugin helpful, please consider supporting the development!" });

        const coffeeBtn = supportDiv.createEl("a", { href: "https://www.buymeacoffee.com/creative781", cls: "obsimap-support-coffee" });
        coffeeBtn.createEl("img", {
            attr: {
                src: "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png",
                alt: "Buy Me A Coffee"
            }
        });

        const socialDiv = supportDiv.createDiv({ cls: "obsimap-social-links" });

        socialDiv.createEl("a", {
            href: "https://www.youtube.com/@creative781",
            text: "📺 YouTube channel",
            cls: "obsimap-social-link"
        });

        socialDiv.createEl("a", {
            href: "https://creative781.cafe24.com/",
            text: "🏠 official blog",
            cls: "obsimap-social-link"
        });
    }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    onSelect: (folder: TFolder) => void;
    folders: TFolder[];

    constructor(app: App, onSelect: (folder: TFolder) => void) {
        super(app);
        this.onSelect = onSelect;
        this.folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
    }

    getItems(): TFolder[] {
        return this.folders;
    }

    getItemText(item: TFolder): string {
        return item.path;
    }

    onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(item);
    }
}

class SaveModal extends Modal {
    fileName: string;
    onSave: (name: string) => void;

    constructor(app: App, defaultName: string, onSave: (name: string) => void) {
        super(app);
        this.fileName = defaultName;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName("Save mind map").setHeading();
        new Setting(contentEl).setName("File name").addText((text) =>
            text.setValue(this.fileName).onChange((value) => (this.fileName = value))
        );
        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    void this.onSave(this.fileName);
                    this.close();
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class MindMapView extends TextFileView {
    svg: SVGSVGElement;
    g: SVGGElement;
    mindMapData: { root: MindMapNode };
    selectedNodeId: string | null = null;
    selectedNodeIds: Set<string> = new Set();
    zoom = 1;
    panX = 0;
    panY = 0;
    isDragging = false;
    lastMouseX = 0;
    lastMouseY = 0;
    isEditing = false;
    /** Rename chosen from context menu; started after menu closes so focus is not stolen. */
    private pendingContextMenuRename: MindMapNode | null = null;
    settings: MindMapSettings;
    metadataCache: MetadataCache;
    plugin: MindMapPlugin;
    historyStack: string[] = [];

    // Internal Drag and Drop state
    private draggedNodeId: string | null = null;
    private dragTargetNodeId: string | null = null;
    private dragDropMode: "child" | "above" | "below" | "replace" | null = null;
    private ghostNode: SVGGElement | null = null;
    private dragStartX = 0;
    private dragStartY = 0;
    private isInternalDragging = false;
    private isToolbarExpanded = false;
    private currentTooltip: HTMLElement | null = null;
    private suppressNextClick = false;
    private suppressHotkeysUntil = 0;
    private editInputEl: HTMLInputElement | null = null;
    private editViewportResizeHandler: (() => void) | null = null;
    private svgContainerEl: HTMLElement | null = null;
    private boundWindowKeyDown: ((e: KeyboardEvent) => void) | null = null;
    private static readonly LONG_PRESS_MS = 500;
    private static readonly LONG_PRESS_MOVE_THRESHOLD = 10;
    private static readonly NODE_HEIGHT = 40;
    private static readonly SIBLING_DROP_GAP = 40;

    constructor(leaf: WorkspaceLeaf, plugin: MindMapPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.settings = plugin.settings;
        this.metadataCache = plugin.app.metadataCache;
        this.mindMapData = {
            root: {
                id: "root",
                text: "Central idea",
                children: [],
            },
        };
        this.selectedNodeId = "root";
        this.selectedNodeIds.add("root");
    }

    focusContainer() {
        const container = this.containerEl.querySelector(".mindmap-svg-container");
        if (container instanceof HTMLElement) {
            container.focus({ preventScroll: true });
        }
    }

    private isNodeTextEditActive(): boolean {
        return this.editInputEl !== null && document.activeElement === this.editInputEl;
    }

    private endNodeTextEdit() {
        if (this.editInputEl) {
            this.editInputEl.blur();
        }
        this.teardownEditInput();
    }

    getViewType(): string {
        return VIEW_TYPE_MIND_MAP;
    }

    getIcon(): string {
        return "lucide-git-graph";
    }

    getDisplayText(): string {
        if (this.file) return this.file.basename;
        return "Simple Mindmap";
    }

    getViewData(): string {
        const jsonData = JSON.stringify(this.mindMapData, null, 2);
        return `---\ntype: mindmap\n---\n\n\`\`\`json\n${jsonData}\n\`\`\``;
    }

    setViewData(data: string, clear: boolean): void {
        const jsonMatch = data.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            try {
                this.mindMapData = JSON.parse(jsonMatch[1]);
                if (this.mindMapData.root) {
                    this.selectedNodeId = this.mindMapData.root.id;
                    this.selectedNodeIds.clear();
                    this.selectedNodeIds.add(this.mindMapData.root.id);
                }
            } catch (e) {
                console.error("Failed to parse mindmap data:", e);
            }
        }
        this.render();
        setTimeout(() => this.focusContainer(), 200);
    }

    clear(): void {
        this.mindMapData = {
            root: { id: "root", text: "Central idea", children: [] },
        };
        this.selectedNodeId = "root";
        this.selectedNodeIds.clear();
        this.selectedNodeIds.add("root");
        this.render();
    }

    async onOpen() {
        await super.onOpen();
        const container = this.contentEl;
        container.empty();
        container.classList.add("mind-map-view");
        container.classList.add(`theme-${this.settings.theme}`);

        const svgContainer = container.createEl("div", { cls: "mindmap-svg-container" });
        this.svgContainerEl = svgContainer;
        svgContainer.tabIndex = 0;

        // Floating controls
        const controls = svgContainer.createEl("div", { cls: "mindmap-controls-floating" });
        if (!this.isToolbarExpanded) controls.classList.add("is-collapsed");

        const toggleBtn = this.createControlButton(controls, "lucide-menu", "Menu", () => {
            this.isToolbarExpanded = !this.isToolbarExpanded;
            controls.classList.toggle("is-collapsed", !this.isToolbarExpanded);
            const iconEl = toggleBtn.querySelector(".lucide");
            if (iconEl instanceof Element) iconEl.replaceWith(document.createElement("div")); // placeholder to trigger re-icon
            setIcon(toggleBtn, this.isToolbarExpanded ? "lucide-chevron-left" : "lucide-menu");
        });
        toggleBtn.classList.add("toolbar-toggle-btn");
        setIcon(toggleBtn, this.isToolbarExpanded ? "lucide-chevron-left" : "lucide-menu");

        const btnContainer = controls.createEl("div", { cls: "toolbar-buttons" });
        this.createControlButton(btnContainer, "lucide-file-input", "Import markdown", () => void this.promptImport());
        this.createControlButton(btnContainer, "lucide-file-output", "Export markdown", () => void this.exportMarkdown());

        this.createControlButton(btnContainer, "lucide-file-text", "Full note", () => void this.exportFullNote());

        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svg.setAttribute("width", "100%");
        this.svg.setAttribute("height", "100%");
        this.svg.classList.add("mindmap-svg");
        svgContainer.appendChild(this.svg);

        // Auto-focus the container so keyboard navigation works immediately
        setTimeout(() => {
            svgContainer.focus();
            // Fix for native-like title rename
            const headerTitle = this.containerEl.closest(".workspace-leaf")?.querySelector(".view-header-title");
            if (headerTitle instanceof HTMLElement) {
                this.registerDomEvent(headerTitle, "click", (e) => {
                    // Only trigger if not already editing
                    if (headerTitle.contentEditable !== "true") {
                        e.preventDefault();
                        e.stopPropagation();
                        this.renameFile();
                    }
                });
                headerTitle.classList.add("is-renamable");
            }
        }, 100);

        this.g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.svg.appendChild(this.g);

        this.boundWindowKeyDown = (e: KeyboardEvent) => {
            if (this.app.workspace.getActiveViewOfType(MindMapView) !== this) return;
            if (Date.now() < this.suppressHotkeysUntil) return;
            if (this.isNodeTextEditActive()) return;
            if (e.target instanceof HTMLInputElement && e.target.classList.contains("mindmap-edit-input")) {
                return;
            }
            if (e.target instanceof HTMLElement && e.target.closest(".mindmap-control-btn")) return;
            if (e.target instanceof HTMLElement && e.target.closest(".menu")) return;

            if (e.key === " ") {
                svgContainer.setCssProps({ "cursor": "grab" });
            }
            if (e.key === "F2") {
                e.preventDefault();
                this.renameFile();
                return;
            }
            this.handleKeyDown(e);
        };
        // Bubble phase so the edit <input> can stopPropagation before Enter reaches addSibling (Enter).
        window.addEventListener("keydown", this.boundWindowKeyDown, false);

        this.registerDomEvent(svgContainer, "dragover", (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            const target = this.findDropTargetAt(e.clientX, e.clientY);
            if (target) {
                if (this.dragTargetNodeId !== target.node.id || this.dragDropMode !== target.mode) {
                    this.dragTargetNodeId = target.node.id;
                    this.dragDropMode = target.mode;
                    this.updateVisualIndicators();
                }
            } else if (this.dragTargetNodeId) {
                this.dragTargetNodeId = null;
                this.dragDropMode = null;
                this.updateVisualIndicators();
            }
        });

        this.registerDomEvent(svgContainer, "drop", (e: DragEvent) => {
            e.preventDefault();
            const target = this.findDropTargetAt(e.clientX, e.clientY);
            this.dragTargetNodeId = null;
            this.dragDropMode = null;
            this.updateVisualIndicators();
            if (!target) return;
            this.handleExternalDrop(e, target.node, target.mode);
        });

        this.registerDomEvent(svgContainer, "keyup", (e) => {
            if (e.key === " ") {
                if (!this.isDragging) svgContainer.setCssProps({ "cursor": "default" });
            }
        });

        this.registerDomEvent(this.svg as unknown as HTMLElement, "wheel", (e: WheelEvent) => {
            e.preventDefault();
            const zoomSpeed = 0.001;
            this.zoom -= e.deltaY * zoomSpeed;
            this.zoom = Math.max(0.1, Math.min(this.zoom, 5));
            this.updateTransform();
        });

        this.registerDomEvent(this.svg as unknown as HTMLElement, "pointerdown", (e: PointerEvent) => {
            if (e.button === 0 || e.button === 1) {
                this.focusContainer();
                this.isDragging = true;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                svgContainer.setCssProps({ "cursor": "grabbing" });
                this.svg.setPointerCapture(e.pointerId);
            }
        });

        this.registerDomEvent(this.svg as unknown as HTMLElement, "pointermove", (e: PointerEvent) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.panX += dx;
                this.panY += dy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.updateTransform();
            }
        });

        this.registerDomEvent(this.svg as unknown as HTMLElement, "pointerup", (e: PointerEvent) => {
            this.isDragging = false;
            if (this.svg) {
                const svgContainer = this.containerEl.querySelector(".mindmap-svg-container");
                if (svgContainer instanceof HTMLElement) svgContainer.setCssProps({ "cursor": "default" });
                this.svg.releasePointerCapture(e.pointerId);
            }
        });

        this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
            if (leaf === this.leaf) {
                // Short delay to ensure the pane is fully visible
                setTimeout(() => this.focusContainer(), 50);
            }
        }));

        this.render();
    }

    createControlButton(container: HTMLElement, iconId: string, tooltip: string, onClick: () => void): HTMLElement {
        const btn = container.createEl("div", { cls: "mindmap-control-btn" });
        setIcon(btn, iconId);
        setTooltip(btn, tooltip);
        this.registerDomEvent(btn, "click", () => {
            onClick();
            requestAnimationFrame(() => this.focusContainer());
        });
        return btn;
    }

    updateTransform() {
        this.g.setAttribute("transform", `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`);
    }

    /** Pan just enough so the node is visible (not centered). */
    private ensureNodeInView(nodeId: string): void {
        if (!this.svgContainerEl) return;
        const node = this.findNodeById(this.mindMapData.root, nodeId);
        if (!node) return;

        const padding = 24;
        const nodeWidth = this.getNodeWidth(node.text);
        const extraRight = node.children.length > 0 ? 26 : 0;
        const nodeHeight = MindMapView.NODE_HEIGHT;

        const viewport = this.svgContainerEl.getBoundingClientRect();
        const left = this.panX + (node.x ?? 0) * this.zoom;
        const top = this.panY + (node.y ?? 0) * this.zoom;
        const right = left + (nodeWidth + extraRight) * this.zoom;
        const bottom = top + nodeHeight * this.zoom;

        const viewLeft = padding;
        const viewTop = padding;
        const viewRight = viewport.width - padding;
        const viewBottom = viewport.height - padding;

        let dx = 0;
        let dy = 0;

        if (left < viewLeft) dx = viewLeft - left;
        else if (right > viewRight) dx = viewRight - right;

        if (top < viewTop) dy = viewTop - top;
        else if (bottom > viewBottom) dy = viewBottom - bottom;

        if (dx === 0 && dy === 0) return;

        this.panX += dx;
        this.panY += dy;
        this.updateTransform();
    }

    handleKeyDown(e: KeyboardEvent) {
        if (this.isNodeTextEditActive()) {
            return;
        }
        // Recover from stale edit overlay (e.g. keyboard dismissed without blur)
        if (this.editInputEl && document.activeElement !== this.editInputEl) {
            this.teardownEditInput();
        } else if (this.isEditing && !this.editInputEl) {
            this.isEditing = false;
        }
        if (
            document.activeElement?.tagName === "INPUT" ||
            document.activeElement?.tagName === "TEXTAREA"
        ) {
            return;
        }

        if (!this.selectedNodeId) return;
        const nodeId = this.selectedNodeId;
        const hotkeys = this.settings.hotkeys;

        const modifiers = [];
        if (e.ctrlKey || e.metaKey) modifiers.push("Ctrl");
        if (e.shiftKey) modifiers.push("Shift");
        if (e.altKey) modifiers.push("Alt");

        const key = e.key;
        const fullKey = (modifiers.length > 0 ? modifiers.join("+") + "+" : "") + key;

        // Undo support
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            this.undo();
            return;
        }

        const matches = (configKey: string) => {
            if (!configKey) return false;
            // Handle special keys like "Delete" or "Space"
            const normalizedKey = key === " " ? "Space" : key;

            // Check for exact match including modifiers
            if (configKey === fullKey) return true;

            // Check for single key match without modifiers
            if (configKey === normalizedKey && modifiers.length === 0) return true;

            // Check for modifier + key match where key might be capitalized in config
            const parts = configKey.split("+");
            const configModifiers = parts.slice(0, -1);
            const configMainKey = parts[parts.length - 1];

            if (configMainKey.toLowerCase() !== normalizedKey.toLowerCase()) return false; // Case-insensitive key match
            if (configModifiers.length !== modifiers.length) return false;
            return configModifiers.every((m) => modifiers.includes(m));
        };

        const isMultiSelect = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        // 1. Shift + Arrows: Movement (Reorder/Promote/Demote)
        if (isShift) {
            if (key === "ArrowUp") { e.preventDefault(); this.reorderNode(-1); return; }
            if (key === "ArrowDown") { e.preventDefault(); this.reorderNode(1); return; }
            if (key === "ArrowLeft") { e.preventDefault(); this.promoteNode(); return; }
            if (key === "ArrowRight") { e.preventDefault(); this.demoteNode(); return; }
        }

        // 2. Cmd/Ctrl + Arrows or Plain Arrows: Navigation/Selection
        if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
            e.preventDefault();
            if (key === "ArrowUp") this.navigateSibling(-1, isMultiSelect);
            else if (key === "ArrowDown") this.navigateSibling(1, isMultiSelect);
            else if (key === "ArrowLeft") this.navigateParent(isMultiSelect);
            else if (key === "ArrowRight") this.navigateChild(isMultiSelect);
            return;
        }

        if (matches(hotkeys.addChild)) {
            e.preventDefault();
            this.addChildNode(nodeId);
        } else if (matches(hotkeys.addSibling)) {
            e.preventDefault();
            this.addSiblingNode(nodeId);
        } else if (matches(hotkeys.delete) || (key === "Backspace" && hotkeys.delete === "Delete")) {
            e.preventDefault();
            this.deleteNode(nodeId);
        } else if (matches(hotkeys.rename)) {
            e.preventDefault();
            const node = this.findNodeById(this.mindMapData.root, nodeId);
            if (node) this.editNode(node);
        } else if (matches(hotkeys.reorderUp)) {
            e.preventDefault();
            this.reorderNode(-1);
        } else if (matches(hotkeys.reorderDown)) {
            e.preventDefault();
            this.reorderNode(1);
        } else if (matches(hotkeys.promote)) {
            e.preventDefault();
            this.promoteNode();
        } else if (matches(hotkeys.demote)) {
            e.preventDefault();
            this.demoteNode();
        } else if (matches(hotkeys.searchNote)) {
            e.preventDefault();
            this.openNoteSearch();
        } else if (matches(hotkeys.createNote)) {
            e.preventDefault();
            void this.createNoteFromNode();
        } else if (matches(hotkeys.openNote)) {
            e.preventDefault();
            void this.openLinkedNote();
        } else if (matches(hotkeys.toggleCollapse)) {
            e.preventDefault();
            this.toggleCollapse();
        }
    }

    toggleCollapse() {
        if (this.selectedNodeIds.size === 0) return;
        this.pushHistory();
        let changed = false;
        this.selectedNodeIds.forEach(id => {
            const node = this.findNodeById(this.mindMapData.root, id);
            if (node && node.children.length > 0) {
                node.collapsed = !node.collapsed;
                changed = true;
            }
        });
        if (changed) {
            this.render();
            void this.saveMindMap(true);
        }
    }

    private getNodeDepth(nodeId: string): number {
        if (nodeId === "root") return 0;
        let depth = 0;
        let currentId = nodeId;
        while (currentId !== "root") {
            const parent = this.findParentNode(this.mindMapData.root, currentId);
            if (!parent) return -1;
            currentId = parent.id;
            depth++;
        }
        return depth;
    }

    /** True when the node is rendered (every ancestor expanded). */
    private isNodeDisplayed(nodeId: string): boolean {
        if (nodeId === "root") return true;
        const parent = this.findParentNode(this.mindMapData.root, nodeId);
        if (!parent) return false;
        if (parent.collapsed) return false;
        return this.isNodeDisplayed(parent.id);
    }

    /** All visible nodes at a given tree depth, in on-screen top-to-bottom order. */
    private getNodesAtDepth(depth: number): MindMapNode[] {
        const nodes: MindMapNode[] = [];
        const walk = (node: MindMapNode, currentDepth: number) => {
            if (currentDepth === depth) {
                if (node.id !== "root" && this.isNodeDisplayed(node.id)) {
                    nodes.push(node);
                }
                return;
            }
            if (node.collapsed) return;
            for (const child of node.children) {
                walk(child, currentDepth + 1);
            }
        };
        walk(this.mindMapData.root, 0);
        return nodes.sort((a, b) => {
            const ay = a.y ?? 0;
            const by = b.y ?? 0;
            if (ay !== by) return ay - by;
            return (a.x ?? 0) - (b.x ?? 0);
        });
    }

    navigateSibling(direction: number, isMultiSelect: boolean = false) {
        if (!this.selectedNodeId) return;

        if (this.selectedNodeId === "root") {
            const children = this.mindMapData.root.children;
            if (children.length === 0) return;
            const target = direction > 0 ? children[0] : children[children.length - 1];
            this.selectedNodeId = target.id;
            if (!isMultiSelect) {
                this.selectedNodeIds.clear();
            }
            this.selectedNodeIds.add(this.selectedNodeId);
            this.render();
            this.ensureNodeInView(this.selectedNodeId);
            return;
        }

        this.calculateLayout(this.mindMapData.root, 100, 300);

        const depth = this.getNodeDepth(this.selectedNodeId);
        if (depth < 0) return;

        const peers = this.getNodesAtDepth(depth);
        const index = peers.findIndex((n) => n.id === this.selectedNodeId);
        if (index < 0) return;

        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= peers.length) return;

        this.selectedNodeId = peers[nextIndex].id;
        if (!isMultiSelect) {
            this.selectedNodeIds.clear();
        }
        this.selectedNodeIds.add(this.selectedNodeId);
        this.render();
        this.ensureNodeInView(this.selectedNodeId);
    }

    navigateParent(isMultiSelect: boolean = false) {
        if (!this.selectedNodeId || this.selectedNodeId === "root") return;
        const parent = this.findParentNode(this.mindMapData.root, this.selectedNodeId);
        if (parent) {
            this.selectedNodeId = parent.id;
            if (!isMultiSelect) {
                this.selectedNodeIds.clear();
            }
            this.selectedNodeIds.add(this.selectedNodeId);
            this.render();
            this.ensureNodeInView(this.selectedNodeId);
        }
    }

    navigateChild(isMultiSelect: boolean = false) {
        if (!this.selectedNodeId) return;
        const node = this.findNodeById(this.mindMapData.root, this.selectedNodeId);
        if (node && node.children.length > 0) {
            this.selectedNodeId = node.children[0].id;
            if (!isMultiSelect) {
                this.selectedNodeIds.clear();
            }
            this.selectedNodeIds.add(this.selectedNodeId);
            this.render();
            this.ensureNodeInView(this.selectedNodeId);
        }
    }

    reorderNode(direction: number) {
        if (this.selectedNodeIds.size === 0 || this.selectedNodeIds.has("root")) return;

        const firstId = this.selectedNodeIds.values().next().value;
        const parent = this.findParentNode(this.mindMapData.root, firstId);
        if (parent) {
            this.pushHistory();
            const sortedIds = Array.from(this.selectedNodeIds).sort((a, b) => {
                return (
                    parent.children.findIndex((n) => n.id === a) -
                    parent.children.findIndex((n) => n.id === b)
                );
            });

            if (direction === -1) {
                for (const id of sortedIds) {
                    const index = parent.children.findIndex((n) => n.id === id);
                    if (index > 0) {
                        const targetIndex = index - 1;
                        if (!this.selectedNodeIds.has(parent.children[targetIndex].id)) {
                            const [moved] = parent.children.splice(index, 1);
                            parent.children.splice(targetIndex, 0, moved);
                        }
                    }
                }
            } else {
                for (const id of sortedIds.reverse()) {
                    const index = parent.children.findIndex((n) => n.id === id);
                    if (index < parent.children.length - 1) {
                        const targetIndex = index + 1;
                        if (!this.selectedNodeIds.has(parent.children[targetIndex].id)) {
                            const [moved] = parent.children.splice(index, 1);
                            parent.children.splice(targetIndex, 0, moved);
                        }
                    }
                }
            }
            this.render();
            void this.saveMindMap(true);
        }
    }

    promoteNode() {
        if (this.selectedNodeIds.size === 0 || this.selectedNodeIds.has("root")) return;
        const firstId = this.selectedNodeIds.values().next().value;
        const parent = this.findParentNode(this.mindMapData.root, firstId);
        if (!parent || parent.id === "root") return;
        const grandParent = this.findParentNode(this.mindMapData.root, parent.id);
        if (grandParent) {
            this.pushHistory();
            const sortedIds = Array.from(this.selectedNodeIds).sort((a, b) => {
                return (
                    parent.children.findIndex((n) => n.id === a) -
                    parent.children.findIndex((n) => n.id === b)
                );
            });

            const parentIndexInGrandParent = grandParent.children.findIndex((n) => n.id === parent.id);
            let insertOffset = 1;
            for (const id of sortedIds) {
                const indexInParent = parent.children.findIndex((n) => n.id === id);
                const [moved] = parent.children.splice(indexInParent, 1);
                moved.parent = grandParent.id;
                grandParent.children.splice(parentIndexInGrandParent + insertOffset, 0, moved);
                insertOffset++;
            }
            this.render();
            void this.saveMindMap(true);
        }
    }

    demoteNode() {
        if (this.selectedNodeIds.size === 0 || this.selectedNodeIds.has("root")) return;
        const firstId = this.selectedNodeIds.values().next().value;
        const parent = this.findParentNode(this.mindMapData.root, firstId);
        if (parent) {
            this.pushHistory();
            const sortedIds = Array.from(this.selectedNodeIds).sort((a, b) => {
                return (
                    parent.children.findIndex((n) => n.id === a) -
                    parent.children.findIndex((n) => n.id === b)
                );
            });

            const firstIndex = parent.children.findIndex((n) => n.id === sortedIds[0]);
            if (firstIndex > 0) {
                const previousSibling = parent.children[firstIndex - 1];
                for (const id of sortedIds) {
                    const index = parent.children.findIndex((n) => n.id === id);
                    const [moved] = parent.children.splice(index, 1);
                    moved.parent = previousSibling.id;
                    previousSibling.children.push(moved);
                }
                this.render();
                void this.saveMindMap(true);
            }
        }
    }

    promptImport() {
        new FileSuggestModal(this.app, (file) => {
            void this.importMarkdown(file);
        }).open();
    }

    async importMarkdown(file?: TFile) {
        const targetFile = file || this.app.workspace.getActiveFile();
        if (!targetFile) return;
        let content = await this.app.vault.read(targetFile);

        // Strip frontmatter if present
        content = content.replace(/^---[\s\S]*?---\n?/, "");

        const lines = content.split("\n");

        // The root stays as the central node, using the filename as context.
        const rootNode: MindMapNode = {
            id: "root",
            text: targetFile.basename,
            children: [],
        };

        // Stack initialized with the root node at level -1
        const stack: { node: MindMapNode; level: number }[] = [
            { node: rootNode, level: -1 }
        ];

        let lastHeadingLevel = 0;

        lines.forEach((line, index) => {
            if (!line.trim()) return;

            let level = -1;
            let text = "";

            const headingMatch = line.match(/^(#+)\s+(.*)/);
            if (headingMatch) {
                level = headingMatch[1].length; // #=1, ##=2
                text = headingMatch[2].trim();
                lastHeadingLevel = level;
            } else {
                const listMatch = line.match(/^(\s*)(?:-|\*|\d+\.)\s+(.*)/);
                if (listMatch) {
                    // Normalize tabs to spaces (2 spaces per tab is common)
                    const indentStr = listMatch[1].replace(/\t/g, "  ");
                    // Each indentation level (even 1 space) should increase the depth
                    // relative to the current heading context.
                    level = lastHeadingLevel + indentStr.length + 1;
                    text = listMatch[2].trim();
                }
            }

            if (level !== -1) {
                const node: MindMapNode = {
                    id: `${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
                    text,
                    children: [],
                };

                // Pop stack until we find a parent that is strictly "higher" in hierarchy (smaller level)
                while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                const parent = stack[stack.length - 1].node;
                node.parent = parent.id;
                parent.children.push(node);
                stack.push({ node, level });
            }
        });

        this.mindMapData.root = rootNode;
        this.selectedNodeId = rootNode.id;
        this.selectedNodeIds.clear();
        this.selectedNodeIds.add(rootNode.id);
        this.render();
        void this.saveMindMap(true);
    }

    async ensureFolderExists(folderPath: string) {
        if (!folderPath) return;
        const parts = folderPath.split("/");
        let currentPath = "";
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const folder = this.app.vault.getAbstractFileByPath(currentPath);
            if (!folder) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }

    async exportFullNote() {
        const rootNode = this.mindMapData.root;
        const baseFileName = `${rootNode.text.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled"} (Full Note)`;
        const folder = this.settings.exportFolder;
        await this.ensureFolderExists(folder);

        let fileName = `${baseFileName}.md`;
        let path = folder ? `${folder}/${fileName}` : fileName;
        let counter = 1;
        while (await this.app.vault.adapter.exists(path)) {
            fileName = `${baseFileName} (${counter}).md`;
            path = folder ? `${folder}/${fileName}` : fileName;
            counter++;
        }

        const markdown = await this.nodeToFullMarkdown(rootNode, 1);
        try {
            await this.app.vault.create(path, markdown);
            new Notice(`Full mind map exported: ${path}`);
            const newFile = this.app.vault.getAbstractFileByPath(path);
            if (newFile instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(newFile);
            }
        } catch (e) {
            new Notice(`Failed to export full note: ${e.message}`);
        }
    }

    async nodeToFullMarkdown(node: MindMapNode, level: number): Promise<string> {
        const indent = "    ".repeat(level - 1);
        // Bold the node text so it stands out as a "heading" for its content
        let md = `${indent}- **${node.text}**\n`;

        const wikiLinkMatch = node.text.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
        if (wikiLinkMatch) {
            const fileName = wikiLinkMatch[1];
            const file = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
            if (file instanceof TFile) {
                let content = await this.app.vault.read(file);
                if (this.settings.stripMetadata) {
                    content = content.replace(/^---\n([\s\S]*?)\n---\n/, "");
                }
                const contentLines = content
                    .split("\n")
                    .map((line) => {
                        const trimmedLine = line.trim();
                        // If it's a heading in the source note, replace # with ◈ and bold it
                        if (trimmedLine.startsWith("#")) {
                            const cleanHeader = trimmedLine.replace(/^#+\s*/, "");
                            return `${indent}    **◈ ${cleanHeader}**`;
                        }
                        return `${indent}    ${line}`;
                    })
                    .join("\n");
                md += `${contentLines}\n`;
            }
        }

        for (const child of node.children) {
            md += await this.nodeToFullMarkdown(child, level + 1);
        }
        return md;
    }


    async exportMarkdown() {
        const rootNode = this.mindMapData.root;
        const baseFileName =
            (rootNode.text.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Simple Mindmap") + " (Outline)";
        const folder = this.settings.exportFolder;
        await this.ensureFolderExists(folder);

        let fileName = `${baseFileName}.md`;
        let path = folder ? `${folder}/${fileName}` : fileName;
        let counter = 1;
        while (await this.app.vault.adapter.exists(path)) {
            fileName = `${baseFileName} (${counter}).md`;
            path = folder ? `${folder}/${fileName}` : fileName;
            counter++;
        }

        let markdown = "";
        rootNode.children.forEach((child) => {
            markdown += this.nodeToMarkdown(child, 1);
        });
        try {
            await this.app.vault.create(path, markdown);
            new Notice(`Mind map exported as a new file: ${path}`);
            const newFile = this.app.vault.getAbstractFileByPath(path);
            if (newFile instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(newFile);
            }
        } catch (e) {
            new Notice(`Failed to export: ${e.message}`);
            console.error(e);
        }
    }

    nodeToMarkdown(node: MindMapNode, level: number): string {
        const indent = "    ".repeat(level - 1);
        let md = `${indent}- ${node.text}\n`;
        node.children.forEach((child) => {
            md += this.nodeToMarkdown(child, level + 1);
        });
        return md;
    }

    addChildNode(parentId: string, text?: string) {
        const isInitial = text === undefined;
        const actualText = isInitial ? "" : text;
        const parent = this.findNodeById(this.mindMapData.root, parentId);
        if (parent) {
            parent.collapsed = false; // Auto-expand when adding children
            this.pushHistory();
            const newNode: MindMapNode = {
                id: Date.now().toString(),
                text: actualText,
                children: [],
                parent: parentId,
            };
            parent.children.push(newNode);
            this.selectedNodeId = newNode.id;
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add(this.selectedNodeId);

            this.render();
            if (isInitial) {
                this.editNode(newNode, "New child");
            } else {
                void this.saveMindMap(true);
            }
        }
    }

    addSiblingNode(nodeId: string, text?: string) {
        if (nodeId === "root") return;
        const isInitial = text === undefined;
        const actualText = isInitial ? "" : text;
        const parent = this.findParentNode(this.mindMapData.root, nodeId);
        if (parent) {
            this.pushHistory();
            const newNode: MindMapNode = {
                id: Date.now().toString(),
                text: actualText,
                children: [],
                parent: parent.id,
            };
            const index = parent.children.findIndex((n) => n.id === nodeId);
            parent.children.splice(index + 1, 0, newNode);
            this.selectedNodeId = newNode.id;
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add(this.selectedNodeId);

            this.render();
            if (isInitial) {
                this.editNode(newNode, "New sibling");
            } else {
                void this.saveMindMap(true);
            }
        }
    }

    deleteNode(nodeId: string) {
        if (nodeId === "root" || this.selectedNodeIds.has("root")) return;
        const idsToDelete = this.selectedNodeIds.has(nodeId) ? Array.from(this.selectedNodeIds) : [nodeId];

        let parent: MindMapNode | null = null;
        this.pushHistory();

        for (const id of idsToDelete) {
            const p = this.findParentNode(this.mindMapData.root, id);
            if (p) {
                parent = p;
                p.children = p.children.filter((n) => n.id !== id);
            }
        }

        if (parent) {
            this.selectedNodeId = parent.id;
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add(parent.id);
        } else {
            this.selectedNodeId = "root";
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add("root");
        }

        this.render();
        void this.saveMindMap(true);
    }

    findNodeById(node: MindMapNode, id: string): MindMapNode | null {
        if (node.id === id) return node;
        for (const child of node.children) {
            const found = this.findNodeById(child, id);
            if (found) return found;
        }
        return null;
    }

    findParentNode(node: MindMapNode, childId: string): MindMapNode | null {
        for (const child of node.children) {
            if (child.id === childId) return node;
            const parent = this.findParentNode(child, childId);
            if (parent) return parent;
        }
        return null;
    }

    selectNode(nodeId: string, isMultiSelect: boolean, shouldRender = true) {
        if (isMultiSelect) {
            const currentParent = this.findParentNode(this.mindMapData.root, nodeId);
            if (this.selectedNodeIds.size > 0) {
                const firstId = this.selectedNodeIds.values().next().value;
                const firstParent = this.findParentNode(this.mindMapData.root, firstId);
                if (firstParent?.id === currentParent?.id) {
                    if (this.selectedNodeIds.has(nodeId)) {
                        this.selectedNodeIds.delete(nodeId);
                    } else {
                        this.selectedNodeIds.add(nodeId);
                    }
                } else {
                    this.selectedNodeIds.clear();
                    this.selectedNodeIds.add(nodeId);
                }
            } else {
                this.selectedNodeIds.add(nodeId);
            }
        } else {
            this.selectedNodeId = nodeId;
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add(nodeId);
        }
        if (shouldRender) this.render();
    }

    openNodeContextMenu(node: MindMapNode, x: number, y: number) {
        this.selectNode(node.id, false);

        const menu = new Menu();

        if (node.id !== "root") {
            menu.addItem((item) => {
                item.setTitle("Add sibling")
                    .setIcon("plus-with-circle")
                    .onClick(() => {
                        this.addSiblingNode(node.id);
                    });
            });
        }

        menu.addItem((item) => {
            item.setTitle("Add child")
                .setIcon("plus")
                .onClick(() => {
                    this.addChildNode(node.id);
                });
        });

        if (node.id !== "root") {
            menu.addItem((item) => {
                item.setTitle("Delete")
                    .setIcon("trash")
                    .onClick(() => {
                        this.deleteNode(node.id);
                    });
            });
        }

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle("Rename")
                .setIcon("pencil")
                .onClick(() => {
                    this.pendingContextMenuRename = node;
                });
        });

        menu.addItem((item) => {
            item.setTitle("Search & link note")
                .setIcon("search")
                .onClick(() => {
                    this.openNoteSearch();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Create note from node")
                .setIcon("file-plus")
                .onClick(() => {
                    void this.createNoteFromNode();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Open linked note")
                .setIcon("file-text")
                .onClick(() => {
                    void this.openLinkedNote();
                });
        });

        menu.showAtPosition({ x, y });
        menu.onHide(() => {
            requestAnimationFrame(() => {
                if (this.pendingContextMenuRename) {
                    const target = this.pendingContextMenuRename;
                    this.pendingContextMenuRename = null;
                    this.editNode(target);
                    return;
                }
                if (!this.isEditing) {
                    this.focusContainer();
                }
            });
        });
    }

    updateTheme(theme: string) {
        const container = this.contentEl; // Use contentEl directly
        if (container) {
            container.classList.remove("theme-default", "theme-vibrant", "theme-contrast");
            container.classList.add(`theme-${theme}`);
        }
        this.render();
    }

    private createGhostNode(node: MindMapNode, width: number) {
        this.ghostNode = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.ghostNode.classList.add("mindmap-ghost-node");
        this.ghostNode.setCssProps({ "opacity": "0.7", "pointer-events": "none" });

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("rx", "20");
        rect.setAttribute("ry", "20");
        rect.setAttribute("width", width.toString());
        rect.setAttribute("height", "40");
        rect.setAttribute("fill", "var(--interactive-accent)");
        rect.setAttribute("stroke", "var(--interactive-accent)");
        rect.setAttribute("stroke-width", "2");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", (width / 2).toString());
        text.setAttribute("y", "25");
        text.setAttribute("text-anchor", "middle");
        text.classList.add("mindmap-node-text");
        text.setCssProps({ "fill": "var(--text-on-accent)" });
        text.textContent = node.text.length > 20 ? node.text.substring(0, 20) + "..." : node.text;

        this.ghostNode.appendChild(rect);
        this.ghostNode.appendChild(text);

        // Add a slight scale-down effect (0.9x) for better "ghost" feeling
        // We will combine this with translation in update
        this.g.appendChild(this.ghostNode);
    }

    private clientToMap(clientX: number, clientY: number): { x: number; y: number } {
        const svgRect = this.svg.getBoundingClientRect();
        return {
            x: (clientX - svgRect.left - this.panX) / this.zoom,
            y: (clientY - svgRect.top - this.panY) / this.zoom,
        };
    }

    private resolveDropMode(
        node: MindMapNode,
        relativeX: number,
        relativeY: number,
        width: number,
        height: number = MindMapView.NODE_HEIGHT
    ): "child" | "above" | "below" | "replace" {
        if (node.id === "root") {
            if (relativeX > width * 0.6) return "child";
            return "replace";
        }
        // Horizontal layout: right = child, top/bottom = sibling, center = replace
        if (relativeY < height * 0.3) return "above";
        if (relativeY > height * 0.7) return "below";
        if (relativeX > width * 0.72) return "child";
        return "replace";
    }

    private getDropModeForPoint(node: MindMapNode, mapX: number, mapY: number): "child" | "above" | "below" | "replace" | null {
        const width = this.getNodeWidth(node.text);
        const nx = node.x ?? 0;
        const ny = node.y ?? 0;
        const height = MindMapView.NODE_HEIGHT;
        const relX = mapX - nx;
        const relY = mapY - ny;
        const gap = MindMapView.SIBLING_DROP_GAP;

        if (node.id !== "root") {
            // Gap between stacked siblings (below/above indicators sit outside the 40px rect)
            if (relX >= 0 && relX <= width) {
                if (relY >= -gap && relY < 0) return "above";
                if (relY > height && relY <= height + gap) return "below";
            }
        }

        if (relX >= 0 && relX <= width && relY >= 0 && relY <= height) {
            return this.resolveDropMode(node, relX, relY, width, height);
        }

        if (relX > width && relX <= width + 80 && relY >= 0 && relY <= height) {
            return "child";
        }

        return null;
    }

    private findDropTargetAt(
        clientX: number,
        clientY: number,
        excludeNodeId?: string | null
    ): { node: MindMapNode; mode: "child" | "above" | "below" | "replace" } | null {
        const { x: mapX, y: mapY } = this.clientToMap(clientX, clientY);
        let best: { node: MindMapNode; mode: "child" | "above" | "below" | "replace"; dist: number } | null = null;

        const visit = (node: MindMapNode) => {
            if (excludeNodeId) {
                if (node.id === excludeNodeId) return;
                if (this.isDescendant(excludeNodeId, node)) return;
            }

            const mode = this.getDropModeForPoint(node, mapX, mapY);
            if (mode) {
                const width = this.getNodeWidth(node.text);
                const cx = (node.x ?? 0) + width / 2;
                const cy = (node.y ?? 0) + MindMapView.NODE_HEIGHT / 2;
                const dist = Math.hypot(mapX - cx, mapY - cy);
                if (!best || dist < best.dist) {
                    best = { node, mode, dist };
                }
            }

            if (!node.collapsed) {
                node.children.forEach(visit);
            }
        };

        visit(this.mindMapData.root);
        return best ? { node: best.node, mode: best.mode } : null;
    }

    private handleExternalDrop(
        e: DragEvent,
        node: MindMapNode,
        dropMode: "child" | "above" | "below" | "replace"
    ) {
        let file: TFile | null = null;

        // @ts-ignore
        const dragManager = this.app.dragManager;
        if (dragManager) {
            const context = dragManager.viewDragContext || dragManager.activeDrag;
            if (context && context.file instanceof TFile) {
                file = context.file;
            } else if (dragManager.draggable && dragManager.draggable.file instanceof TFile) {
                file = dragManager.draggable.file;
            }
        }

        if (!file && e.dataTransfer) {
            const textData = e.dataTransfer.getData("text/plain");
            if (textData) {
                let linkPath = textData
                    .replace(/^\[\[/, "")
                    .replace(/\]\]$/, "")
                    .replace(/^\[.*\]\((.*)\)$/, "$1")
                    .split("|")[0]
                    .split("#")[0]
                    .trim();

                const abstractFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, this.file?.path || "");
                if (abstractFile instanceof TFile) {
                    file = abstractFile;
                } else {
                    const fileByPath = this.app.vault.getAbstractFileByPath(linkPath);
                    if (fileByPath instanceof TFile) {
                        file = fileByPath;
                    }
                }
            }
        }

        if (file) {
            this.insertDroppedText(node, `[[${file.basename}]]`, dropMode);
        } else {
            const textData = e.dataTransfer?.getData("text/plain");
            if (textData && textData.length < 200) {
                this.insertDroppedText(node, textData, dropMode);
            }
        }
    }

    private insertDroppedText(targetNode: MindMapNode, text: string, dropMode: "child" | "above" | "below" | "replace") {
        if (dropMode === "replace") {
            this.pushHistory();
            targetNode.text = text;
            this.render();
            void this.saveMindMap(true);
            return;
        }
        if (dropMode === "child") {
            this.addChildNode(targetNode.id, text);
            return;
        }
        const parent = this.findParentNode(this.mindMapData.root, targetNode.id);
        if (!parent) return;
        this.pushHistory();
        const newNode: MindMapNode = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            text,
            children: [],
            parent: parent.id,
        };
        const targetIndex = parent.children.findIndex((n) => n.id === targetNode.id);
        const insertIndex = dropMode === "above" ? targetIndex : targetIndex + 1;
        parent.children.splice(insertIndex, 0, newNode);
        this.selectedNodeId = newNode.id;
        this.selectedNodeIds.clear();
        this.selectedNodeIds.add(newNode.id);
        this.render();
        void this.saveMindMap(true);
    }

    private updateDragTarget(mapX: number, mapY: number) {
        if (!this.draggedNodeId) return;
        const svgRect = this.svg.getBoundingClientRect();
        const clientX = svgRect.left + this.panX + mapX * this.zoom;
        const clientY = svgRect.top + this.panY + mapY * this.zoom;
        const target = this.findDropTargetAt(clientX, clientY, this.draggedNodeId);

        if (target) {
            if (this.dragTargetNodeId !== target.node.id || this.dragDropMode !== target.mode) {
                this.dragTargetNodeId = target.node.id;
                this.dragDropMode = target.mode;
                this.updateVisualIndicators();
            }
        } else if (this.dragTargetNodeId) {
            this.dragTargetNodeId = null;
            this.dragDropMode = null;
            this.updateVisualIndicators();
        }
    }

    private updateVisualIndicators() {
        // Hide all indicators first
        this.svg.querySelectorAll(".drag-indicator-line").forEach((el: SVGElement) => {
            el.classList.remove("is-visible");
        });
        this.svg.querySelectorAll(".mindmap-node-rect").forEach((el: SVGElement) => {
            el.classList.remove("drag-target", "replace-target");
        });

        if (this.dragTargetNodeId && this.dragDropMode) {
            const nodeG = this.svg.querySelector(`[data-node-id="${this.dragTargetNodeId}"]`);
            if (nodeG) {
                const rect = nodeG.querySelector(".mindmap-node-rect");
                if (this.dragDropMode === "child") {
                    if (rect) rect.classList.add("drag-target");
                    const indicator = nodeG.querySelector(".indicator-child");
                    if (indicator instanceof SVGElement) indicator.classList.add("is-visible");
                } else if (this.dragDropMode === "above") {
                    const indicator = nodeG.querySelector(".indicator-above");
                    if (indicator instanceof SVGElement) indicator.classList.add("is-visible");
                } else if (this.dragDropMode === "below") {
                    const indicator = nodeG.querySelector(".indicator-below");
                    if (indicator instanceof SVGElement) indicator.classList.add("is-visible");
                } else if (this.dragDropMode === "replace") {
                    if (rect) rect.classList.add("replace-target");
                }
            }
        }
    }

    private isDescendant(parentId: string, node: MindMapNode): boolean {
        let current = this.findParentNode(this.mindMapData.root, node.id);
        while (current) {
            if (current.id === parentId) return true;
            current = this.findParentNode(this.mindMapData.root, current.id);
        }
        return false;
    }

    private moveNode(nodeId: string, targetId: string, mode: "child" | "above" | "below" | "replace") {
        const idsToMove = this.selectedNodeIds.has(nodeId) ? Array.from(this.selectedNodeIds) : [nodeId];
        const firstId = idsToMove[0];
        const oldParent = this.findParentNode(this.mindMapData.root, firstId);

        if (oldParent) {
            this.pushHistory();

            // Support swap for single node replace mode
            if (mode === "replace" && idsToMove.length === 1) {
                const node = this.findNodeById(this.mindMapData.root, firstId);
                const targetNode = this.findNodeById(this.mindMapData.root, targetId);
                if (node && targetNode) {
                    const tempText = node.text;
                    node.text = targetNode.text;
                    targetNode.text = tempText;
                    this.render();
                    void this.saveMindMap(true);
                }
                return;
            }

            // Normal move logic for multiple nodes
            const nodesToMove: MindMapNode[] = [];
            for (const id of idsToMove) {
                const n = this.findNodeById(this.mindMapData.root, id);
                if (n) {
                    const p = this.findParentNode(this.mindMapData.root, id);
                    if (p) {
                        p.children = p.children.filter(child => child.id !== id);
                    }
                    nodesToMove.push(n);
                }
            }

            if (mode === "child") {
                const newParent = this.findNodeById(this.mindMapData.root, targetId);
                if (newParent) {
                    for (const node of nodesToMove) {
                        node.parent = targetId;
                        newParent.children.push(node);
                    }
                }
            } else {
                const targetParent = this.findParentNode(this.mindMapData.root, targetId);
                if (targetParent) {
                    const targetIndex = targetParent.children.findIndex(n => n.id === targetId);
                    const insertIndex = mode === "above" ? targetIndex : targetIndex + 1;

                    for (let i = 0; i < nodesToMove.length; i++) {
                        const node = nodesToMove[i];
                        node.parent = targetParent.id;
                        targetParent.children.splice(insertIndex + i, 0, node);
                    }
                }
            }

            this.render();
            void this.saveMindMap(true);
        }
    }

    pushHistory() {
        const state = JSON.stringify(this.mindMapData);
        if (this.historyStack.length > 0 && this.historyStack[this.historyStack.length - 1] === state) return;
        this.historyStack.push(state);
        if (this.historyStack.length > 50) this.historyStack.shift();
    }

    undo() {
        if (this.historyStack.length === 0) return;
        const prevState = this.historyStack.pop();
        if (prevState) {
            this.mindMapData = JSON.parse(prevState);
            this.render();
            void this.saveMindMap(true);
            new Notice("Undo");
        }
    }

    async saveMindMap(isAutoSave = false) {
        if (this.file) {
            this.requestSave();
            if (!isAutoSave) new Notice("Mind map saved.");
            return;
        }

        if (!isAutoSave) {
            const rootNode = this.mindMapData.root;
            const defaultName = rootNode.text.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled";
            new SaveModal(this.app, defaultName, (fileName) => {
                void this.performSave(fileName, false);
            }).open();
        } else {
            const rootNode = this.mindMapData.root;
            const fileName = rootNode.text.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled";
            await this.performSave(fileName, true);
        }
    }

    async performSave(fileName: string, isAutoSave: boolean) {
        const folder = this.settings.exportFolder;
        await this.ensureFolderExists(folder);

        const baseName = fileName.replace(/\.mindmap$/, "");
        const fullFileName = `${baseName}.mindmap`;
        const path = folder ? `${folder}/${fullFileName}` : fullFileName;

        const content = this.getViewData();

        try {
            const existingFile = this.app.vault.getAbstractFileByPath(path);
            if (existingFile instanceof TFile) {
                await this.app.vault.modify(existingFile, content);
            } else {
                await this.app.vault.create(path, content);
            }

            if (!isAutoSave) {
                new Notice(`Mind map saved to ${path}`);
                // Open the newly created file to switch to file-backed view
                const newFile = this.app.vault.getAbstractFileByPath(path);
                if (newFile instanceof TFile) {
                    await this.app.workspace.getLeaf(false).openFile(newFile);
                }
            }
        } catch (e) {
            if (!isAutoSave) new Notice(`Error saving: ${e.message}`);
        }
    }

    render() {
        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }
        if (!this.g) return;
        if (this.editInputEl) {
            this.teardownEditInput();
        }
        this.g.innerHTML = "";
        this.calculateLayout(this.mindMapData.root, 100, 300);
        this.renderConnections(this.mindMapData.root);
        this.renderNodes(this.mindMapData.root);
        this.updateTransform();
    }

    calculateSubtreeHeight(node: MindMapNode): number {
        if (node.children.length === 0 || node.collapsed) return 60;
        let totalHeight = 0;
        node.children.forEach((child) => {
            totalHeight += this.calculateSubtreeHeight(child);
        });
        totalHeight += (node.children.length - 1) * 30;
        return Math.max(60, totalHeight);
    }

    calculateLayout(node: MindMapNode, x: number, y: number) {
        node.x = x;
        node.y = y;
        if (node.children.length === 0 || node.collapsed) return;

        const nodeWidth = this.getNodeWidth(node.text);
        const nextX = x + nodeWidth + 80;
        const totalSubtreeHeight = this.calculateSubtreeHeight(node);

        let currentY = y - totalSubtreeHeight / 2;
        node.children.forEach((child) => {
            const childSubtreeHeight = this.calculateSubtreeHeight(child);
            const childY = currentY + childSubtreeHeight / 2;
            this.calculateLayout(child, nextX, childY);
            currentY += childSubtreeHeight + 30;
        });
    }

    renderNodes(node: MindMapNode) {
        this.renderNode(node);
        if (!node.collapsed) {
            node.children.forEach((child) => this.renderNodes(child));
        }
    }

    renderConnections(node: MindMapNode) {
        if (node.collapsed) return;
        node.children.forEach((child) => {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const nodeWidth = this.getNodeWidth(node.text);
            const x1 = (node.x ?? 0) + nodeWidth;
            const y1 = (node.y ?? 0) + 20;
            const x2 = child.x ?? 0;
            const y2 = (child.y ?? 0) + 20;

            const cp1x = x1 + (x2 - x1) / 2;
            const cp2x = x1 + (x2 - x1) / 2;

            const d = `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
            path.setAttribute("d", d);
            path.classList.add("mindmap-connection");
            this.g.appendChild(path);
            this.renderConnections(child);
        });
    }

    getNodeWidth(text: string): number {
        const maxLength = this.settings.maxNodeLength;
        const baseWidth = 40;
        const charWidth = 10;
        const displayLength = text.length > maxLength ? maxLength + 3 : text.length;
        return Math.max(120, baseWidth + displayLength * charWidth);
    }

    renderNode(node: MindMapNode) {
        const nodeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const nodeWidth = this.getNodeWidth(node.text);
        nodeG.setAttribute("transform", `translate(${node.x}, ${node.y})`);
        nodeG.setAttribute("data-node-id", node.id);

        // Add toggle button for nodes with children
        if (node.children.length > 0) {
            const toggleBtn = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            toggleBtn.setAttribute("cx", (nodeWidth + 10).toString());
            toggleBtn.setAttribute("cy", "20");
            toggleBtn.setAttribute("r", "8");
            toggleBtn.classList.add("mindmap-node-toggle");
            nodeG.appendChild(toggleBtn);

            const toggleSymbol = document.createElementNS("http://www.w3.org/2000/svg", "text");
            toggleSymbol.setAttribute("x", (nodeWidth + 10).toString());
            toggleSymbol.setAttribute("y", "23.5");
            toggleSymbol.setAttribute("text-anchor", "middle");
            toggleSymbol.classList.add("mindmap-node-toggle-symbol");
            toggleSymbol.textContent = node.collapsed ? "+" : "-";
            nodeG.appendChild(toggleSymbol);

            // Add hit area for easier clicking
            const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            hitArea.setAttribute("cx", (nodeWidth + 10).toString());
            hitArea.setAttribute("cy", "20");
            hitArea.setAttribute("r", "15"); // Larger hit area
            hitArea.setAttribute("fill", "white");
            hitArea.setAttribute("fill-opacity", "0"); // Invisible but clickable
            hitArea.setCssProps({ "cursor": "pointer" });
            this.registerDomEvent(hitArea as unknown as HTMLElement, "pointerdown", (e: PointerEvent) => {
                e.preventDefault();
                e.stopPropagation();
                node.collapsed = !node.collapsed;
                this.render();
                void this.saveMindMap(true);
            });
            nodeG.appendChild(hitArea);
        }

        this.registerDomEvent(nodeG as unknown as HTMLElement, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.openNodeContextMenu(node, e.clientX, e.clientY);
        });

        this.registerDomEvent(nodeG as unknown as HTMLElement, "click", (e: MouseEvent) => {
            e.stopPropagation();
            if (this.suppressNextClick) {
                this.suppressNextClick = false;
                return;
            }
            this.selectNode(node.id, e.ctrlKey || e.metaKey || e.shiftKey);
        });

        this.registerDomEvent(nodeG as unknown as HTMLElement, "dblclick", (e: MouseEvent) => {
            e.stopPropagation();
            const wikiLinkMatch = node.text.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
            if (wikiLinkMatch) {
                const fileName = wikiLinkMatch[1];
                const file = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
                if (file instanceof TFile) {
                    void this.app.workspace.getLeaf("tab").openFile(file);
                    return;
                }
            }
            this.editNode(node);
        });

        // --- Internal Node Drag and Drop Logic (Stable Global Listeners) ---
        this.registerDomEvent(nodeG as unknown as HTMLElement, "pointerdown", (e: PointerEvent) => {
            if (e.button !== 0) return; // Only left click
            e.stopPropagation();

            const container = this.containerEl.querySelector(".mindmap-svg-container");
            if (container instanceof HTMLElement) {
                container.focus({ preventScroll: true });
            }

            // Select the node immediately on click (even root)
            this.selectNode(node.id, e.ctrlKey || e.metaKey || e.shiftKey);

            const useLongPress = e.pointerType === "touch" || e.pointerType === "pen";
            let longPressTimer: ReturnType<typeof window.setTimeout> | null = null;
            let cancelLongPress: (() => void) | null = null;
            if (useLongPress) {
                longPressTimer = window.setTimeout(() => {
                    longPressTimer = null;
                    if (!this.isInternalDragging) {
                        this.suppressNextClick = true;
                        this.openNodeContextMenu(node, e.clientX, e.clientY);
                    }
                }, MindMapView.LONG_PRESS_MS);

                cancelLongPress = () => {
                    if (longPressTimer !== null) {
                        window.clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                };

                const onLongPressPointerMove = (moveEvent: PointerEvent) => {
                    const dx = moveEvent.clientX - e.clientX;
                    const dy = moveEvent.clientY - e.clientY;
                    if (
                        Math.abs(dx) > MindMapView.LONG_PRESS_MOVE_THRESHOLD ||
                        Math.abs(dy) > MindMapView.LONG_PRESS_MOVE_THRESHOLD
                    ) {
                        cancelLongPress();
                    }
                };

                const onLongPressPointerUp = () => {
                    cancelLongPress();
                    window.removeEventListener("pointermove", onLongPressPointerMove);
                    window.removeEventListener("pointerup", onLongPressPointerUp);
                    window.removeEventListener("pointercancel", onLongPressPointerUp);
                };

                window.addEventListener("pointermove", onLongPressPointerMove);
                window.addEventListener("pointerup", onLongPressPointerUp);
                window.addEventListener("pointercancel", onLongPressPointerUp);
            }

            if (node.id === "root") return; // Root cannot be dragged

            const rectBounds = nodeG.getBoundingClientRect();
            // Calculate initial click offset relative to node Top-Left (SCREEN coords)
            const clickOffsetX = e.clientX - rectBounds.left;
            const clickOffsetY = e.clientY - rectBounds.top;

            this.draggedNodeId = node.id;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.isInternalDragging = false;

            const onPointerMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - this.dragStartX;
                const dy = moveEvent.clientY - this.dragStartY;

                if (!this.isInternalDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                    cancelLongPress?.();
                    this.isInternalDragging = true;
                    this.createGhostNode(node, nodeWidth);
                }

                if (this.isInternalDragging && this.ghostNode) {
                    const svgRect = this.svg.getBoundingClientRect();
                    // Current cursor position in MAP space
                    const mapX = (moveEvent.clientX - svgRect.left - this.panX) / this.zoom;
                    const mapY = (moveEvent.clientY - svgRect.top - this.panY) / this.zoom;

                    // Ghost node top-left in MAP space, maintaining starting offset
                    const ghostX = mapX - (clickOffsetX / this.zoom);
                    const ghostY = mapY - (clickOffsetY / this.zoom);

                    // Apply a slight scale (0.9) to make it look like a preview ghost
                    this.ghostNode.setAttribute("transform", `translate(${ghostX}, ${ghostY}) scale(0.9)`);
                    this.updateDragTarget(mapX, mapY);
                }
            };

            const onPointerUp = (_upEvent: PointerEvent) => {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);

                if (this.isInternalDragging) {
                    if (this.dragTargetNodeId && this.draggedNodeId && this.dragTargetNodeId !== this.draggedNodeId && this.dragDropMode) {
                        this.moveNode(this.draggedNodeId, this.dragTargetNodeId, this.dragDropMode);
                    }
                    if (this.ghostNode) {
                        if (this.ghostNode.parentNode) {
                            this.g.removeChild(this.ghostNode);
                        }
                        this.ghostNode = null;
                    }
                    this.dragTargetNodeId = null;
                    this.dragDropMode = null;
                    this.render();
                }

                this.draggedNodeId = null;
                this.isInternalDragging = false;
            };

            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
        });

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const nodeStyle = this.settings.nodeStyle;
        const rx = nodeStyle === "pill" ? "20" : "4";
        rect.setAttribute("rx", rx);
        rect.setAttribute("ry", rx);
        rect.setAttribute("width", nodeWidth.toString());
        rect.setAttribute("height", "40");
        rect.classList.add("mindmap-node-rect");
        rect.setCssProps({ "pointer-events": "all" }); // Ensure events are captured

        if (this.selectedNodeIds.has(node.id)) {
            rect.classList.add("is-selected");
        }

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", (nodeWidth / 2).toString());
        text.setAttribute("y", "25");
        text.setAttribute("text-anchor", "middle");
        text.setCssProps({ "pointer-events": "none" });

        const maxLength = this.settings.maxNodeLength;
        if (node.text.length > maxLength) {
            text.textContent = node.text.substring(0, maxLength) + "...";
        } else {
            text.textContent = node.text;
        }
        text.classList.add("mindmap-node-text");

        if (this.settings.showHoverPreview && node.text.length > maxLength) {
            this.registerDomEvent(nodeG as unknown as HTMLElement, "mouseenter", (e: MouseEvent) => {
                if (this.currentTooltip) this.currentTooltip.remove();

                this.currentTooltip = document.body.createEl("div", { cls: "mindmap-tooltip", text: node.text });
                this.currentTooltip.setCssProps({
                    "left": `${e.clientX + 15}px`,
                    "top": `${e.clientY + 15}px`
                });

                const onMouseMove = (moveEvent: MouseEvent) => {
                    if (this.currentTooltip) {
                        this.currentTooltip.setCssProps({
                            "left": `${moveEvent.clientX + 15}px`,
                            "top": `${moveEvent.clientY + 15}px`
                        });
                    }
                };

                const onMouseLeave = () => {
                    if (this.currentTooltip) {
                        this.currentTooltip.remove();
                        this.currentTooltip = null;
                    }
                    window.removeEventListener("mousemove", onMouseMove);
                    nodeG.removeEventListener("mouseleave", onMouseLeave);
                };

                window.addEventListener("mousemove", onMouseMove);
                nodeG.addEventListener("mouseleave", onMouseLeave);
            });
        }

        nodeG.appendChild(rect);
        nodeG.appendChild(text);

        // --- Drag Indicators (Always present but hidden) ---
        // Child indicator
        const childPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const r = 24;
        const cx = nodeWidth - 20;
        const cy = 20;
        const startAngle = -Math.PI / 12;
        const endAngle = Math.PI / 12;
        const d = `M ${cx + r * Math.cos(startAngle)},${cy + r * Math.sin(startAngle)} A ${r},${r} 0 0 1 ${cx + r * Math.cos(endAngle)},${cy + r * Math.sin(endAngle)}`;
        childPath.setAttribute("d", d);
        childPath.setAttribute("fill", "none");
        childPath.classList.add("drag-indicator-line", "indicator-child");
        childPath.setCssProps({ "opacity": "0" });

        // Above indicator
        const aboveLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        const lineLen = 80;
        aboveLine.setAttribute("x1", (nodeWidth / 2 - lineLen / 2).toString());
        aboveLine.setAttribute("x2", (nodeWidth / 2 + lineLen / 2).toString());
        aboveLine.setAttribute("y1", (-MindMapView.SIBLING_DROP_GAP / 2).toString());
        aboveLine.setAttribute("y2", (-MindMapView.SIBLING_DROP_GAP / 2).toString());
        aboveLine.classList.add("drag-indicator-line", "indicator-above");
        aboveLine.setCssProps({ "opacity": "0" });

        // Below indicator
        const belowLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        belowLine.setAttribute("x1", (nodeWidth / 2 - lineLen / 2).toString());
        belowLine.setAttribute("x2", (nodeWidth / 2 + lineLen / 2).toString());
        belowLine.setAttribute("y1", (MindMapView.NODE_HEIGHT + MindMapView.SIBLING_DROP_GAP / 2).toString());
        belowLine.setAttribute("y2", (MindMapView.NODE_HEIGHT + MindMapView.SIBLING_DROP_GAP / 2).toString());
        belowLine.classList.add("drag-indicator-line", "indicator-below");
        belowLine.setCssProps({ "opacity": "0" });

        // --- Drag Indicators (Appended after to be on top) ---
        nodeG.appendChild(childPath);
        nodeG.appendChild(aboveLine);
        nodeG.appendChild(belowLine);

        this.g.appendChild(nodeG);
    }

    /** Align edit overlay to the rendered node rect (stable across pan/zoom). */
    private positionEditInput(input: HTMLInputElement, node: MindMapNode) {
        const container = this.svgContainerEl;
        if (!container) return;

        const nodeEl = this.svg?.querySelector(`[data-node-id="${node.id}"]`);
        if (nodeEl instanceof SVGGElement) {
            const nodeBounds = nodeEl.getBoundingClientRect();
            const containerBounds = container.getBoundingClientRect();
            const height = nodeBounds.height > 0 ? nodeBounds.height : MindMapView.NODE_HEIGHT * this.zoom;
            input.setCssProps({
                "position": "absolute",
                "left": `${nodeBounds.left - containerBounds.left}px`,
                "top": `${nodeBounds.top - containerBounds.top}px`,
                "width": `${nodeBounds.width}px`,
                "height": `${height}px`,
                "font-size": `${Math.max(16, 14 * (height / MindMapView.NODE_HEIGHT))}px`,
                "z-index": "20",
            });
            return;
        }

        const nodeWidth = this.getNodeWidth(node.text);
        input.setCssProps({
            "position": "absolute",
            "left": `${this.panX + (node.x ?? 0) * this.zoom}px`,
            "top": `${this.panY + (node.y ?? 0) * this.zoom}px`,
            "width": `${nodeWidth * this.zoom}px`,
            "height": `${MindMapView.NODE_HEIGHT * this.zoom}px`,
            "font-size": `${Math.max(16, 14 * this.zoom)}px`,
            "z-index": "20",
        });
    }

    private teardownEditInput() {
        if (this.editViewportResizeHandler) {
            window.visualViewport?.removeEventListener("resize", this.editViewportResizeHandler);
            this.editViewportResizeHandler = null;
        }
        if (this.editInputEl?.parentNode) {
            this.editInputEl.parentNode.removeChild(this.editInputEl);
        }
        this.editInputEl = null;
        this.isEditing = false;
    }

    editNode(node: MindMapNode, fallbackOnEmpty?: string) {
        const container = this.containerEl.querySelector(".mindmap-svg-container");
        if (!(container instanceof HTMLElement)) return;

        this.teardownEditInput();
        this.isEditing = true;
        const input = document.createElement("input");
        input.type = "text";
        input.value = node.text;
        input.classList.add("mindmap-edit-input");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("autocorrect", "off");
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("spellcheck", "false");

        container.appendChild(input);
        this.editInputEl = input;
        this.positionEditInput(input, node);

        this.editViewportResizeHandler = () => {
            if (this.editInputEl) {
                this.positionEditInput(this.editInputEl, node);
            }
        };
        window.visualViewport?.addEventListener("resize", this.editViewportResizeHandler);

        const editOpenedAt = Date.now();
        input.focus({ preventScroll: true });
        input.select();

        const save = async () => {
            if (!this.isEditing) return;
            this.teardownEditInput();
            this.pushHistory();
            const oldText = node.text;
            let newText = input.value;

            if (newText.trim() === "" && fallbackOnEmpty) {
                newText = fallbackOnEmpty;
            }

            // Bidirectional renaming: if it's a wikilink, rename the file too
            const oldWikiMatch = oldText.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
            const newWikiMatch = newText.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);

            if (oldWikiMatch && newWikiMatch) {
                const oldFileName = oldWikiMatch[1];
                const newFileName = newWikiMatch[1];

                if (oldFileName !== newFileName) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(oldFileName, "");
                    if (file instanceof TFile) {
                        this.plugin.isInternalRenaming = true;
                        try {
                            const folder = file.parent ? file.parent.path : "";
                            const newPath = folder ? `${folder}/${newFileName}.md` : `${newFileName}.md`;

                            // Check if path actually changed
                            if (newPath !== file.path) {
                                const destinationFile = this.app.vault.getAbstractFileByPath(newPath);
                                if (destinationFile) {
                                    new Notice(`Cannot rename note: "${newFileName}.md" already exists.`);
                                } else {
                                    await this.app.vault.rename(file, newPath);
                                }
                            }
                        } catch (e) {
                            if (!e.message.includes("already exists")) {
                                new Notice(`Failed to rename linked note: ${e.message}`);
                            }
                        } finally {
                            // Delay resetting the flag to let events clear
                            setTimeout(() => { this.plugin.isInternalRenaming = false; }, 100);
                        }
                    }
                }
            }

            node.text = newText;
            this.render();
            void this.saveMindMap(true);
            setTimeout(() => this.focusContainer(), 50);
        };

        const cancel = () => {
            if (!this.isEditing) return;
            this.teardownEditInput();
            this.render();
            setTimeout(() => this.focusContainer(), 50);
        };

        input.addEventListener("blur", () => {
            // Ignore focus loss right after open (e.g. context menu dismiss on iPad).
            if (Date.now() - editOpenedAt < 300) {
                requestAnimationFrame(() => {
                    if (this.editInputEl === input && this.isEditing) {
                        input.focus({ preventScroll: true });
                    }
                });
                return;
            }
            if (this.isEditing) void save();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.suppressHotkeysUntil = Date.now() + 150;
                void save();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.suppressHotkeysUntil = Date.now() + 150;
                cancel();
            }
        });
    }

    async onClose() {
        if (this.boundWindowKeyDown) {
            window.removeEventListener("keydown", this.boundWindowKeyDown, false);
            this.boundWindowKeyDown = null;
        }
        this.teardownEditInput();
    }

    openNoteSearch() {
        if (!this.selectedNodeId) return;
        const node = this.findNodeById(this.mindMapData.root, this.selectedNodeId);
        if (!node) return;

        new NoteSuggestModal(this.app, (file) => {
            this.pushHistory();
            node.text = `[[${file.basename}]]`;
            this.render();
            const container = this.containerEl.querySelector(".mindmap-svg-container");
            if (container instanceof HTMLElement) container.focus();
        }).open();
    }

    async createNoteFromNode() {
        if (!this.selectedNodeId) return;
        const node = this.findNodeById(this.mindMapData.root, this.selectedNodeId);
        if (!node) return;

        let fileName = node.text.replace(/\[\[(.*?)\]\]/, "$1").trim();
        if (!fileName) return;

        const folder = this.settings.exportFolder || "";
        await this.ensureFolderExists(folder);

        const path = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

        try {
            let file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                file = await this.app.vault.create(path, "");
            }

            if (file instanceof TFile) {
                this.pushHistory();
                node.text = `[[${file.basename}]]`;
                this.render();
                void this.saveMindMap(true);
                await this.app.workspace.getLeaf("tab").openFile(file);
                new Notice(`New note created and linked: ${file.basename}`);
            }
        } catch (e) {
            new Notice(`Error creating note: ${e.message}`);
        }
    }

    renameFile() {
        if (!this.file) return;

        const headerTitle = this.containerEl.closest(".workspace-leaf")?.querySelector(".view-header-title");
        if (!(headerTitle instanceof HTMLElement)) {
            new RenameModal(this.app, this.file.basename, (newName) => {
                const file = this.file;
                if (file && newName && newName !== file.basename) {
                    const folderPath = file.parent?.path;
                    const newPath = (!folderPath || folderPath === "/") ? `${newName}.mindmap` : `${folderPath}/${newName}.mindmap`;
                    void this.app.vault.rename(file, newPath);
                }
            }).open();
            return;
        }

        // Simulate native in-place editing
        headerTitle.contentEditable = "true";
        headerTitle.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(headerTitle);
        selection?.removeAllRanges();
        selection?.addRange(range);

        let isRenaming = false;
        const finishRename = async () => {
            if (isRenaming) return;
            isRenaming = true;

            headerTitle.contentEditable = "false";
            const newName = headerTitle.innerText.trim();
            const file = this.file;
            if (newName && file && newName !== file.basename) {
                const folderPath = file.parent?.path;
                const newPath = (!folderPath || folderPath === "/")
                    ? `${newName}.mindmap`
                    : `${folderPath}/${newName}.mindmap`;

                try {
                    // Check if destination exists before renaming to provide better error or avoid conflict
                    if (this.app.vault.getAbstractFileByPath(newPath)) {
                        new Notice("A file with this name already exists.");
                        headerTitle.innerText = file.basename;
                        return;
                    }
                    await this.app.vault.rename(file, newPath);
                } catch (e) {
                    new Notice(`Rename failed: ${e.message}`);
                    if (this.file) headerTitle.innerText = this.file.basename;
                }
            } else {
                if (this.file) headerTitle.innerText = this.file.basename;
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                headerTitle.blur(); // This will trigger finishRename via the blur listener
            } else if (e.key === "Escape") {
                e.preventDefault();
                isRenaming = true; // Use guard to skip finishRename on blur
                headerTitle.contentEditable = "false";
                if (this.file) headerTitle.innerText = this.file.basename;
                headerTitle.blur();
            }
        };

        this.registerDomEvent(headerTitle, "keydown", onKeyDown);

        this.registerDomEvent(headerTitle, "blur", () => {
            void finishRename();
        }, { once: true });
    }

    async openLinkedNote() {
        if (!this.selectedNodeId) return;
        const node = this.findNodeById(this.mindMapData.root, this.selectedNodeId);
        if (!node) return;

        const wikiLinkMatch = node.text.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
        if (wikiLinkMatch) {
            const fileName = wikiLinkMatch[1];
            const file = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(file);
            } else {
                new Notice(`File not found: ${fileName}`);
            }
        } else {
            new Notice("No linked note found in this node.");
        }
    }
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
    onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(file);
    }
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
    onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(file);
    }
}

class RenameModal extends Modal {
    newName: string;
    onRename: (newName: string) => void;

    constructor(app: App, currentName: string, onRename: (newName: string) => void) {
        super(app);
        this.newName = currentName;
        this.onRename = onRename;
    }

    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName("Rename mind map").setHeading();
        new Setting(contentEl).setName("New name").addText((text) =>
            text.setValue(this.newName).onChange((value) => (this.newName = value))
        );
        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Rename")
                .setCta()
                .onClick(() => {
                    void this.onRename(this.newName);
                    this.close();
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

