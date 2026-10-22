// ══════════════════════════════════════════════════════════════════════════
// Echo Miuix —— 插件入口
//
// 这个文件只做四件事，样式全部在 style.css：
//   1. 门控：一个类（html.miuix-theme-active）+ manifest style 的 media 开关
//   2. 注册主题：tokens 供宿主取色，decorations 作为「主题被选中」的信号
//   3. 交互效果：每个效果是一个 () => cleanup 的工厂，统一由 runEffects 回收
//   4. 设置面板：底部渐隐开关 + 仓库入口
//
// 约定：不要在 JS 里拼 CSS 字符串。需要运行时状态类时，样式写在 style.css §16，
// 这里只负责挂 class / 改 CSS 变量。
// ══════════════════════════════════════════════════════════════════════════

const PLUGIN_ID = 'echo-miuix-plugin';
const MANIFEST_STYLE_ID = `echo-plugin-style-${PLUGIN_ID}-manifest`;
const ACTIVE_CLASS = 'miuix-theme-active';
/**
 * 兼容标记：早期 miuix 皮肤在挂载时就往 <html> 上打 `miuix-bg-active`，
 * 其他插件（echo-liquid-glass 的设置面板等）用它判断「要不要跟 Miuix 联动」。
 * 它表示「装了 miuix 插件」，与主题开关无关，所以不跟 ACTIVE_CLASS 一起切。
 */
const COMPAT_CLASS = 'miuix-bg-active';
const BOTTOM_MASK_OFF_CLASS = 'miuix-bottom-mask-off';
const STORAGE_KEY = 'echo-miuix-bottom-mask';
const REPO_URL = 'https://github.com/SkyShadowHero/echo-miuix-plugin';

/** 主题色板：与 style.css §0 的 token 一一对应，供宿主解析表面与强调色 */
const THEME = {
  id: 'miuix',
  title: 'Miuix',
  description: '小米澎湃 (HyperOS) 风格皮肤',
  defaultMode: 'system',
  variants: {
    light: {
      tokens: {
        shell: '#f7f7f7',
        sidebar: '#f7f7f7',
        main: '#f7f7f7',
        card: '#ffffff',
        elevated: '#e8e8e8',
        player: '#ffffff',
        text: '#000000',
        secondary: '#666666',
        border: '#dedede',
      },
      accent: '#3482ff',
    },
    dark: {
      tokens: {
        shell: '#1a1a1a',
        sidebar: '#1a1a1a',
        main: '#1a1a1a',
        card: '#2e2e2e',
        elevated: '#1a1a1a',
        player: '#2e2e2e',
        text: '#ffffff',
        secondary: '#bcbcbc',
        border: '#444446',
      },
      accent: '#277af7',
    },
  },
};

/** 卡片倾斜：最大角度与过渡，写在这里而不是散在事件里 */
const TILT = { maxDeg: 8, target: '.card-container' };
const TILT_CARD_SELECTOR = '.playlist-card-grid, .album-card, .artist-card, .home-feature-card';

/** 底部弹层抓取条：下拉关闭，上拉带着阻尼长高（松手立刻回到自然高度） */
const SHEET = {
  selector: '.dialog-content:not(.shortcut-picker)',
  handleZone: 28,
  closeThreshold: 140,
  growMax: 80,
  growTau: 220,
  settleMs: 480,
  closeMs: 220,
  dragTransition: 'transform 0.24s cubic-bezier(0.4, 0, 1, 1)',
  settleTransition:
    'transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), height 0.26s cubic-bezier(0.22, 1, 0.36, 1)',
};

// ── 入口 ──────────────────────────────────────────────────────────────────

