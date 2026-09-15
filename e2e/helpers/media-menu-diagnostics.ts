import { Logger } from '../../src/logger.js';

interface MenuTraceWindow extends Window {
  stopMediaMenuTrace?: () => unknown[];
}

/** Record the actual event order when a media action disappears in CI. */
export async function withMediaMenuDiagnostics(action: () => Promise<void>): Promise<void> {
  await browser.execute(() => {
    const traceWindow = window as MenuTraceWindow;
    traceWindow.stopMediaMenuTrace?.();
    const entries: unknown[] = [];
    const identities = new WeakMap<Node, number>();
    let nextIdentity = 0;
    const identify = (node: EventTarget | null) => {
      if (!(node instanceof Node)) return 'window';
      if (!identities.has(node)) identities.set(node, ++nextIdentity);
      return `${node.nodeName}#${node instanceof Element ? node.id : ''}@${identities.get(node)}`;
    };
    const record = (type: string, target: EventTarget | null, trusted?: boolean) => {
      const button = document.getElementById('btn-media-overflow');
      const menu = document.querySelector('.popup-menu');
      const scroller = document.getElementById('view-container');
      entries.push({
        time: performance.now(), type, target: identify(target), trusted,
        button: button ? identify(button) : null,
        buttonRect: button?.getBoundingClientRect().toJSON(),
        expanded: button?.getAttribute('aria-expanded'),
        menu: menu ? identify(menu) : null,
        viewport: [innerWidth, innerHeight],
        scroll: [scroller?.scrollLeft, scroller?.scrollTop],
      });
      if (entries.length > 100) entries.shift();
    };
    const events = ['pointerdown', 'pointerup', 'click', 'scroll', 'resize', 'blur'];
    const onEvent = (event: Event) => record(event.type, event.target, event.isTrusted);
    for (const type of events) window.addEventListener(type, onEvent, true);
    const relevant = (node: Node) => node instanceof Element && (
      node.matches('#btn-media-overflow, .popup-menu')
      || node.querySelector('#btn-media-overflow, .popup-menu') !== null
    );
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if ([...mutation.addedNodes, ...mutation.removedNodes].some(relevant)) {
          record('menu/header DOM change', mutation.target);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    record('start', null);
    traceWindow.stopMediaMenuTrace = () => {
      for (const type of events) window.removeEventListener(type, onEvent, true);
      observer.disconnect();
      delete traceWindow.stopMediaMenuTrace;
      return entries;
    };
  });

  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const trace = await browser.execute(() => (
      (window as MenuTraceWindow).stopMediaMenuTrace?.() ?? []
    )).catch(() => []);
    if (failed) Logger.error('[media-menu] Failure event trace:', JSON.stringify(trace));
  }
}
