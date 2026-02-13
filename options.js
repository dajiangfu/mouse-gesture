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

const DEFAULT_CONFIRM_CLOSE_WINDOW = true;
const DEFAULT_SHOW_TRAIL = true;

const ACTIONS = [
  ["none", "无动作"],
  ["scrollDown", "向下滚动"],
  ["scrollUp", "向上滚动"],
  ["scrollTop", "滚动到顶部"],
  ["scrollBottom", "滚动到底部"],
  ["back", "后退"],
  ["forward", "前进"],
  ["reload", "刷新标签页"],
  ["closeTab", "关闭当前标签页"],
  ["reopenTab", "恢复最近关闭的标签页"],
  ["tabLeft", "切换到左侧标签页"],
  ["tabRight", "切换到右侧标签页"],
  ["closeWindow", "关闭当前窗口"]
];


const tbody = document.getElementById("tbody");
const statusEl = document.getElementById("status");
const excludedEl = document.getElementById("excludedUrls");
const confirmEl = document.getElementById("confirmCloseWindow");
const trailEl = document.getElementById("showTrail");

function setStatus(t) {
  statusEl.textContent = t || "";
  if (t) setTimeout(() => (statusEl.textContent = ""), 1200);
}

function rowTemplate(gesture, action) {
  const tr = document.createElement("tr");

  const tdG = document.createElement("td");
  const input = document.createElement("input");
  input.value = gesture;
  input.placeholder = "e.g. L, DR, UDL";
  tdG.appendChild(input);

  const tdA = document.createElement("td");
  const sel = document.createElement("select");
  for (const [v, label] of ACTIONS) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = action || "none";
  tdA.appendChild(sel);

  tr.appendChild(tdG);
  tr.appendChild(tdA);

  return { tr, input, sel };
}

async function load() {
  const { gestureMap, excludedUrls, confirmCloseWindow, showTrail } = await chrome.storage.sync.get({
    gestureMap: DEFAULT_MAP,
    excludedUrls: [],
    confirmCloseWindow: DEFAULT_CONFIRM_CLOSE_WINDOW,
    showTrail: DEFAULT_SHOW_TRAIL
  });
  tbody.innerHTML = "";

  // 展示已有项
  for (const [g, a] of Object.entries(gestureMap)) {
    const { tr } = rowTemplate(g, a);
    tbody.appendChild(tr);
  }

  // 再给几行空白，方便新增
  for (let i = 0; i < 5; i++) {
    const { tr } = rowTemplate("", "none");
    tbody.appendChild(tr);
  }

  // 排除网址
  const lines = Array.isArray(excludedUrls) ? excludedUrls : [];
  excludedEl.value = lines.join("\n");
  if (confirmEl) confirmEl.checked = !!confirmCloseWindow;
  if (trailEl) trailEl.checked = !!showTrail;
}

function collect() {
  const map = {};
  for (const tr of tbody.querySelectorAll("tr")) {
    const input = tr.querySelector("input");
    const sel = tr.querySelector("select");
    const g = (input.value || "").trim().toUpperCase();
    const a = sel.value;
    if (!g) continue;
    // 简单校验：只允许 L R U D
    if (!/^[LRUD]{1,8}$/.test(g)) continue;
    map[g] = a;
  }
  return map;
}

function collectExcluded() {
  const raw = (excludedEl.value || "").split(/\r?\n/);
  const list = [];
  for (const line of raw) {
    const s = String(line || "").trim();
    if (!s) continue;
    if (s.startsWith("#")) continue;
    list.push(s);
  }
  return list;
}

document.getElementById("btnSave").addEventListener("click", async () => {
  const map = collect();
  const excludedUrls = collectExcluded();
  const confirmCloseWindow = confirmEl ? !!confirmEl.checked : DEFAULT_CONFIRM_CLOSE_WINDOW;
  const showTrail = trailEl ? !!trailEl.checked : DEFAULT_SHOW_TRAIL;
  await chrome.storage.sync.set({ gestureMap: map, excludedUrls, confirmCloseWindow, showTrail });
  setStatus("Saved.");
});

document.getElementById("btnReset").addEventListener("click", async () => {
  await chrome.storage.sync.set({ gestureMap: DEFAULT_MAP, excludedUrls: [], confirmCloseWindow: DEFAULT_CONFIRM_CLOSE_WINDOW, showTrail: DEFAULT_SHOW_TRAIL });
  await load();
  setStatus("Reset.");
});

async function exportConfig() {
  const data = await chrome.storage.sync.get({
    gestureMap: DEFAULT_MAP,
    excludedUrls: [],
    confirmCloseWindow: DEFAULT_CONFIRM_CLOSE_WINDOW,
    showTrail: DEFAULT_SHOW_TRAIL
  });

  const payload = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    gestureMap: data.gestureMap || DEFAULT_MAP,
    excludedUrls: Array.isArray(data.excludedUrls) ? data.excludedUrls : [],
    confirmCloseWindow: data.confirmCloseWindow ?? DEFAULT_CONFIRM_CLOSE_WINDOW,
    showTrail: data.showTrail ?? DEFAULT_SHOW_TRAIL
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mouse-gesture-config.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importConfigFromText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error("文件不是有效的 JSON。");
  }

  const map = obj?.gestureMap;
  const excluded = obj?.excludedUrls;
  let confirmCloseWindow = obj?.confirmCloseWindow;
  let showTrail = obj?.showTrail;

  // 兼容导入时被序列化成字符串/数字的情况
  if (typeof confirmCloseWindow === "string") {
    const v = confirmCloseWindow.trim().toLowerCase();
    if (v === "true") confirmCloseWindow = true;
    else if (v === "false") confirmCloseWindow = false;
  }
  if (typeof confirmCloseWindow === "number") confirmCloseWindow = !!confirmCloseWindow;

  if (typeof showTrail === "string") {
    const v = showTrail.trim().toLowerCase();
    if (v === "true") showTrail = true;
    else if (v === "false") showTrail = false;
  }
  if (typeof showTrail === "number") showTrail = !!showTrail;

  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("配置缺少 gestureMap 或格式不正确。");
  }

  const cleanedMap = {};
  for (const [k, v] of Object.entries(map)) {
    const g = String(k || "").trim().toUpperCase();
    if (!/^[LRUD]{1,8}$/.test(g)) continue;
    cleanedMap[g] = String(v || "none");
  }

  const cleanedExcluded = Array.isArray(excluded)
    ? excluded.map(s => String(s || "").trim()).filter(Boolean)
    : [];

  await chrome.storage.sync.set({
    gestureMap: cleanedMap,
    excludedUrls: cleanedExcluded,
    confirmCloseWindow: confirmCloseWindow ?? DEFAULT_CONFIRM_CLOSE_WINDOW,
    showTrail: showTrail ?? DEFAULT_SHOW_TRAIL
  });
  await load();
}

document.getElementById("btnExport").addEventListener("click", async () => {
  try {
    await exportConfig();
    setStatus("Exported.");
  } catch (e) {
    console.error(e);
    setStatus("Export failed.");
  }
});

const importFileEl = document.getElementById("importFile");
document.getElementById("btnImport").addEventListener("click", () => {
  importFileEl.value = "";
  importFileEl.click();
});

importFileEl.addEventListener("change", async () => {
  const file = importFileEl.files && importFileEl.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importConfigFromText(text);
    setStatus("Imported.");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || "Import failed.");
  }
});


load();
