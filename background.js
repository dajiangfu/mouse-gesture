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

const DEFAULT_EXCLUDED_URLS = [];
const DEFAULT_CONFIRM_CLOSE_WINDOW = true;

const MENU_EXCLUDE_SITE = "mg_exclude_site";
const MENU_EXCLUDE_PAGE = "mg_exclude_page";

function safeParseUrl(u) {
  try {
    return new URL(u);
  } catch (_) {
    return null;
  }
}

async function getConfirmCloseWindow() {
  const { confirmCloseWindow } = await chrome.storage.sync.get({ confirmCloseWindow: DEFAULT_CONFIRM_CLOSE_WINDOW });
  return !!confirmCloseWindow;
}

async function getExcludedUrls() {
  const { excludedUrls } = await chrome.storage.sync.get({ excludedUrls: DEFAULT_EXCLUDED_URLS });
  return Array.isArray(excludedUrls) ? excludedUrls : DEFAULT_EXCLUDED_URLS;
}

async function addExcludedRule(rule) {
  const r = String(rule || "").trim();
  if (!r) return { ok: false, reason: "empty" };

  const list = await getExcludedUrls();
  if (list.includes(r)) return { ok: true, already: true };
  list.push(r);
  await chrome.storage.sync.set({ excludedUrls: list });
  return { ok: true, already: false };
}

function createMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      // 在页面右键菜单里放两项
      chrome.contextMenus.create({
        id: MENU_EXCLUDE_SITE,
        title: "鼠标手势：将此网站加入排除列表",
        contexts: ["page"]
      });
      chrome.contextMenus.create({
        id: MENU_EXCLUDE_PAGE,
        title: "鼠标手势：将此页面加入排除列表",
        contexts: ["page"]
      });
    });
  } catch (_) {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(() => createMenus());
chrome.runtime.onStartup.addListener(() => createMenus());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    const pageUrl = info?.pageUrl || tab?.url;
    const u = safeParseUrl(pageUrl);
    if (!u) return;

    // 仅对常见可注入页面生效
    if (!/^https?:$/.test(u.protocol) && u.protocol !== "file:") return;

    if (info.menuItemId === MENU_EXCLUDE_SITE) {
      // 站点级：存 hostname（选项页里会按“域名规则”匹配）
      await addExcludedRule(u.hostname);
    } else if (info.menuItemId === MENU_EXCLUDE_PAGE) {
      // 页面级：精确 URL
      await addExcludedRule(u.href);
    }
  })();
});

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
            const needConfirm = await getConfirmCloseWindow();
            if (needConfirm) {
              try {
                const resp = await chrome.tabs.sendMessage(tab.id, { type: "CONFIRM_CLOSE_WINDOW" });
                if (!resp || resp.ok !== true) break; // 用户取消
              } catch (e) {
                // 无法弹窗确认时，为避免误关，直接不执行关闭
                break;
              }
            }
            const winId = tab.windowId;
            if (typeof winId === "number") await chrome.windows.remove(winId);
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