export function activate(ctx) {
  const root = document.documentElement;

  // 旧插件的联动判断依赖这个类，挂载即打上（不随主题开关变化）
  root.classList.add(COMPAT_CLASS);

  const setStyleMedia = (enabled) => {
    const styleEl = document.getElementById(MANIFEST_STYLE_ID);
    if (styleEl) styleEl.media = enabled ? '' : 'not all';
  };

  const setActive = (enabled) => {
    root.classList.toggle(ACTIVE_CLASS, enabled);
    setStyleMedia(enabled);
  };

  const isActive = () => root.classList.contains(ACTIVE_CLASS);

  // 迷你播放器是独立窗口：不参与主题中心开关，固定上电。
  if (isMiniWindow()) {
    setActive(true);
    return;
  }

  // 默认停用；但若主题装饰层已先挂载（类已存在）则保持，避免竞态把启用状态关掉。
  if (!isActive()) setActive(false);

  // 1. 注册主题（装饰层 = 主题被选中的信号）
  const Marker = {
    setup() {
      ctx.vue.onMounted(() => setActive(true));
      ctx.vue.onUnmounted(() => setActive(false));
      return () => null;
    },
  };

  try {
    ctx.theme.register({ ...THEME, decorations: { background: Marker } });
  } catch (error) {
    // 宿主不支持插件主题能力时回退为始终启用，避免插件完全失效。
    console.warn(`[${PLUGIN_ID}] 主题注册失败，回退为始终启用：`, error);
    setActive(true);
  }

  // 2. 运行交互效果
  const effects = [
    effectTilt(isActive),
    effectSelectBackdrop(),
    effectTabsSlider(),
    effectDecorations(ctx),
    effectWheelScroll(),
    effectPageSpacers(),
    effectRankCollapse(),
    effectSheetDrag(),
    effectContextScrim(),
  ];

  for (const cleanup of effects) {
    if (typeof cleanup === 'function') ctx.dispose(cleanup);
  }

  // 3. 设置面板
  defineSettings(ctx);
}

export function deactivate() {
  document.documentElement.classList.remove(ACTIVE_CLASS, COMPAT_CLASS);
}

// ── 工具 ──────────────────────────────────────────────────────────────────

function isMiniWindow() {
  return typeof location !== 'undefined' && location.hash.includes('mini-player');
}

function createElement(className) {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/**
 * 统一的 DOM 同步器：一个 MutationObserver + rAF 节流，驱动若干幂等 mount 函数。
 * 之前每个效果各自开一个 observer，四个 observer 同时观察整个 body，开销翻倍。
 */
function createDomSync(mounts) {
  let frame = 0;
  const run = () => {
    frame = 0;
    for (const mount of mounts) mount();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };

  run();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}

// ── 效果：卡片按压倾斜 ────────────────────────────────────────────────────

function effectTilt(isActive) {
  let activeEl = null;
  let clearTimer = 0;

  const findCard = (el) => (el.closest ? el.closest(TILT_CARD_SELECTOR) : null);
  const tiltTarget = (card) => card.querySelector(TILT.target) || card;

  const point = (event) => {
    const touch = event.changedTouches && event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : { x: event.clientX, y: event.clientY };
  };

  const onDown = (event) => {
    if (!isActive()) return;
    if (event.type === 'touchstart' && activeEl) return;

    const card = findCard(event.target);
    if (!card) return;

    const { x, y } = point(event);
    const rect = card.getBoundingClientRect();
    const offsetX = x - rect.left;
    const offsetY = y - rect.top;
    const isLeft = offsetX < rect.width / 2;
    const isTop = offsetY < rect.height / 2;

    const el = tiltTarget(card);
    el.classList.add('miuix-tilt');
    el.style.setProperty('--tilt-rx', `${isTop ? TILT.maxDeg : -TILT.maxDeg}deg`);
    el.style.setProperty('--tilt-ry', `${isLeft ? -TILT.maxDeg : TILT.maxDeg}deg`);
    el.style.setProperty('--tilt-origin', `${isLeft ? '100%' : '0%'} ${isTop ? '100%' : '0%'}`);
    el.classList.add('tilt-active');
    activeEl = el;
  };

  const onUp = () => {
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => {
      if (!activeEl) return;
      activeEl.classList.remove('tilt-active');
      activeEl = null;
    }, 120);
  };

  document.addEventListener('mousedown', onDown);
  document.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);

  return () => {
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('touchstart', onDown);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchend', onUp);
    window.clearTimeout(clearTimer);
  };
}

// ── 效果：下拉菜单遮罩 ────────────────────────────────────────────────────

function effectSelectBackdrop() {
  let backdrop = null;
  let frame = 0;

  // 以触发器状态为准：content 在退出动画或缓存页里可能残留。
  const hasOpenSelect = () => !!document.querySelector('.echo-select-trigger[data-state="open"]');

  const show = () => {
    if (!backdrop) {
      backdrop = createElement('miuix-select-backdrop');
      document.body.appendChild(backdrop);
    }
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (hasOpenSelect() && backdrop) backdrop.classList.add('is-visible');
    });
  };

  const hide = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (backdrop) backdrop.classList.remove('is-visible');
  };

  const sync = () => (hasOpenSelect() ? show() : hide());

  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  sync();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    backdrop?.remove();
    backdrop = null;
    frame = 0;
  };
}

