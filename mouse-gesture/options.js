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
  const { gestureMap } = await chrome.storage.sync.get({ gestureMap: DEFAULT_MAP });
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

document.getElementById("btnSave").addEventListener("click", async () => {
  const map = collect();
  await chrome.storage.sync.set({ gestureMap: map });
  setStatus("Saved.");
});

document.getElementById("btnReset").addEventListener("click", async () => {
  await chrome.storage.sync.set({ gestureMap: DEFAULT_MAP });
  await load();
  setStatus("Reset.");
});

load();
