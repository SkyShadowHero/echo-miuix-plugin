// ── 插件入口 ──
export function activate(ctx) {
  // ── 插件样式开关：仅在「主题中心」启用 Miuix 主题时才生效 ──
  // manifest 里的 style.css 注入为 <style id="echo-plugin-style-<id>-manifest">，
  // 通过切换它的 media 来整体启用/停用 MIUIX 外观。
  const MIUIX_MANIFEST_STYLE_ID = 'echo-plugin-style-echo-miuix-plugin-manifest';
  const setMiuixTheme = (enabled) => {
    document.documentElement.classList.toggle('miuix-theme-active', enabled);
    const styleEl = document.getElementById(MIUIX_MANIFEST_STYLE_ID);
    if (styleEl) styleEl.media = enabled ? '' : 'not all';
  };

  // ── mini 播放器窗口：独立窗口，不受主题中心开关控制，固定启用 MIUIX 皮肤 ──
  if (typeof location !== 'undefined' && location.hash.includes('mini-player')) {
    document.documentElement.classList.add('miuix-bg-active');
    setMiuixTheme(true);
    return;
  }

  ctx.css.inject(INTERACTIONS_CSS);
  ctx.css.inject(TILT_CSS);

  // 默认停用；若主题装饰层已先于插件挂载（类已存在）则保持其状态，避免竞态把已启用状态关掉
  if (!document.documentElement.classList.contains('miuix-theme-active')) setMiuixTheme(false);

  const ThemeMarker = {
    setup() {
      ctx.vue.onMounted(() => setMiuixTheme(true));
      ctx.vue.onUnmounted(() => setMiuixTheme(false));
      return () => null;
    },
  };

  // ── 注册为宿主「主题中心」可选的 Miuix 主题（需要 manifest.capabilities.theme）──
  // 主题 tokens 让宿主表面取色与插件皮肤一致；decorations 作为「主题已启用」的开关。
  try {
    ctx.theme.register({
      id: 'miuix',
      title: 'Miuix',
      description: '小米澎湃 (HyperOS) 风格皮肤',
      defaultMode: 'system',
      decorations: { background: ThemeMarker },
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
    });
  } catch (error) {
    // 宿主不支持插件主题能力时回退为始终启用，避免插件完全失效
    console.warn('[echo-miuix-plugin] 主题注册失败，回退为始终启用：', error);
    setMiuixTheme(true);
  }

  const tiltCleanups = setupTiltEffect();
  tiltCleanups.forEach((fn) => ctx.dispose(fn));

  const backdropCleanups = setupSelectBackdrop();
  backdropCleanups.forEach((fn) => ctx.dispose(fn));

  const rekaTabCleanups = setupRekaTabsSlider();
  rekaTabCleanups.forEach((fn) => ctx.dispose(fn));

  const sidebarBlurCleanups = setupSidebarBlur();
  sidebarBlurCleanups.forEach((fn) => ctx.dispose(fn));

  const mainBlurCleanups = setupMainBlur();
  mainBlurCleanups.forEach((fn) => ctx.dispose(fn));

  // ── 风格标签行鼠标滚轮水平滚动 ──
  function bindTagRowScroll(row) {
    if (row.dataset.miuixWheel) return;
    row.dataset.miuixWheel = '1';
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        row.scrollLeft += e.deltaY;
      }
    };
    row.addEventListener('wheel', onWheel, { passive: false });
  }

  document.querySelectorAll('.style-tag-row').forEach(bindTagRowScroll);
  const tagRowObs = new MutationObserver(() => {
    document.querySelectorAll('.style-tag-row:not([data-miuix-wheel])').forEach(bindTagRowScroll);
  });
  tagRowObs.observe(document.body, { childList: true, subtree: true });
  ctx.dispose(() => tagRowObs.disconnect());

  // 背景色始终启用
  document.documentElement.classList.add('miuix-bg-active');

  // ── 全局内容末尾留白 ──
  function addContentSpacers() {
    const views = document.querySelectorAll('.scrollbar-view:not(.miuix-padded)');
    views.forEach((view) => {
      view.classList.add('miuix-padded');
      const spacer = document.createElement('div');
      spacer.className = 'miuix-page-spacer';
      view.appendChild(spacer);
    });
    // 众乐房房间页（.listen-session 撑满整页、没有 .scrollbar-view）：
    // 底部会被悬浮底栏遮挡，同样补 100px 留白
    const sessions = document.querySelectorAll('.listen-session:not(.miuix-padded)');
    sessions.forEach((session) => {
      session.classList.add('miuix-padded');
      const spacer = document.createElement('div');
      spacer.className = 'miuix-page-spacer';
      session.appendChild(spacer);
    });
  }
  addContentSpacers();
  const viewObs = new MutationObserver(addContentSpacers);
  viewObs.observe(document.body, { childList: true, subtree: true });
  ctx.dispose(() => viewObs.disconnect());

  // ── 榜单成就卡片：宿主用 v-if 直接卸载面板，没有 leave 过渡，
  //    这里拦截「收缩」点击，先播放收起动画，再放行宿主的折叠逻辑 ──
  (() => {
    let skip = false;
    const DURATION = 240;
    const onToggleClick = (event) => {
      if (skip) return;
      const toggle = event.target && event.target.closest && event.target.closest('.ranking-card-toggle');
      if (!toggle) return;
      const card = toggle.closest('.ranking-card');
      if (!card || !card.classList.contains('is-expanded')) return;
      const panel = card.querySelector('.ranking-filter-panel');
      if (!panel) return;

      // 阻止宿主 @click，先播放收起动画
      event.stopPropagation();
      // 进入动画是 !important，普通内联覆盖不了它；必须用 important 内联把它停掉，
      // 否则 fill: both 会把 max-height 锁在 1000px，收不起来
      panel.style.setProperty('animation', 'none', 'important');
      panel.style.overflow = 'hidden';
      panel.style.maxHeight = `${panel.scrollHeight}px`;
      panel.style.transition = 'max-height 0.24s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.2s ease';
      void panel.offsetHeight; // 强制回流，让起始高度生效
      panel.style.maxHeight = '0px';
      panel.style.opacity = '0';

      window.setTimeout(() => {
        skip = true;
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        skip = false;
      }, DURATION);
    };
    document.addEventListener('click', onToggleClick, true);
    ctx.dispose(() => document.removeEventListener('click', onToggleClick, true));
  })();

  // ── 底部弹层（设置 / 插件设置）抓取条：上拉增高回弹 + hover/active 高亮 ──
  (() => {
    const SHEET_SELECTOR =
      '.dialog-content.global-settings-dialog, .dialog-content.plugin-settings-dialog';
    const HANDLE_ZONE = 28;
    let drag = null;
    let hovered = null;
    const setHovered = (sheet) => {
      if (hovered === sheet) return;
      if (hovered) hovered.classList.remove('miuix-handle-hover');
      hovered = sheet;
      if (sheet) sheet.classList.add('miuix-handle-hover');
    };
    const sheetHandleAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const sheet = el && el.closest ? el.closest(SHEET_SELECTOR) : null;
      if (!sheet) return null;
      return y - sheet.getBoundingClientRect().top <= HANDLE_ZONE ? sheet : null;
    };
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!target || !target.closest) return;
      const sheet = target.closest(SHEET_SELECTOR);
      if (!sheet) return;
      if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      const rect = sheet.getBoundingClientRect();
      if (event.clientY - rect.top > HANDLE_ZONE) return; // 仅顶部抓取条区域
      sheet.classList.add('miuix-handle-active');
      drag = { sheet, startY: event.clientY, baseHeight: rect.height };
      sheet.style.transition = 'none';
      try {
        sheet.setPointerCapture(event.pointerId);
      } catch {}
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      if (drag) {
        // 弹层底部锚定：上拉就是往上撑高度（×0.6 阻尼），底部始终贴底不会露空
        const raw = event.clientY - drag.startY;
        const grow = raw < 0 ? -raw * 0.6 : 0;
        drag.sheet.style.height = `${drag.baseHeight + grow}px`;
        return;
      }
      setHovered(sheetHandleAt(event.clientX, event.clientY));
    };
    const onPointerUp = () => {
      if (!drag) return;
      const sheet = drag.sheet;
      const baseHeight = drag.baseHeight;
      drag = null;
      sheet.classList.remove('miuix-handle-active');
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        sheet.removeEventListener('transitionend', cleanup);
        sheet.style.removeProperty('height');
        sheet.style.transition = '';
      };
      sheet.style.transition = 'height 0.34s cubic-bezier(0.22, 1, 0.36, 1)';
      sheet.style.height = `${baseHeight}px`;
      sheet.addEventListener('transitionend', cleanup);
      window.setTimeout(cleanup, 480);
    };
    const onPointerLeave = () => {
      if (!drag) setHovered(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('pointerleave', onPointerLeave, true);
    ctx.dispose(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('pointerleave', onPointerLeave, true);
    });
  })();

  const { defineComponent, defineAsyncComponent, h, reactive } = ctx.vue;
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Slider = defineAsyncComponent(ctx.ui.components.Slider);
  const Button = defineAsyncComponent(ctx.ui.components.Button);

  const SettingsPanel = defineComponent({
    setup() {
      return () =>
        h('div', { style: 'display: flex; flex-direction: column; align-items: center; gap: 8px;' }, [
          h('div', { class: 'settings-card', style: 'border-radius: 16px; overflow: hidden; width: 100%;' }, [
            h('div', {
              class: 'settings-item',
              style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;',
            }, [
              h('div', { style: 'flex: 1; min-width: 0;' }, [
                h('div', { style: 'font-weight: 600; font-size: 14px; color: var(--miuix-on-background); line-height: 1.4;' }, 'GitHub'),
                h('div', { style: 'font-size: 12px; color: var(--miuix-on-background); opacity: 0.6; margin-top: 2px; line-height: 1.5;' }, '点击跳转 GitHub 地址，欢迎 Star'),
              ]),
              h(Button, {
                class: 'settings-button github-star',
                onClick: () => window.open('https://github.com/SkyShadowHero/echo-miuix-plugin', '_blank'),
              }, 'Github'),
            ]),
          ]),

        ]);
    },
  });

  ctx.ui.settings.define({
    title: `${ctx.manifest.name} 设置`,
    component: SettingsPanel,
  });
}