// ── 效果：Tab 滑片 ────────────────────────────────────────────────────────

function effectTabsSlider() {
  const SLIDER = 'miuix-reka-slider';

  const collect = () => {
    const lists = new Set(document.querySelectorAll('[data-reka-tabs-list]'));
    document.querySelectorAll('.tab-trigger').forEach((trigger) => {
      const parent = trigger.parentElement;
      if (parent && parent.querySelector('.tab-trigger')) lists.add(parent);
    });
    return lists;
  };

  const attach = (list) => {
    if (list.querySelector(`.${SLIDER}`)) return null;

    list.classList.add('miuix-tabs-list');
    const slider = createElement(SLIDER);
    list.appendChild(slider);

    const update = () => {
      const active = list.querySelector('[data-state="active"]');
      if (!active) return;
      const listRect = list.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      slider.style.left = `${activeRect.left - listRect.left}px`;
      slider.style.width = `${activeRect.width}px`;
    };

    const onClick = () => requestAnimationFrame(update);
    const observer = new MutationObserver(() => requestAnimationFrame(update));
    observer.observe(list, { subtree: true, attributeFilter: ['data-state', 'class'] });
    list.addEventListener('click', onClick);

    update();
    requestAnimationFrame(update);

    return () => {
      list.removeEventListener('click', onClick);
      observer.disconnect();
      slider.remove();
      list.classList.remove('miuix-tabs-list');
    };
  };

  const cleanups = new Map();
  const sync = () => {
    for (const list of collect()) {
      if (cleanups.has(list)) continue;
      const cleanup = attach(list);
      if (cleanup) cleanups.set(list, cleanup);
    }
  };

  const disposeSync = createDomSync([sync]);

  return () => {
    disposeSync();
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}

// ── 效果：底部渐隐装饰层 ──────────────────────────────────────────────────

function effectDecorations(ctx) {
  const stopSync = createDomSync([
    () => {
      const main = document.querySelector('.main-content');
      if (main && !main.querySelector('.miuix-main-blur')) {
        main.appendChild(createElement('miuix-main-blur'));
      }

      // 侧栏的底部渐隐改由 §3 的 mask 实现（淡出滚动视口），
      // 不再注入遮罩元素：遮罩要么盖住工具条，要么在面板中间留一条硬边。
    },
  ]);

  const applyBottomMask = (enabled) => {
    document.documentElement.classList.toggle(BOTTOM_MASK_OFF_CLASS, !enabled);
  };

  Promise.resolve(ctx.storage.get(STORAGE_KEY))
    .then((saved) => applyBottomMask(saved !== false))
    .catch(() => applyBottomMask(true));

  return stopSync;
}

// ── 效果：风格标签行横向滚轮 ──────────────────────────────────────────────

function effectWheelScroll() {
  const bind = (row) => {
    if (row.dataset.miuixWheel) return;
    row.dataset.miuixWheel = '1';
    row.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        row.scrollLeft += event.deltaY;
      },
      { passive: false },
    );
  };

  return createDomSync([
    () => document.querySelectorAll('.style-tag-row:not([data-miuix-wheel])').forEach(bind),
  ]);
}

// ── 效果：页面底部留白 ────────────────────────────────────────────────────

function effectPageSpacers() {
  const pad = (el, { skipSidebar = false } = {}) => {
    if (el.classList.contains('miuix-padded')) return;
    el.classList.add('miuix-padded');
    if (skipSidebar && (el.closest('.sidebar') || el.closest('.settings-sidebar'))) return;
    el.appendChild(createElement('miuix-page-spacer'));
  };

  return createDomSync([
    () => {
      document
        .querySelectorAll('.scrollbar-view:not(.miuix-padded)')
        .forEach((view) => pad(view, { skipSidebar: true }));
      // 众乐房房间页撑满整页、没有 .scrollbar-view，底部同样会被悬浮播放栏挡住。
      document
        .querySelectorAll('.listen-session:not(.miuix-padded)')
        .forEach((el) => pad(el));
    },
  ]);
}

// ── 效果：榜单卡片收起动画 ────────────────────────────────────────────────
// 宿主用 v-if 直接卸载面板、没有 leave 过渡，这里拦一次收起点击，先播动画再放行。

