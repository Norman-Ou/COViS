/* global document, window, innerWidth, innerHeight, getComputedStyle, setTimeout, requestAnimationFrame, MutationObserver, Element */
(() => {
  const groups = { global: '#8050bd', sidebar: '#137b70', main: '#326dcc', comparison: '#b5630d', dialog: '#b6366c', scoring: '#2f7d32' };
  const regions = [
    ['01', '顶部应用名称栏', '.topbar', 'global', true],
    ['02', '侧栏收起／展开按钮', '.sidebar-toggle', 'global'],
    ['03', '应用名称', '.topbar > h1', 'global'],
    ['04', '模式导航（T2I-Explorer／Scoring）', '.mode-nav', 'global'],
    ['05', '重新加载数据按钮', '.reload-data', 'sidebar', false, true],
    ['07', '侧边控制栏', '.sidebar:not(.collapsed)', 'sidebar', true],
    ['08', '数据集选择器', '.dataset-selector', 'sidebar'],
    ['09', '浏览模式切换', '.view-mode-selector', 'sidebar'],
    ['10', '样本搜索框', '.sample-search', 'sidebar'],
    ['12', '对比列管理标题与添加按钮', '.selected-title', 'sidebar'],
    ['13', '添加列选择面板', '.picker', 'sidebar', true],
    ['14', '已选对比列卡片', '.selected-card', 'sidebar'],
    ['15', '每页数量设置', '.page-size-control', 'sidebar'],
    ['17', '侧栏宽度调节柄', '.sidebar-resizer', 'sidebar'],
    ['18', '主内容区', '.main-content', 'main', true],
    ['20', '任务／实验卡片区', '.pair-gallery', 'main', true],
    ['21', '任务／实验卡片', '.pair-card', 'main'],
    ['22', '任务／数据集／实验下拉列表', '.selection-column', 'main'],
    ['23', '对比空状态', '.main-content > .empty-state', 'main'],
    ['24', '结果数量与页码摘要', '.main-content > .results-summary', 'comparison'],
    ['25', '样本对比表格', '.comparison-scroll', 'comparison', true],
    ['27', '对比列头', '.column-header', 'comparison'],
    ['28', '对比列拖动手柄', '.drag-handle', 'comparison', false, true],
    ['29', '对比列移动与移除按钮', '.column-actions', 'comparison', false, true],
    ['31', '样本单元格', '.record-cell', 'comparison', true],
    ['32', '样本身份', '.sample-meta', 'comparison', false, true],
    ['33', '图片预览', '.record-cell .media-panels', 'comparison'],
    ['34', '独立图像面板名称', '.record-cell figcaption', 'comparison', false, true],
    ['35', '样本文本区（按标题区分）', '.record-cell > section', 'comparison'],
    ['36', '分页导航', '.pagination', 'comparison'],
    ['37', '提示／错误信息条', '.main-content > .notice, .error-banner', 'main'],
    ['38', '图片详情弹窗', '.lightbox[open]', 'dialog', true],
    ['40', '大图预览区', '.lightbox-image-wrap', 'dialog'],
    ['41', '记录详情面板', '.details-panel', 'dialog', true],
    ['42', '记录身份信息', '.record-identity', 'dialog'],
    ['43', '记录字段／JSON 查看器', '.details-panel > .json-inspector, .details-panel .json-row, .details-panel .disclosure', 'dialog', false, true],
    ['44', '图片缺失／解码错误状态', '.panel-unavailable', 'comparison'],
    ['45', '数据集首页标题区', '.landing-heading', 'main'],
    ['46', '数据集搜索框', '.dataset-search', 'main'],
    ['47', '数据集卡片区', '.dataset-grid', 'main', true],
    ['48', '数据集卡片', '.dataset-card', 'main'],
    ['49', '独立图片面板', '.media-panel', 'comparison', false, true],
    ['50', 'Prompt 展开／收起按钮', '.text-toggle', 'comparison', false, true],
    ['51', '展开／收起全部文本按钮', '.comparison-actions button:first-child', 'comparison', false, true],
    ['52', '清空实验按钮', '.comparison-actions button:last-child', 'comparison', false, true],
    // Scoring mode (/scoring): blind pairwise review.
    ['60', '评分者名字输入框', '.reviewer-prompt', 'scoring', true],
    ['61', '评分集首页（集合卡片）', '.scoring-main .dataset-landing', 'scoring', true],
    ['62', '评分侧栏', '.scoring-sidebar', 'scoring', true],
    ['63', '评分集选择器', '.scoring-sidebar > label:nth-of-type(1)', 'scoring'],
    ['64', '评分者与切换按钮', '.scoring-reviewer', 'scoring'],
    ['65', 'Prefill（agent 预填）选择器', '.scoring-sidebar > label:nth-of-type(2)', 'scoring'],
    ['66', '筛选器（任务对／状态／与预填一致性）', '.scoring-sidebar > label:nth-of-type(3), .scoring-sidebar > label:nth-of-type(4), .scoring-sidebar > label:nth-of-type(5)', 'scoring', false, true],
    ['67', '进度计数', '.scoring-progress', 'scoring'],
    ['68', '导出我的标签按钮', '.scoring-sidebar .button-link', 'scoring', false, true],
    ['69', '条目列表', '.scoring-items', 'scoring', true],
    ['70', '条目按钮（ID／任务对／已选标记）', '.scoring-items button', 'scoring', false, true],
    ['71', '评分主区', '.scoring-main', 'scoring', true],
    ['72', '当前条目', '.scoring-item', 'scoring', true],
    ['73', '条目标题与上一条／下一条', '.scoring-item-header', 'scoring'],
    ['74', '上一条／下一条按钮', '.scoring-nav', 'scoring', false, true],
    ['86', '匿名／真实 切换', '.scoring-anonymity', 'scoring'],
    ['75', '评分说明（可展开）', '.scoring-instructions', 'scoring', false, true],
    ['76', '任务文本', '.scoring-task', 'scoring'],
    ['77', '呈现方式切换', '.scoring-presentations', 'scoring'],
    ['78', '原图与两个候选（图片面板）', '.scoring-item .media-panels', 'scoring', true],
    ['79', '预填结论（agent 选择与理由）', '.scoring-prefill', 'scoring'],
    ['80', '我的标签表单', '.scoring-form', 'scoring', true],
    ['81', '候选 1／候选 2／平局 选择', '.scoring-choice', 'scoring'],
    ['82', '理由输入框', '.scoring-form textarea', 'scoring', false, true],
    ['83', '保存按钮与保存状态', '.scoring-save', 'scoring'],
    ['84', 'Reveal（揭示哪个是预测）', '.scoring-reveal', 'scoring'],
    ['85', '弹窗内任务／预填详情', '.scoring-lightbox-details', 'dialog'],
  ];
  const toolbar = document.getElementById('component-toolbar');
  const overlay = document.getElementById('component-overlay');
  const legend = document.getElementById('component-legend');
  const status = document.getElementById('component-status');
  const enabled = document.getElementById('show-annotations');
  const level = document.getElementById('annotation-level');
  let queued = false;
  let targets = [];
  let signature = '';
  let focused = '';

  function clippedRect(item, top) {
    const source = item.element.getBoundingClientRect();
    const rect = { left: Math.max(0, source.left), right: Math.min(innerWidth, source.right), top: Math.max(top, source.top), bottom: Math.min(innerHeight, source.bottom) };
    if (!document.querySelector('.lightbox[open]') && item.group !== 'global') rect.top = Math.max(rect.top, document.querySelector('.topbar')?.getBoundingClientRect().bottom || top);
    for (let parent = item.element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
      const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
      if (!clipX && !clipY) continue;
      const bounds = parent.getBoundingClientRect();
      if (clipX) { rect.left = Math.max(rect.left, bounds.left); rect.right = Math.min(rect.right, bounds.right); }
      if (clipY) { rect.top = Math.max(rect.top, bounds.top); rect.bottom = Math.min(rect.bottom, bounds.bottom); }
    }
    return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, clippedTop: source.top < rect.top };
  }

  function scan() {
    targets = [];
    for (const [id, name, selector, group, region, detail] of regions) {
      if (level.value === 'regions' && !region) continue;
      if (level.value === 'components' && detail) continue;
      document.querySelectorAll(selector).forEach((element, index) => {
        const textTitle = id === '35' ? element.querySelector('h2')?.textContent : '';
        targets.push({ id, name: textTitle ? `${name.split('（')[0]} · ${textTitle}` : name, element, group, region, detail, index });
      });
    }
    schedule();
  }

  function paint() {
    queued = false;
    overlay.hidden = !enabled.checked;
    if (!enabled.checked) return;
    const top = toolbar.getBoundingClientRect().bottom;
    const modal = document.querySelector('.lightbox[open]');
    // Keep annotations above the native dialog's top layer while it is open.
    const host = modal || document.body;
    if (overlay.parentElement !== host) host.appendChild(overlay);
    const visible = targets.filter(item => !modal || modal.contains(item.element) || modal === item.element).map(item => ({ ...item, rect: clippedRect(item, top) })).filter(item => {
      const r = item.rect;
      return item.element.getClientRects().length && getComputedStyle(item.element).visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > top && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
    const fragment = document.createDocumentFragment();
    visible.forEach(item => {
      const r = item.rect;
      const box = document.createElement('div');
      box.className = `component-box${item.region ? ' region' : ''}${item.detail ? ' compact' : ''}${focused === item.id ? ' highlight' : ''}`;
      const left = Math.max(0, r.left);
      const y = Math.max(top, r.top);
      Object.assign(box.style, { left: `${left}px`, top: `${y - top}px`, width: `${Math.min(innerWidth, r.right) - left}px`, height: `${Math.min(innerHeight, r.bottom) - y}px` });
      box.style.setProperty('--mark-color', groups[item.group]);
      const badge = document.createElement('span');
      badge.className = 'component-badge';
      badge.textContent = `${item.id} ${item.name}`;
      if (r.clippedTop) badge.style.top = '2px';
      badge.title = `${item.name}\n定位：${regions.find(region => region[0] === item.id)[2]}\n同类组件共用编号；可在顶部切换标注层级。`;
      box.appendChild(badge);
      fragment.appendChild(box);
    });
    overlay.replaceChildren(fragment);
    status.textContent = `当前视口标注 ${visible.length} 个组件`;
    const nextSignature = targets.map(item => item.id).join(',');
    if (nextSignature !== signature) {
      signature = nextSignature;
      renderLegend();
    }
  }

  function renderLegend() {
    legend.replaceChildren();
    const intro = document.createElement('p');
    intro.textContent = '同类组件共用编号。点击名称可滚动定位；打开对比列、选择面板或图片弹窗后，标注会自动更新。';
    legend.appendChild(intro);
    regions.forEach(([id, name, , group]) => {
      const matches = targets.filter(item => item.id === id);
      if (!matches.length) return;
      const button = document.createElement('button');
      const dot = document.createElement('span');
      dot.className = 'component-dot';
      dot.style.background = groups[group];
      const text = document.createElement('span');
      text.textContent = `${id} ${name}`;
      const count = document.createElement('small');
      count.textContent = `×${matches.length}`;
      button.append(dot, text, count);
      button.addEventListener('click', () => {
        focused = id;
        matches[0].element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        schedule();
        setTimeout(() => { focused = ''; schedule(); }, 2000);
      });
      legend.appendChild(button);
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  }
  // Overlay is outside the React root except inside an open native dialog.
  // Ignore its own mutations to avoid a render/observer loop.
  const observerRoot = document.getElementById('root');
  const safeObserver = new MutationObserver(records => {
    if (records.some(record => !overlay.contains(record.target) && record.target !== overlay && !(record.target instanceof Element && record.target.closest('#component-overlay')))) scan();
  });
  safeObserver.observe(observerRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open', 'hidden', 'aria-expanded'] });
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', scan);
  window.addEventListener('load', scan);
  document.addEventListener('load', schedule, true);
  enabled.addEventListener('change', () => { overlay.hidden = !enabled.checked; scan(); });
  level.addEventListener('change', () => { signature = ''; scan(); });
  document.getElementById('legend-toggle').addEventListener('click', event => {
    legend.hidden = !legend.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!legend.hidden));
  });
  scan();
})();
