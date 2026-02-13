(async () => {
  const MOVE_THRESHOLD = 18;
  const ARM_THRESHOLD = 14;
  const MAX_DIR_LEN = 8;
  const DEFAULT_SHOW_TRAIL = true;
  let showTrail = DEFAULT_SHOW_TRAIL;

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
  
  async function loadShowTrail() {
    if (!hasChromeApi() || !chrome.storage?.sync) {
      showTrail = DEFAULT_SHOW_TRAIL;
      return;
    }
    try {
      const { showTrail: st } = await chrome.storage.sync.get({ showTrail: DEFAULT_SHOW_TRAIL });
      showTrail = !!st;
    } catch (_) {
      showTrail = DEFAULT_SHOW_TRAIL;
    }
  }

  let hideHintTimer = null;

  const ACTION_LABELS_ZH = {
    scrollDown: "向下滚动",
    scrollUp: "向上滚动",
    scrollTop: "滚动到顶部",
    scrollBottom: "滚动到底部",
    closeTab: "关闭当前标签页",
    reopenTab: "恢复最近关闭的标签页",
    tabLeft: "切换到左侧标签页",
    tabRight: "切换到右侧标签页",
    forward: "前进",
    back: "后退",
    reload: "刷新标签页",
	closeWindow: "关闭当前窗口",
    none: "无动作"
  };

  await loadShowTrail();

  // 实时响应设置变化
  if (hasChromeApi() && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.showTrail) {
        showTrail = !!changes.showTrail.newValue;
        if (!showTrail) destroyCanvas();
      }
    });
  }

  function ensureHintEl() {
    let el = document.getElementById("__mg_gesture_hint");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__mg_gesture_hint";
    el.style.cssText = [
      "position: fixed",
      "left: 50%",
      "top: 50%",
      "transform: translate(-50%, -50%)",
      "z-index: 2147483647",
      "padding: 14px 18px",
      "border-radius: 14px",
      "background: rgba(0,0,0,0.78)",
      "backdrop-filter: blur(6px)",
      "color: #fff",
      "font: 700 20px/1.25 system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "letter-spacing: .2px",
      "box-shadow: 0 10px 30px rgba(0,0,0,0.35)",
      "opacity: 0",
      "transition: opacity 120ms ease",
      "pointer-events: none",
      "text-align: center",
      "white-space: nowrap",
      "max-width: 92vw",
      "overflow: hidden",
      "text-overflow: ellipsis"
    ].join(";");
    document.documentElement.appendChild(el);
    return el;
  }

  function showGestureHint(text, isError = false) {
    try {
      const el = ensureHintEl();

      // 取消任何即将隐藏的计时（避免新手势刚开始就被隐藏）
      if (hideHintTimer) {
        clearTimeout(hideHintTimer);
        hideHintTimer = null;
      }

      // 文本
      if (typeof text === "string") el.textContent = text;

      // 样式：失败提示使用红色底
      el.style.background = isError ? "rgba(200, 0, 0, 0.82)" : "rgba(0,0,0,0.78)";

      // 显示（不自动消失；由 mouseup 触发隐藏）
      requestAnimationFrame(() => { el.style.opacity = "1"; });
    } catch (_) {}
  }


  function hideGestureHint(delayMs = 0) {
    try {
      const el = document.getElementById("__mg_gesture_hint");
      if (!el) return;

      if (hideHintTimer) {
        clearTimeout(hideHintTimer);
        hideHintTimer = null;
      }

      if (delayMs > 0) {
        hideHintTimer = setTimeout(() => {
          el.style.opacity = "0";
          hideHintTimer = null;
        }, delayMs);
      } else {
        el.style.opacity = "0";
      }
    } catch (_) {}
  }
  // 这些动作会导致立即切换/关闭页面；后台标签页里 setTimeout 可能被节流导致提示不消失
  const FAST_HIDE_ACTIONS = new Set(["tabLeft", "tabRight", "closeTab", "reopenTab", "closeWindow"]);

  function hardHideGestureHint() {
    try {
      if (hideHintTimer) {
        clearTimeout(hideHintTimer);
        hideHintTimer = null;
      }
      const el = document.getElementById("__mg_gesture_hint");
      if (el) {
        el.style.opacity = "0";
        // 直接移除，避免因后台节流导致残留
        el.remove();
      }
    } catch (_) {}
  }

  // 只要页面失去可见性/焦点，就立刻清理提示（避免切换标签页后残留）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hardHideGestureHint();
  }, true);
  window.addEventListener("blur", hardHideGestureHint, true);
  window.addEventListener("pagehide", hardHideGestureHint, true);



  let tracking = false;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;
  let points = [];
  let dirs = [];
  let movedEnough = false;

  let suppressContextMenu = false;

  let canvas = null;
  let ctx = null;

  // 轨迹样式（注意：canvas.width/height 变化会重置 ctx 状态，必须可重复设置）
  const TRAIL_WIDTH = 4;
  const TRAIL_COLOR = "#a020f0";

  function applyTrailStyle() {
    if (!ctx) return;
    // 这些属性在 resize（改 canvas.width/height）后会被重置为默认值
    ctx.lineWidth = TRAIL_WIDTH;
    ctx.strokeStyle = TRAIL_COLOR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  // 缓存手势映射：一次手势过程中只读一次 storage，避免 move 事件频繁 await
  let mapCache = DEFAULT_MAP;
  let mapLoaded = false;
  let mapLoadPromise = null;

  function hasChromeApi() {
    return typeof chrome !== "undefined"
      && chrome?.runtime?.sendMessage
      && chrome?.storage?.sync?.get;
  }

  // 关闭窗口前确认（由 background 触发）
  if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "CONFIRM_CLOSE_WINDOW") {
        const ok = window.confirm("即将关闭当前窗口，是否继续？");
        sendResponse({ ok });
        return; // confirm 是同步的
      }
    });
  }


  async function getExcludedUrlsSafe() {
    if (!hasChromeApi()) return DEFAULT_EXCLUDED_URLS;
    try {
      const res = await chrome.storage.sync.get({ excludedUrls: DEFAULT_EXCLUDED_URLS });
      const list = res?.excludedUrls;
      return Array.isArray(list) ? list : DEFAULT_EXCLUDED_URLS;
    } catch (_) {
      return DEFAULT_EXCLUDED_URLS;
    }
  }

  function wildcardToRegex(pattern) {
    // 把 '*' 作为通配符，其余字符按字面匹配
    const esc = String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp("^" + esc + "$", "i");
  }

  function isUrlExcluded(url, host, patterns) {
    const u = String(url || "");
    const h = String(host || "").toLowerCase();
    for (const raw of patterns || []) {
      const p = String(raw || "").trim();
      if (!p || p.startsWith("#")) continue;

      // 正则：re:...
      if (p.startsWith("re:")) {
        try {
          const re = new RegExp(p.slice(3), "i");
          if (re.test(u)) return true;
        } catch (_) {}
        continue;
      }

      // 纯域名：example.com（匹配子域）
      if (!p.includes("*") && !p.includes("://") && !p.includes("/")) {
        const d = p.toLowerCase();
        if (h === d || h.endsWith("." + d)) return true;
        continue;
      }

      // 通配符/URL 规则：匹配整条 URL
      try {
        const re = wildcardToRegex(p);
        if (re.test(u)) return true;
      } catch (_) {}
    }
    return false;
  }

  // ✅若当前网址在排除列表里：不启用手势（不注册任何事件监听）
  try {
    const excluded = await getExcludedUrlsSafe();
    if (excluded?.length && isUrlExcluded(location.href, location.hostname, excluded)) {
      return;
    }
  } catch (_) {}

  async function getMapSafe() {
    if (!hasChromeApi()) return DEFAULT_MAP;
    try {
      const res = await chrome.storage.sync.get({ gestureMap: DEFAULT_MAP });
      // storage.get 通常不会 throw，但这里保险
      return res?.gestureMap || DEFAULT_MAP;
    } catch (e) {
      return DEFAULT_MAP;
    }
  }

  function loadMapForGesture() {
    // 只在需要时加载一次
    if (mapLoaded) return Promise.resolve(mapCache);
    if (mapLoadPromise) return mapLoadPromise;
    mapLoadPromise = (async () => {
      mapCache = await getMapSafe();
      mapLoaded = true;
      return mapCache;
    })();
    return mapLoadPromise;
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function createCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    `;
    document.documentElement.appendChild(canvas);
    ctx = canvas.getContext("2d");
    applyTrailStyle();
  }

  function destroyCanvas() {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // ⚠️改 width/height 会重置 ctx 的 lineWidth/strokeStyle 等状态
    applyTrailStyle();
  }

  function drawTrail() {
    if (!ctx || !canvas || points.length < 2) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function pushDir(dx, dy) {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let d;
    if (adx >= ady) d = dx > 0 ? "R" : "L";
    else d = dy > 0 ? "D" : "U";

    if (dirs.length === 0 || dirs[dirs.length - 1] !== d) {
      dirs.push(d);
      if (dirs.length > MAX_DIR_LEN) dirs = dirs.slice(0, MAX_DIR_LEN);
    }
  }

  function getGestureString() {
    return dirs.join("");
  }

  function toArrowGesture(g) {
    return String(g || "")
      .replace(/U/g, "↑")
      .replace(/D/g, "↓")
      .replace(/L/g, "←")
      .replace(/R/g, "→");
  }

  function resetAll(hideDelayMs = 0) {
    tracking = false;
    movedEnough = false;
    points = [];
    dirs = [];
    destroyCanvas();

    // 右键松开后自动隐藏提示（可带一点延时，便于看清最终结果）
    hideGestureHint(hideDelayMs);
  }

  function doScroll(action) {
    const docEl = document.documentElement;
    const body = document.body;
    const scrollH = Math.max(
      docEl?.scrollHeight || 0,
      body?.scrollHeight || 0
    );

    const step = Math.max(120, Math.floor(window.innerHeight * 0.7));

    if (action === "scrollDown") {
      window.scrollBy({ top: step, left: 0, behavior: "smooth" });
      return true;
    }
    if (action === "scrollUp") {
      window.scrollBy({ top: -step, left: 0, behavior: "smooth" });
      return true;
    }
    if (action === "scrollTop") {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return true;
    }
    if (action === "scrollBottom") {
      const bottom = Math.max(0, scrollH - window.innerHeight);
      window.scrollTo({ top: bottom, left: 0, behavior: "smooth" });
      return true;
    }
    return false;
  }

  // ✅识别到手势就拦截菜单
  window.addEventListener("contextmenu", (e) => {
    if (suppressContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      suppressContextMenu = false;
    }
  }, true);

  window.addEventListener("resize", resizeCanvas, true);

  window.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (isEditableTarget(e.target)) return;

    // 清掉上一次残留的提示，避免下一次右键轻微抖动时弹出旧动作
    hardHideGestureHint();

    tracking = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    points = [{ x: startX, y: startY }];
    dirs = [];
    movedEnough = false;
    suppressContextMenu = false;

    // showGestureHint("右键手势：准备中…");
    loadMapForGesture();

    if (showTrail) {
      createCanvas();
      drawTrail();
    }
  }, true);

  window.addEventListener("mousemove", (e) => {
    if (!tracking) return;

    const x = e.clientX, y = e.clientY;
    const dx = x - lastX;
    const dy = y - lastY;

    points.push({ x, y });

    if (!movedEnough && Math.hypot(x - startX, y - startY) > ARM_THRESHOLD) {
      movedEnough = true;
    }

    if (Math.hypot(dx, dy) >= MOVE_THRESHOLD) {
      pushDir(dx, dy);
      lastX = x;
      lastY = y;
    }

    // 实时提示（直到右键松开后自动消失）
    if (!movedEnough) {
      // 未达到触发阈值时不显示提示，避免显示上一次的残留文本
      hideGestureHint(0);
    } else {
      const g = getGestureString();
      const ga = toArrowGesture(g);

      if (g) {
        const action = mapCache[g] || "none";
        const actionLabel = ACTION_LABELS_ZH[action] || action;

        if (action === "none") {
          showGestureHint(`无效手势：${ga}`, true);
        } else {
          showGestureHint(`手势：${ga}    ${actionLabel}`, false);
        }
      } else {
        showGestureHint("手势：…", false);
      }
    }

    if (showTrail) drawTrail();
  }, true);

  window.addEventListener("mouseup", async (e) => {
    if (!tracking) return;
    if (e.button !== 2) return;

    const gesture = getGestureString();

    if (!movedEnough || !gesture) {
      resetAll(200);
      return;
    }

    // ✅只要识别到了手势，就保证不弹右键菜单
    suppressContextMenu = true;
    e.preventDefault();
    e.stopPropagation();

    const map = await getMapSafe();
    const action = map[gesture] || "none";

    const actionLabel = ACTION_LABELS_ZH[action] || action;
    const ga = toArrowGesture(gesture);

    if (action === "none") {
      showGestureHint(`无效手势：${ga}`, true);
    } else {
      showGestureHint(`手势：${ga}    ${actionLabel}`, false);
    }// 滚动动作：本地执行
    if (doScroll(action)) {
      resetAll(450);
      return;
    }


    // 对会导致切换/关闭页面的动作：立刻清理提示，避免切走后计时器被节流
    if (FAST_HIDE_ACTIONS.has(action)) {
      hardHideGestureHint();
    }

    // 其他动作：发给 background
    if (hasChromeApi()) {
      try {
        chrome.runtime.sendMessage({ type: "GESTURE", gesture }, () => {
          // 某些情况下会有 lastError（例如页面不允许注入/后台挂了）
          void chrome.runtime.lastError;
        });
      } catch (err) {
        // 忽略，别让它崩
      }
    }
    resetAll(FAST_HIDE_ACTIONS.has(action) ? 0 : 450);
  }, true);
})();