function effectRankCollapse() {
  const DURATION = 240;
  let skip = false;

  const onClick = (event) => {
    if (skip) return;
    const toggle = event.target?.closest?.('.ranking-card-toggle');
    if (!toggle) return;

    const card = toggle.closest('.ranking-card');
    if (!card || !card.classList.contains('is-expanded')) return;

    const panel = card.querySelector('.ranking-filter-panel');
    if (!panel) return;

    event.stopPropagation();

    // 进入动画带 !important，普通内联改不动它；必须用 important 内联停掉，
    // 否则 fill: both 会把 max-height 锁住，收不回去。
    panel.style.setProperty('animation', 'none', 'important');
    panel.style.overflow = 'hidden';
    panel.style.maxHeight = `${panel.scrollHeight}px`;
    panel.style.transition = 'max-height 240ms cubic-bezier(0.4, 0, 0.6, 1), opacity 200ms ease';

    void panel.offsetHeight;
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';

    window.setTimeout(() => {
      skip = true;
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      skip = false;
    }, DURATION);
  };

  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

// ── 效果：底部弹层抓取条 ──────────────────────────────────────────────────
// 向下拖超过阈值关闭；向上拖不做任何事（改高度会破坏内部滚动区的高度计算）。

function effectSheetDrag() {
  let drag = null;
  let hovered = null;

  const setHovered = (sheet) => {
    if (hovered === sheet) return;
    hovered?.classList.remove('miuix-handle-hover');
    hovered = sheet;
    sheet?.classList.add('miuix-handle-hover');
  };

  const sheetAtHandle = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const sheet = el?.closest?.(SHEET.selector);
    if (!sheet) return null;
    return y - sheet.getBoundingClientRect().top <= SHEET.handleZone ? sheet : null;
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest?.('button, a, input, textarea, select, [contenteditable="true"]')) return;

    const sheet = event.target.closest?.(SHEET.selector);
    if (!sheet) return;

    const rect = sheet.getBoundingClientRect();
    if (event.clientY - rect.top > SHEET.handleZone) return;

    sheet.classList.add('miuix-handle-active');
    drag = {
      sheet,
      startY: event.clientY,
      baseHeight: rect.height,
      // 宿主会在弹层上写内联 height（例如调整顺序是 min(480px, 100vh-96px)），
      // 收尾时必须把这段原样的值还回去，直接删掉会让高度突变。
      baseInlineHeight: sheet.style.height,
      mode: null,
      offset: 0,
    };
    sheet.style.transition = 'none';

    try {
      sheet.setPointerCapture(event.pointerId);
    } catch {
      /* 指针捕获失败不影响拖拽 */
    }
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!drag) {
      setHovered(sheetAtHandle(event.clientX, event.clientY));
      return;
    }

    const { sheet, startY, baseHeight } = drag;
    const delta = startY - event.clientY; // >0 上拉，<0 下拉

    if (delta < -8) {
      const offset = (-delta - 8) * 0.9;
      drag.mode = 'down';
      drag.offset = offset;
      sheet.style.height = `${baseHeight}px`;
      sheet.style.setProperty('transform', `translateY(${offset}px)`, 'important');
      return;
    }

    if (delta > 8) {
      // 上拉：带着阻尼长高，最多 80px；松手时立即把 height 摘掉，
      // 只让 transform 回弹，内嵌滚动区会按自然高度重新计算
      drag.mode = 'up';
      drag.offset = 0;
      sheet.style.setProperty('transform', 'translateY(0)', 'important');
      sheet.style.height = `${baseHeight + SHEET.growMax * (1 - Math.exp(-(delta - 8) / SHEET.growTau))}px`;
    }
  };

  const onPointerUp = () => {
    if (!drag) return;

    const { sheet, mode, offset, baseHeight, baseInlineHeight } = drag;
    drag = null;
    sheet.classList.remove('miuix-handle-active');

    const clearInline = () => {
      sheet.style.removeProperty('transform');
      // 还回宿主原来那段内联 height，而不是一律删掉：
      // 删掉会退回样式表的 auto / 其他规则，高度就突变了
      if (baseInlineHeight) sheet.style.height = baseInlineHeight;
      else sheet.style.removeProperty('height');
      sheet.style.transition = '';
    };

    if (mode === 'down' && offset > SHEET.closeThreshold) {
      // 从当前位置继续滑出；同时关掉宿主的关闭动画，否则会先弹回顶部再重播
      sheet.style.setProperty('animation', 'none', 'important');
      sheet.style.transition = SHEET.dragTransition;
      sheet.style.setProperty('transform', 'translateY(100%)', 'important');
      window.setTimeout(() => {
        const closeBtn = sheet.querySelector('.dialog-close');
        if (closeBtn) closeBtn.click();
        else sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }, SHEET.closeMs);
      return;
    }

    // 高度要「动画」回自然高度，不能直接摘掉（那样是闪现）。
    // 先过渡回 baseHeight，等过渡彻底结束再删掉内联 height：
    // 删早了内嵌滚动区会按撑开后的高度重算，删晚了会卡在撑开高度。
    sheet.style.transition = SHEET.settleTransition;
    sheet.style.setProperty('transform', 'translateY(0)', 'important');
    sheet.style.height = `${baseHeight}px`;

    window.setTimeout(() => {
      clearInline();
    }, SHEET.settleMs);
  };

  const onPointerLeave = () => {
    if (!drag) setHovered(null);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  document.addEventListener('pointerleave', onPointerLeave, true);
  // 指针在窗口外松开 / 捕获丢失时也要收尾，否则内联高度会留在弹层上
  document.addEventListener('lostpointercapture', onPointerUp, true);
  window.addEventListener('blur', onPointerUp);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    document.removeEventListener('pointerleave', onPointerLeave, true);
    document.removeEventListener('lostpointercapture', onPointerUp, true);
    window.removeEventListener('blur', onPointerUp);
    hovered?.classList.remove('miuix-handle-hover');
    hovered = null;
    drag = null;
  };
}

