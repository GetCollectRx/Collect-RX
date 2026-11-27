'use strict';

/**
 * The desktop half of the "a rep is on the line" alert. The page shows the
 * banner; this makes sure someone who is in another window, or has the app
 * hidden in the tray, still notices.
 *
 * The notification text is fixed and generic on purpose: an operating system
 * notification can appear on a locked screen or a shared monitor, so claim and
 * carrier details only ever show inside the app window.
 */

const NOTIFICATION_TITLE = 'CollectRx';
const NOTIFICATION_BODY = 'A carrier rep is on the line. Open CollectRx to take the call.';

/**
 * @param {{ Notification: { isSupported: () => boolean, new (opts: object): { show: () => void, close: () => void, on: (event: string, cb: () => void) => void } }, getWindow: () => (null | { isMinimized: () => boolean, restore: () => void, show: () => void, focus: () => void, flashFrame: (flag: boolean) => void }) }} deps
 */
function createHandoffNudge(deps) {
  let active = null;

  function bringForward(win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function clear() {
    if (active) {
      active.close();
      active = null;
    }
    const win = deps.getWindow();
    if (win) win.flashFrame(false);
  }

  function show() {
    // A newer rep replaces an older notification: the newest call is the live one.
    clear();
    const win = deps.getWindow();
    if (win) {
      win.flashFrame(true);
      bringForward(win);
    }
    if (!deps.Notification.isSupported()) return;
    // Stays until clicked or until the page clears it on acknowledge or expiry.
    const notification = new deps.Notification({
      title: NOTIFICATION_TITLE,
      body: NOTIFICATION_BODY,
      urgency: 'critical',
      timeoutType: 'never',
    });
    notification.on('click', () => {
      const target = deps.getWindow();
      if (target) bringForward(target);
    });
    notification.show();
    active = notification;
  }

  return { show, clear };
}

module.exports = { createHandoffNudge, NOTIFICATION_TITLE, NOTIFICATION_BODY };
