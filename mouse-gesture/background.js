const DEFAULT_MAP = {
  D: "scrollDown",
  U: "scrollUp",
  DU: "scrollTop",
  UD: "scrollBottom",
  DR: "closeTab",
  DL: "reopenTab",
  UL: "tabLeft",
  UR: "tabRight",
  R: "forward",
  L: "back",
  RL: "reload",
  DRUL: "closeWindow"
};

async function getMap() {
  const { gestureMap } = await chrome.storage.sync.get({ gestureMap: DEFAULT_MAP });
  return gestureMap || DEFAULT_MAP;
}

async function activateNeighborTab(senderTab, dir /* -1 left, +1 right */) {
  const winId = senderTab.windowId;
  const tabs = await chrome.tabs.query({ windowId: winId });
  if (!tabs || !tabs.length) return;

  let i = tabs.findIndex((t) => t.id === senderTab.id);
  if (i < 0) i = tabs.findIndex((t) => t.active);
  if (i < 0) i = 0;

  const next = (i + dir + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[next].id, { active: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.type !== "GESTURE") return;

    const map = await getMap();
    const action = map[msg.gesture] || "none";

    const tab = sender && sender.tab;
    if (!tab || typeof tab.id !== "number") {
      sendResponse({ ok: false, error: "No sender tab" });
      return;
    }

    try {
      switch (action) {
        case "back":
          await chrome.tabs.goBack(tab.id);
          break;
        case "forward":
          await chrome.tabs.goForward(tab.id);
          break;
        case "reload":
          await chrome.tabs.reload(tab.id);
          break;
        case "closeTab":
          await chrome.tabs.remove(tab.id);
          break;
        case "reopenTab":
          await chrome.sessions.restore();
          break;
        case "tabLeft":
          await activateNeighborTab(tab, -1);
          break;
        case "tabRight":
          await activateNeighborTab(tab, +1);
          break;
        case "closeWindow":
          {
            const win = await chrome.windows.getCurrent();
            if (win?.id != null) await chrome.windows.remove(win.id);
          }
          break;


        // scroll* 由 content.js 直接做
        case "scrollDown":
        case "scrollUp":
        case "scrollTop":
        case "scrollBottom":
        case "none":
        default:
          break;
      }

      sendResponse({ ok: true, action });
    } catch (e) {
      sendResponse({ ok: false, action, error: String(e) });
    }
  })();

  return true;
});
