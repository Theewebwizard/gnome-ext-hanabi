
function checkShell() {
    let uiGroup = global.window_group.get_parent();
    let children = uiGroup.get_children();
    log("UI Group Children:");
    for (let child of children) {
        log(`  - ${child.toString()} (visible: ${child.visible}, opacity: ${child.opacity})`);
    }

    let panelBox = Main.layoutManager.panelBox;
    log(`PanelBox parent: ${panelBox.get_parent().toString()}`);
    log(`PanelBox position: ${panelBox.x}, ${panelBox.y} size: ${panelBox.width}x${panelBox.height}`);

    let backgroundGroup = Main.layoutManager._backgroundGroup;
    log(`BackgroundGroup parent: ${backgroundGroup.get_parent().toString()}`);
    
    let actors = global.get_window_actors(false);
    for (let actor of actors) {
        if (actor.meta_window.title?.includes("HanabiRenderer")) {
            log(`Hanabi Actor: ${actor.toString()} parent: ${actor.get_parent().toString()}`);
        }
    }
}
checkShell();
