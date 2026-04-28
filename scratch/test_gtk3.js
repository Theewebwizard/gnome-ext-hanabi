#!/usr/bin/env gjs
imports.gi.versions.Gtk = '3.0';
const {Gtk, GLib} = imports.gi;

Gtk.init(null);

let win = new Gtk.Window({
    title: 'io.github.jeffshee.HanabiRenderer.Web',
    default_width: 800,
    default_height: 600
});

let label = new Gtk.Label({label: 'GTK3 Web Renderer Placeholder'});
win.add(label);

win.connect('destroy', () => Gtk.main_quit());
win.show_all();

Gtk.main();