// ── 插件停用 ──
export function deactivate(ctx) {
  document.documentElement.classList.remove('miuix-bg-active');
}


// ── Sink 效果 CSS ──
const INTERACTIONS_CSS = `
.miuix-sink {
  transition: scale 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.miuix-sink:active {
  scale: 0.94 !important;
}
`;

// ── Tilt 效果 CSS ──
const TILT_CSS = `
.miuix-tilt {
  transition: transform 0.2s cubic-bezier(0.2, 0, 0.4, 1) !important;
  transform-origin: var(--tilt-origin, center) !important;
}
.miuix-tilt.tilt-active {
  transform: perspective(800px) rotateX(var(--tilt-rx, 0deg)) rotateY(var(--tilt-ry, 0deg)) !important;
}
`;

// ── 卡片 Tilt 按压效果 ──
// 使用事件委托（document 级别）+ 延迟清除，确保动画可渲染
// 自己管理 <style> 元素，避免被 ctx.css.inject 的 id 覆盖机制覆盖
function setupTiltEffect() {
  const cleanups = [];

  // 自己注入 TILT_CSS，独立于 ctx.css.inject（后者同 id 会互相覆盖）
  const styleEl = document.createElement('style');
  styleEl.id = 'miuix-tilt-style';
  styleEl.textContent = TILT_CSS;
  document.head.appendChild(styleEl);
  cleanups.push(() => styleEl.remove());

  let activeTiltEl = null;
  let clearTimer = null;

  // 从事件目标向上找卡片根元素
  function findCard(el) {
    return el.closest(
      '.playlist-card-grid, .album-card, .artist-card, .home-feature-card',
    );
  }

  // 获取 tilt 目标（有 card-container 的用容器，否则用自身）
  function getTarget(card) {
    return card.querySelector('.card-container') || card;
  }

  // 提取事件坐标（兼容 mouse / touch）
  function getClientXY(e) {
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onDown(e) {
    // 仅在主题中心启用 Miuix 主题时才生效
    if (!document.documentElement.classList.contains('miuix-theme-active')) return;
    // 如果是 touch 事件且已有一个激活的 tilt，先清除
    if (e.type === 'touchstart' && activeTiltEl) return;

    const card = findCard(e.target);
    if (!card) return;

    const { x, y } = getClientXY(e);
    const rect = card.getBoundingClientRect();
    const rx = x - rect.left;
    const ry = y - rect.top;
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    const tiltEl = getTarget(card);
    tiltEl.classList.add('miuix-tilt');
    tiltEl.style.setProperty('--tilt-rx', `${ry < halfH ? 8 : -8}deg`);
    tiltEl.style.setProperty('--tilt-ry', `${rx < halfW ? -8 : 8}deg`);
    tiltEl.style.setProperty(
      '--tilt-origin',
      `${rx < halfW ? '100%' : '0%'} ${ry < halfH ? '100%' : '0%'}`,
    );
    tiltEl.classList.add('tilt-active');
    activeTiltEl = tiltEl;
  }

  function onUp() {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (activeTiltEl) {
        activeTiltEl.classList.remove('tilt-active');
        activeTiltEl = null;
      }
    }, 120);
  }

  // 使用 mousedown + touchstart 替代 pointerdown（兼容性更好）
  document.addEventListener('mousedown', onDown);
  document.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);

  cleanups.push(() => {
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('touchstart', onDown);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchend', onUp);
    clearTimeout(clearTimer);
  });

  return cleanups;
}

