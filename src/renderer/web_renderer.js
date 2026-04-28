#!/usr/bin/env gjs

/**
 * Copyright (C) 2024 Jeff Shee (jeffshee8969@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

imports.gi.versions.Gtk = '3.0';
imports.gi.versions.WebKit2 = '4.1';
const {GObject, Gtk, Gio, GLib, Gdk, WebKit2, Gst} = imports.gi;

Gst.init(null);

const applicationId = 'io.github.jeffshee.HanabiRenderer';

let extSettings = null;
const extSchemaId = 'io.github.jeffshee.hanabi-extension';
let settingsSchemaSource = Gio.SettingsSchemaSource.get_default();
if (settingsSchemaSource.lookup(extSchemaId, false))
    extSettings = Gio.Settings.new(extSchemaId);

let codePath = 'src';
let filePath = extSettings ? extSettings.get_string('video-path') : '';
let isDebugMode = extSettings ? extSettings.get_boolean('debug-mode') : true;
let windowDimension = {width: 1920, height: 1080};
let windowed = false;
let nohide = false;

const HanabiWebRenderer = GObject.registerClass(
    {
        GTypeName: 'HanabiWebRenderer',
    },
    class HanabiWebRenderer extends Gtk.Application {
        constructor() {
            super({
                application_id: applicationId,
                flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
            });

            GLib.log_set_debug_enabled(isDebugMode);

            this._hanabiWindows = [];
            this._webViews = [];
            this._isPlaying = true;
            this._exportDbus();

            this.connect('activate', app => {
                this._display = Gdk.Display.get_default();
                this._monitors = [];
                for (let i = 0; i < this._display.get_n_monitors(); i++) {
                    this._monitors.push(this._display.get_monitor(i));
                }

                let activeWindow = app.activeWindow;
                if (!activeWindow) {
                    this._buildUI();
                    this._hanabiWindows.forEach(window => {
                        window.show_all();
                    });
                }
            });

            this.connect('command-line', (app, commandLine) => {
                let argv = commandLine.get_arguments();
                if (this._parseArgs(argv)) {
                    this.activate();
                    commandLine.set_exit_status(0);
                } else {
                    commandLine.set_exit_status(1);
                }
            });
        }

        _parseArgs(argv) {
            let lastCommand = null;
            for (let arg of argv) {
                if (!lastCommand) {
                    switch (arg) {
                    case '-N':
                    case '--nohide':
                        nohide = true;
                        break;
                    case '-W':
                    case '--windowed':
                    case '-P':
                    case '--codepath':
                    case '-F':
                    case '--filepath':
                        lastCommand = arg;
                        break;
                    }
                    continue;
                }
                switch (lastCommand) {
                case '-W':
                case '--windowed': {
                    windowed = true;
                    let data = arg.split(':');
                    windowDimension = {
                        width: parseInt(data[0]),
                        height: parseInt(data[1]),
                    };
                    break;
                }
                case '-P':
                case '--codepath':
                    codePath = arg;
                    break;
                case '-F':
                case '--filepath':
                    filePath = arg;
                    break;
                }
                lastCommand = null;
            }
            return true;
        }

        _buildUI() {
            this._monitors.forEach((gdkMonitor, index) => {
                let webView = new WebKit2.WebView();
                this._webViews.push(webView);

                let settings = webView.get_settings();
                settings.set_enable_webgl(true);
                settings.set_enable_media_stream(true);
                settings.set_allow_file_access_from_file_urls(true);
                settings.set_allow_universal_access_from_file_urls(true);

                let manager = webView.get_user_content_manager();
                // Inject Wallpaper Engine Compatibility Layer & Hanabi Bridge
                const initJs = `
                    window.wallpaperAudioListeners = [];
                    window.wallpaperRegisterAudioListener = function(callback) {
                        window.wallpaperAudioListeners.push(callback);
                    };
                    window.__hanabiDispatch = function(type, x, y, button) {
                        const props = {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: x,
                            clientY: y,
                            screenX: x,
                            screenY: y,
                            pageX: x,
                            pageY: y,
                            button: button,
                            buttons: (type === 'mousedown' || type === 'mousemove') ? 1 : 0,
                            pointerId: 1,
                            isPrimary: true
                        };
                        
                        const mouseEv = new MouseEvent(type, props);
                        const pointerType = type.replace('mouse', 'pointer').replace('down', 'down').replace('up', 'up');
                        const pointerEv = new PointerEvent(pointerType, props);
                        
                        // 1. Dispatch to the specific element at that point
                        const el = document.elementFromPoint(x, y) || document.body;
                        el.dispatchEvent(mouseEv);
                        el.dispatchEvent(pointerEv);

                        // 2. Handle Clicks and Links
                        if (type === 'mouseup') {
                            const clickEv = new MouseEvent('click', props);
                            el.dispatchEvent(clickEv);
                            
                            // Force click for links/buttons if dispatchEvent was ignored
                            let target = el;
                            while (target && target !== document.body) {
                                if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.onclick) {
                                    target.click();
                                    break;
                                }
                                target = target.parentElement;
                            }
                        }

                        // 3. Deep Integration: Force Particles.js internal state if it exists
                        if (window.pJSDom && window.pJSDom.length > 0) {
                            window.pJSDom.forEach(p => {
                                if (p.pJS && p.pJS.interactivity && p.pJS.interactivity.mouse) {
                                    p.pJS.interactivity.mouse.pos_x = x;
                                    p.pJS.interactivity.mouse.pos_y = y;
                                    if (type === 'mousedown') {
                                        p.pJS.interactivity.mouse.click_pos_x = x;
                                        p.pJS.interactivity.mouse.click_pos_y = y;
                                    }
                                }
                            });
                        }
                    };
                `;
                let script = new WebKit2.UserScript(
                    initJs,
                    WebKit2.UserContentInjectedFrames.ALL_FRAMES,
                    WebKit2.UserScriptInjectionTime.START,
                    null,
                    null
                );
                manager.add_script(script);

                if (filePath.startsWith('http') || filePath.startsWith('file://')) {
                    webView.load_uri(filePath);
                } else {
                    let file = Gio.File.new_for_path(filePath);
                    webView.load_uri(file.get_uri());
                }

                let geometry = gdkMonitor.get_geometry();
                let state = {
                    position: [geometry.x, geometry.y],
                    keepAtBottom: true,
                    keepMinimized: false,
                    keepPosition: true,
                };
                let window = new HanabiWebRendererWindow(
                    this,
                    nohide
                        ? `Hanabi Web Renderer #${index}`
                        : `@${applicationId}!${JSON.stringify(state)}|${index}`,
                    webView,
                    gdkMonitor
                );

                this._hanabiWindows.push(window);
            });

            this._setupAudioListener();
        }

        _setupAudioListener() {
            let pipelineStr = 'pulsesrc device=auto ! audioconvert ! spectrum interval=16666666 bands=64 ! fakesink';
            try {
                this._audioPipeline = Gst.parse_launch(pipelineStr);
                let bus = this._audioPipeline.get_bus();
                bus.add_signal_watch();
                bus.connect('message::element', (bus, message) => {
                    const structure = message.get_structure();
                    if (structure && structure.get_name() === 'spectrum') {
                        // Gjs has a bug converting GstValueList (magnitude). 
                        // We use the "String Hack" to bypass the broken type conversion.
                        const str = structure.to_string();
                        const match = str.match(/magnitude=\(float\)\{(.*?)\}/);
                        if (match) {
                            const magnitudes = match[1].split(',').map(s => parseFloat(s.trim()));
                            let normalized = magnitudes.map(db => Math.max(0, (db + 60) / 60));
                            const audioJs = `
                                if (window.wallpaperAudioListeners) {
                                    var data = ${JSON.stringify(normalized)};
                                    window.wallpaperAudioListeners.forEach(cb => cb(data));
                                }
                            `;
                            this._webViews.forEach(v => v.run_javascript(audioJs, null, null));
                        }
                    }
                });
                if (this._isPlaying)
                    this._audioPipeline.set_state(Gst.State.PLAYING);
            } catch (e) {
                console.error('Failed to setup audio listener:', e);
            }
        }

        _exportDbus() {
            const dbusXml = `
            <node>
                <interface name="io.github.jeffshee.HanabiRenderer">
                    <method name="setPlay"/>
                    <method name="setPause"/>
                    <method name="sendMouseEvent">
                        <arg name="type" type="s" direction="in"/>
                        <arg name="x" type="d" direction="in"/>
                        <arg name="y" type="d" direction="in"/>
                        <arg name="button" type="u" direction="in"/>
                    </method>
                    <property name="isPlaying" type="b" access="read"/>
                    <signal name="isPlayingChanged">
                        <arg name="isPlaying" type="b"/>
                    </signal>
                </interface>
            </node>`;

            this._dbus = Gio.DBusExportedObject.wrapJSObject(
                dbusXml,
                this
            );
            this._dbus.export(
                Gio.DBus.session,
                '/io/github/jeffshee/HanabiRenderer'
            );
        }

        setPlay() {
            this._isPlaying = true;
            if (this._audioPipeline)
                this._audioPipeline.set_state(Gst.State.PLAYING);
            this._dbus.emit_signal('isPlayingChanged', new GLib.Variant('(b)', [this._isPlaying]));
        }

        setPause() {
            this._isPlaying = false;
            if (this._audioPipeline)
                this._audioPipeline.set_state(Gst.State.PAUSED);
            this._dbus.emit_signal('isPlayingChanged', new GLib.Variant('(b)', [this._isPlaying]));
        }

        sendMouseEvent(type, x, y, button) {
            let webButton = (button > 0) ? button - 1 : 0;
            const js = `if (window.__hanabiDispatch) window.__hanabiDispatch("${type}", ${x}, ${y}, ${webButton});`;
            this._webViews.forEach(v => v.run_javascript(js, null, null));
        }

        get isPlaying() {
            return this._isPlaying;
        }
    }
);

const HanabiWebRendererWindow = GObject.registerClass(
    {
        GTypeName: 'HanabiWebRendererWindow',
    },
    class HanabiWebRendererWindow extends Gtk.ApplicationWindow {
        constructor(application, title, widget, gdkMonitor) {
            super({
                application,
                decorated: !!nohide,
                title,
            });

            this.add(widget);
            this.set_keep_below(true);
            this.set_skip_taskbar_hint(true);
            this.set_skip_pager_hint(true);
            this.set_type_hint(Gdk.WindowTypeHint.DESKTOP);

            if (!windowed) {
                let geom = gdkMonitor.get_geometry();
                this.set_default_size(geom.width, geom.height);
                this.move(geom.x, geom.y);
                this.fullscreen();
            } else {
                this.set_default_size(windowDimension.width, windowDimension.height);
            }
        }
    }
);

Gtk.init(null);

let renderer = new HanabiWebRenderer();
renderer.run(ARGV);