// ── 效果：右键菜单遮罩 ────────────────────────────────────────────────────

function effectContextScrim() {
  let scrim = null;

  const remove = () => {
    scrim?.remove();
    scrim = null;
  };

  const sync = () => {
    if (!document.querySelector('.song-context-menu')) {
      remove();
      return;
    }
    if (scrim?.isConnected) return;
    scrim = createElement('miuix-menu-scrim');
    document.body.appendChild(scrim);
  };

  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  sync();

  return () => {
    observer.disconnect();
    remove();
  };
}

// ── 设置面板 ──────────────────────────────────────────────────────────────
// 用宿主现成的 settings-card / settings-item 与 Switch 组件，不写内联样式。

function defineSettings(ctx) {
  const { defineComponent, defineAsyncComponent, h, ref, onMounted } = ctx.vue;
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Button = defineAsyncComponent(ctx.ui.components.Button);

  const Panel = defineComponent({
    name: 'EchoMiuixSettings',
    setup() {
      const bottomMask = ref(true);

      onMounted(() => {
        Promise.resolve(ctx.storage.get(STORAGE_KEY))
          .then((saved) => {
            bottomMask.value = saved !== false;
          })
          .catch(() => {});
      });

      const setBottomMask = async (value) => {
        bottomMask.value = Boolean(value);
        document.documentElement.classList.toggle(BOTTOM_MASK_OFF_CLASS, !value);
        try {
          await ctx.storage.set(STORAGE_KEY, Boolean(value));
        } catch {
          /* 存储失败时保持当前会话状态 */
        }
      };

      const row = (title, description, control) =>
        // 行布局走内联样式：宿主 .settings-item 的排版是 scoped 的（带 data-v），
        // 插件自己渲染的行匹配不到，换个主题（比如锤子）就会掉成上下堆叠
        h(
          'div',
          {
            class: 'settings-item miuix-settings-row',
            style: 'display:flex;align-items:center;justify-content:space-between;gap:24px;',
          },
          [
            h('div', { class: 'space-y-1', style: 'min-width:0;flex:1' }, [
              h('h3', { class: 'font-semibold' }, title),
              h('p', { class: 'text-sm text-text-secondary' }, description),
            ]),
            control(),
          ],
        );

      return () =>
        h('div', { class: 'space-y-5' }, [
          h('div', { class: 'settings-card' }, [
            row(
              '底部渐变遮罩',
              '页面底部渐隐到背景色，让悬浮播放栏更突出',
              () =>
                h(Switch, {
                  modelValue: bottomMask.value,
                  'onUpdate:modelValue': setBottomMask,
                  'aria-label': '底部渐变遮罩',
                }),
            ),
          ]),
          h('div', { class: 'settings-card' }, [
            row('GitHub', '点击跳转仓库地址，欢迎 Star', () =>
              h(
                Button,
                {
                  size: 'xs',
                  // 不传 variant：和 local / liquid-glass 的 GitHub 按钮保持同一个默认色
                  onClick: () => window.open(REPO_URL, '_blank'),
                },
                () => 'Github',
              ),
            ),
          ]),
        ]);
    },
  });

  ctx.ui.settings.define({
    title: `${ctx.manifest.name} 设置`,
    component: Panel,
  });
}