// ── 下拉菜单遮罩 ──
function setupSelectBackdrop() {
  const cleanups = [];
  let backdrop = null;

  const showBackdrop = () => {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'miuix-select-backdrop';
      document.body.appendChild(backdrop);
    }
    requestAnimationFrame(() => backdrop.classList.add('is-visible'));
  };

  const hideBackdrop = () => {
    if (backdrop) backdrop.classList.remove('is-visible');
  };

  const observer = new MutationObserver(() => {
    const content = document.querySelector('.echo-select-content');
    if (content && document.body.contains(content)) {
      showBackdrop();
    } else {
      hideBackdrop();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const closeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'data-state') continue;
      const el = mutation.target;
      if (el.classList.contains('echo-select-trigger') && el.dataset.state === 'closed') {
        const content = document.querySelector('.echo-select-content');
        if (content && document.body.contains(content)) {
          content.classList.add('miuix-closing');
        }
        break;
      }
    }
  });
  closeObserver.observe(document.body, { subtree: true, attributeFilter: ['data-state'] });

  cleanups.push(() => {
    observer.disconnect();
    closeObserver.disconnect();
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  });

  return cleanups;
}

function setupRekaTabsSlider() {
  const cleanups = [];

  function findAllTabsLists() {
    const found = new Set();
    document.querySelectorAll('[data-reka-tabs-list]').forEach((el) => found.add(el));
    document.querySelectorAll('.tab-trigger').forEach((el) => {
      const parent = el.parentElement;
      if (parent && parent.querySelector('.tab-trigger')) {
        found.add(parent);
      }
    });
    return [...found];
  }

  function attachList(list) {
    if (list.querySelector('.miuix-reka-slider')) return;
    list.classList.add('miuix-tabs-list');

    const slider = document.createElement('div');
    slider.className = 'miuix-reka-slider';
    list.appendChild(slider);

    function update() {
      const active = list.querySelector('[data-state="active"]');
      if (!active) return;
      const lr = list.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      slider.style.left = `${ar.left - lr.left}px`;
      slider.style.width = `${ar.width}px`;
    }

    // 初始定位
    update();
    requestAnimationFrame(update);

    // 点击时更新
    const clickHandler = () => requestAnimationFrame(update);
    list.addEventListener('click', clickHandler);

    // 监听 data-state 变化
    const obs = new MutationObserver(() => requestAnimationFrame(update));
    obs.observe(list, { subtree: true, attributeFilter: ['data-state', 'class'] });

    cleanups.push(() => {
      list.removeEventListener('click', clickHandler);
      obs.disconnect();
      slider.remove();
      list.classList.remove('miuix-tabs-list');
    });
  }

  findAllTabsLists().forEach(attachList);

  const observer = new MutationObserver(() => {
    findAllTabsLists().forEach((list) => {
      if (!list.querySelector('.miuix-reka-slider')) {
        attachList(list);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  return cleanups;
}
function setupSidebarBlur() {
  const cleanups = [];

  const attach = () => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector('.miuix-sidebar-blur')) return;

    const overlay = document.createElement('div');
    overlay.className = 'miuix-sidebar-blur';
    sidebar.appendChild(overlay);
    cleanups.push(() => overlay.remove());
  };

  attach();

  const observer = new MutationObserver(() => {
    if (document.querySelector('.sidebar') && !document.querySelector('.miuix-sidebar-blur')) {
      attach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  return cleanups;
}

// ── 主内容底部渐变遮罩 ──
function setupMainBlur() {
  const cleanups = [];

  const attach = () => {
    const main = document.querySelector('.main-content');
    if (!main || main.querySelector('.miuix-main-blur')) return;

    const overlay = document.createElement('div');
    overlay.className = 'miuix-main-blur';
    main.appendChild(overlay);
    cleanups.push(() => overlay.remove());
  };

  attach();

  const observer = new MutationObserver(() => {
    if (document.querySelector('.main-content') && !document.querySelector('.miuix-main-blur')) {
      attach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  return cleanups;
}

// ── 本地音乐插件歌单 DOM 直接样式 ──
