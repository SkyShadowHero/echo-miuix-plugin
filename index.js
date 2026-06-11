// ── 插件入口 ──
export function activate(ctx) {
  ctx.css.inject(INTERACTIONS_CSS);
  ctx.css.inject(TILT_CSS);

  const tiltCleanups = setupTiltEffect();
  tiltCleanups.forEach((fn) => ctx.dispose(fn));

  const backdropCleanups = setupSelectBackdrop();
  backdropCleanups.forEach((fn) => ctx.dispose(fn));

  const tabCleanups = setupPluginTabs();
  tabCleanups.forEach((fn) => ctx.dispose(fn));

  // 背景色始终启用
  document.documentElement.classList.add('miuix-bg-active');

  // ── 音乐控件模糊开关 ──
  ctx.css.inject(`
    .miuix-player-solid .player-bar {
      background: var(--miuix-background) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `);

  const { defineComponent, defineAsyncComponent, h, reactive } = ctx.vue;
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Button = defineAsyncComponent(ctx.ui.components.Button);

  // ── 渐变装饰控制 ──
  // 用一个 <style> 标签直接控制，不依赖 class 切换
  const accentStyle = document.createElement('style');
  accentStyle.id = 'miuix-accent-style';
  document.head.appendChild(accentStyle);
  ctx.dispose(() => accentStyle.remove());

  function applyAccent(enabled) {
    accentStyle.textContent = enabled ? '' : `
      .sidebar-accent-gradient { display: none !important; }
      .main-content::after { opacity: 0 !important; }
    `;
  }

  function applyPlayerBlur(enabled) {
    document.documentElement.classList.toggle('miuix-player-solid', !enabled);
  }

  // 默认全部开启
  applyAccent(true);
  applyPlayerBlur(true);

  const SettingsPanel = defineComponent({
    setup() {
      const draft = reactive({
        accentEnabled: true,
        playerBlur: true,
      });

      ctx.storage.get('settings').then((saved) => {
        if (saved && typeof saved === 'object') {
          draft.accentEnabled = typeof saved.accentEnabled === 'boolean'
            ? saved.accentEnabled : true;
          draft.playerBlur = typeof saved.playerBlur === 'boolean'
            ? saved.playerBlur : true;
        }
        applyAccent(draft.accentEnabled);
        applyPlayerBlur(draft.playerBlur);
      });

      const save = async () => {
        await ctx.storage.set('settings', {
          accentEnabled: draft.accentEnabled,
          playerBlur: draft.playerBlur,
        });
        ctx.toast.success('设置已保存');
        applyAccent(draft.accentEnabled);
        applyPlayerBlur(draft.playerBlur);
      };

      return () =>
        h('div', { style: 'display: flex; flex-direction: column; align-items: center; gap: 8px;' }, [
          h('div', { class: 'settings-card', style: 'border-radius: 16px; overflow: hidden; width: 100%;' }, [
            h('div', {
              class: 'settings-item',
              style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;',
            }, [
              h('div', { style: 'flex: 1; min-width: 0;' }, [
                h('div', { style: 'font-weight: 600; font-size: 14px; color: var(--miuix-on-background); line-height: 1.4;' }, '侧栏顶部渐变装饰'),
                h('div', { style: 'font-size: 12px; color: var(--miuix-on-background); opacity: 0.6; margin-top: 2px; line-height: 1.5;' }, '侧边栏顶部的主题色渐变氛围层'),
              ]),
              h(Switch, {
                modelValue: draft.accentEnabled,
                'onUpdate:modelValue': (v) => { draft.accentEnabled = Boolean(v); },
              }),
            ]),
            h('div', {
              class: 'settings-item',
              style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;',
            }, [
              h('div', { style: 'flex: 1; min-width: 0;' }, [
                h('div', { style: 'font-weight: 600; font-size: 14px; color: var(--miuix-on-background); line-height: 1.4;' }, '音乐控件背景模糊'),
                h('div', { style: 'font-size: 12px; color: var(--miuix-on-background); opacity: 0.6; margin-top: 2px; line-height: 1.5;' }, '关闭后底部音乐控件背景变为纯色'),
              ]),
              h(Switch, {
                modelValue: draft.playerBlur,
                'onUpdate:modelValue': (v) => { draft.playerBlur = Boolean(v); },
              }),
            ]),
          ]),
          h(Button, { size: 'xs', onClick: save }, { default: () => '保存' }),
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
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
  transform-origin: var(--tilt-origin, center) !important;
}
.miuix-tilt.tilt-active {
  transform: perspective(800px) rotateX(var(--tilt-rx, 0deg)) rotateY(var(--tilt-ry, 0deg)) !important;
}
`;

// ── 卡片 Tilt 按压效果 ──
function setupTiltEffect() {
  const cleanups = [];

  const attach = (cardEl, tiltEl) => {
    if (tiltEl.dataset.tiltAttached) return;
    tiltEl.dataset.tiltAttached = 'true';

    tiltEl.classList.add('miuix-tilt');

    const onDown = (e) => {
      const rect = cardEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;

      tiltEl.style.setProperty('--tilt-rx', `${y < halfH ? 8 : -8}deg`);
      tiltEl.style.setProperty('--tilt-ry', `${x < halfW ? -8 : 8}deg`);
      tiltEl.style.setProperty(
        '--tilt-origin',
        `${x < halfW ? '100%' : '0%'} ${y < halfH ? '100%' : '0%'}`,
      );
      tiltEl.classList.add('tilt-active');
    };
    const onUp = () => tiltEl.classList.remove('tilt-active');
    const onLeave = () => tiltEl.classList.remove('tilt-active');

    cardEl.addEventListener('pointerdown', onDown);
    cardEl.addEventListener('pointerup', onUp);
    cardEl.addEventListener('pointerleave', onLeave);

    cleanups.push(() => {
      cardEl.removeEventListener('pointerdown', onDown);
      cardEl.removeEventListener('pointerup', onUp);
      cardEl.removeEventListener('pointerleave', onLeave);
      tiltEl.classList.remove('miuix-tilt', 'tilt-active');
      delete tiltEl.dataset.tiltAttached;
    });
  };

  const attachCard = (el) => {
    const container = el.querySelector('.card-container');
    if (container) attach(el, container);
  };

  const attachFeature = (el) => {
    attach(el, el);
  };

  document.querySelectorAll('.playlist-card-grid').forEach(attachCard);
  document.querySelectorAll('.album-card').forEach(attachCard);
  document.querySelectorAll('.artist-card.is-singer').forEach(attachCard);
  document.querySelectorAll('.home-feature-card').forEach(attachFeature);

  const observer = new MutationObserver(() => {
    document.querySelectorAll('.playlist-card-grid').forEach((el) => {
      const container = el.querySelector('.card-container');
      if (container && !container.dataset.tiltAttached) attachCard(el);
    });
    document.querySelectorAll('.home-feature-card').forEach((el) => {
      if (!el.dataset.tiltAttached) attachFeature(el);
    });
    document.querySelectorAll('.album-card').forEach((el) => {
      const container = el.querySelector('.card-container');
      if (container && !container.dataset.tiltAttached) attachCard(el);
    });
    document.querySelectorAll('.artist-card.is-singer').forEach((el) => {
      const container = el.querySelector('.card-container');
      if (container && !container.dataset.tiltAttached) attachCard(el);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

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

// ── 插件 Tab 滑动指示器 ──
function setupPluginTabs() {
  const cleanups = [];

  const attach = () => {
    const tabs = document.querySelector('.plugin-view-tabs');
    if (!tabs) return;

    let indicator = tabs.querySelector('.plugin-tab-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'plugin-tab-indicator';
      tabs.appendChild(indicator);
    }

    const move = () => {
      const active = tabs.querySelector('.plugin-view-tab.is-active');
      if (active) {
        indicator.style.transform = `translateX(${active.offsetLeft}px)`;
        indicator.style.width = `${active.offsetWidth}px`;
      }
    };

    move();

    tabs.addEventListener('click', () => requestAnimationFrame(move));
    cleanups.push(() => tabs.removeEventListener('click', move));
  };

  attach();

  const observer = new MutationObserver(() => {
    if (document.querySelector('.plugin-view-tabs') && !document.querySelector('.plugin-tab-indicator')) {
      attach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  return cleanups;
}


