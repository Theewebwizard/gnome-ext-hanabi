/**
 * Copyright (C) 2023 Jeff Shee (jeffshee8969@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Graphene from 'gi://Graphene';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Logger from './logger.js';
import * as RoundedCornersEffect from './roundedCornersEffect.js';

const applicationId = 'io.github.jeffshee.HanabiRenderer';
const logger = new Logger.Logger();
// Ref: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/layout.js
const BACKGROUND_FADE_ANIMATION_TIME = 1000;

// const CUSTOM_BACKGROUND_BOUNDS_PADDING = 2;

/**
 * The widget that holds the window preview of the renderer.
  */
export const LiveWallpaper = GObject.registerClass(
    class LiveWallpaper extends Clutter.Actor {
        constructor(backgroundActor, extension) {
            super({
                opacity: 0,
            });
            this._backgroundActor = backgroundActor;
            this._metaBackgroundGroup = backgroundActor.get_parent();
            this._monitorIndex = backgroundActor.monitor;

            this._isDisposed = false;
            this._timeoutId = null;

            this._settings = extension.settings;
            this._rendererProxy = extension.getPlaybackState()._renderer;

            if (this._settings.get_boolean('interactive')) {
                this.reactive = true;
                // Disable graphics offload to prevent gbm_surface_lock_front_buffer errors
                // This is especially important for multi-monitor / hybrid GPU setups
                if ('allow_graphics_offload' in this) {
                    this.allow_graphics_offload = false;
                }
                this.connect('button-press-event', (actor, event) => {
                    this._onMouseEvent('mousedown', event);
                    return Clutter.EVENT_PROPAGATE;
                });
                this.connect('button-release-event', (actor, event) => {
                    this._onMouseEvent('mouseup', event);
                    return Clutter.EVENT_PROPAGATE;
                });
                this.connect('motion-event', (actor, event) => {
                    this._onMouseEvent('mousemove', event);
                    return Clutter.EVENT_PROPAGATE;
                });
            }

            this.connect('destroy', () => {
                this._isDisposed = true;
                if (this._timeoutId) {
                    GLib.Source.remove(this._timeoutId);
                    this._timeoutId = null;
                }
                // Clear constraints and remove from parent to prevent GPU leaks
                this.clear_constraints();
                if (this.get_parent()) {
                    this.get_parent().remove_child(this);
                }
                if (this._wallpaper) {
                    this._wallpaper.source = null;
                    this._wallpaper.destroy();
                    this._wallpaper = null;
                }
            });

            this._display = backgroundActor.meta_display;
            this._monitorScale = this._display.get_monitor_scale(
                this._monitorIndex
            );
            let {width, height} =
                Main.layoutManager.monitors[this._monitorIndex];
            this._monitorWidth = width;
            this._monitorHeight = height;

            // Add as sibling above the static background, but inside the same group
            this._metaBackgroundGroup.insert_child_above(this, backgroundActor);
            
            // Sync size and position perfectly with the background actor
            this.add_constraint(new Clutter.BindConstraint({
                source: backgroundActor,
                coordinate: Clutter.BindCoordinate.ALL,
            }));

            this._wallpaper = null;
            this._applyWallpaper();

            this._roundedCornersEffect =
                new RoundedCornersEffect.RoundedCornersEffect();
            
            this.setPixelStep(this._monitorWidth, this._monitorHeight);
            this.setRoundedClipRadius(0.0);
            this.setRoundedClipBounds(0, 0, this._monitorWidth, this._monitorHeight);
        }

        setPixelStep(width, height) {
            if (this._isDisposed) return;
            try {
                this._roundedCornersEffect.setPixelStep([
                    1.0 / (width * this._monitorScale),
                    1.0 / (height * this._monitorScale),
                ]);
            } catch (e) {
                // Ignore if disposed
            }
        }

        setRoundedClipRadius(radius) {
            if (this._isDisposed) return;
            try {
                this._roundedCornersEffect.setClipRadius(
                    radius * this._monitorScale
                );
            } catch (e) {
                // Ignore if disposed
            }
        }

        setRoundedClipBounds(x1, y1, x2, y2) {
            if (this._isDisposed) return;
            try {
                this._roundedCornersEffect.setBounds(
                    [x1, y1, x2, y2].map(e => e * this._monitorScale)
                );
            } catch (e) {
                // Ignore if disposed
            }
        }

        _applyWallpaper() {
            logger.debug('Applying wallpaper...');
            const operation = () => {
                if (this._isDisposed) {
                    logger.debug('LiveWallpaper disposed, stopping wallpaper operation');
                    return false;
                }

                try {
                    const renderer = this._getRenderer();
                    if (renderer) {
                        this._wallpaper = new Clutter.Clone({
                            source: renderer,
                            // The point around which the scaling and rotation transformations occur.
                            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                            x_expand: true,
                            y_expand: true,
                            x_align: Clutter.ActorAlign.FILL,
                            y_align: Clutter.ActorAlign.FILL,
                        });
                        this._wallpaper.connect('destroy', () => {
                            this._wallpaper = null;
                        });
                        this._wallpaper.source.connect('destroy', () => {
                            if (this._wallpaper) {
                                this._wallpaper.destroy();
                            }
                            // Restart the loop if our source is destroyed
                            this._applyWallpaper();
                        });
                        this.add_child(this._wallpaper);
                        this._fade();
                        logger.debug('Wallpaper applied');
                        // Stop this specific timeout instance, but we've queued a restart on source destruction.
                        return false;
                    } else {
                        // Keep waiting.
                        return true;
                    }
                } catch (e) {
                    logger.debug(`Could not apply wallpaper (possibly disposed): ${e}`);
                    return false;
                }
            };

            // Perform intial operation without timeout
            if (operation()) {
                this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, operation);
            }
        }

        _getRenderer() {
            let windowActors = global.get_window_actors(false);

            const hanabiWindowActors = windowActors.filter(window => {
                let title = window.meta_window.title || "";
                return title.includes(applicationId);
            });

            if (hanabiWindowActors.length === 0) {
                // Log only occasionally or on change to avoid spam
                logger.debug(`Searching for renderer: ${applicationId}. Current windows: ${windowActors.map(w => w.meta_window.title).join(', ')}`);
            }

            // Find renderer by `applicationId` and monitor index.
            // We use the monitor index from the backgroundActor dynamically to handle re-indexing.
            const renderer = hanabiWindowActors.find(
                window => window.meta_window.get_monitor() === this._backgroundActor.monitor
            );

            if (!renderer) {
                logger.debug(`No renderer found for monitor ${this._backgroundActor.monitor}. Found actors for monitors: ${hanabiWindowActors.map(w => w.meta_window.get_monitor())}`);
            }

            return renderer ?? null;
        }

        _fade(visible = true) {
            if (this._isDisposed) return;
            try {
                this.ease({
                    opacity: visible ? 255 : 0,
                    duration: BACKGROUND_FADE_ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } catch (e) {
                logger.debug(`Could not fade wallpaper (possibly disposed): ${e}`);
            }
        }

        _onMouseEvent(type, event) {
            if (!this._rendererProxy) return;
            let [x, y] = event.get_coords();
            logger.debug(`Mouse event: ${type} at (${x}, ${y}) for monitor ${this._monitorIndex}`);

            // Throttle motion events to ~60fps (16.6ms) to avoid D-Bus bottleneck
            if (type === 'mousemove') {
                let now = GLib.get_monotonic_time();
                if (this._lastMotionTime && (now - this._lastMotionTime) < 16666)
                    return;
                this._lastMotionTime = now;
            }
            let monitor = Main.layoutManager.monitors[this._monitorIndex];
            
            // global -> monitor-local
            x -= monitor.x;
            y -= monitor.y;

            // In some environments, we might need to adjust for the monitor's scale factor
            // if the renderer window is not matching the shell's logical scaling.
            // But usually Clutter events and WebKit both work in logical pixels.

            let button = 0;
            if (type === 'mousedown' || type === 'mouseup') {
                button = event.get_button();
            }

            this._rendererProxy.sendMouseEvent(type, x, y, button);
        }
    }
);
