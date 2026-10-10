(function () {
  'use strict';

  var AXES = window.AXES || [];
  var IDEOLOGIES = window.IDEOLOGIES || [];
  var FULL_QUESTIONS = window.QUESTIONS || [];
  var QUESTIONS = FULL_QUESTIONS; // 当前模式下的题目集
  var MODE = 200;                 // 当前模式：50 / 100 / 200
  var lastGov = null;             // 最近一次政府适配度结果（供提交与分享图使用）

  var axisKeys = AXES.map(function (a) { return a.key; });

  // ---------- 主题切换（白天 / 夜间） ----------
  var THEME_ANIM_MS = 380; // 过渡时长，须与 CSS 一致
  function applyTheme(t, animate) {
    // 仅切换动作触发过渡动效；首屏初始化不带动画，避免加载闪烁
    if (animate !== false) {
      document.documentElement.classList.add('theme-anim');
      clearTimeout(window.__themeAnimTimer);
      window.__themeAnimTimer = setTimeout(function () {
        document.documentElement.classList.remove('theme-anim');
      }, THEME_ANIM_MS + 80);
    }
    document.documentElement.setAttribute('data-theme', t);
    var btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem('ideology-theme', t); } catch (e) { /* ignore */ }
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('ideology-theme'); } catch (e) { /* ignore */ }
  if (!savedTheme) {
    savedTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  applyTheme(savedTheme, false);
  document.getElementById('themeToggle').addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // ---------- 模式：按五大主题（id 区间）均匀抽样 ----------
  var THEME_BANDS = [
    { name: '经济', min: 1, max: 40 },
    { name: '社会', min: 41, max: 80 },
    { name: '文化', min: 81, max: 120 },
    { name: '平权环保', min: 121, max: 160 },
    { name: '权力秩序', min: 161, max: 200 }
  ];

  function bandOf(qid) {
    for (var i = 0; i < THEME_BANDS.length; i++) {
      if (qid >= THEME_BANDS[i].min && qid <= THEME_BANDS[i].max) return THEME_BANDS[i].name;
    }
    return '通用';
  }

  function questionsForMode(mode) {
    if (!FULL_QUESTIONS.length) return [];
    if (mode >= FULL_QUESTIONS.length) return FULL_QUESTIONS.slice();
    var per = Math.max(1, Math.round(mode / THEME_BANDS.length));
    var byBand = {};
    FULL_QUESTIONS.forEach(function (q) {
      var b = bandOf(q.id);
      (byBand[b] = byBand[b] || []).push(q);
    });
    var out = [];
    Object.keys(byBand).forEach(function (b) {
      var arr = byBand[b];
      var n = Math.min(per, arr.length);
      var step = arr.length / n;
      for (var i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    });
    // 保证最终数量精确（末尾补/裁）
    if (out.length > mode) out = out.slice(0, mode);
    else {
      // 不足则从剩余题中按 id 补足
      var picked = {};
      out.forEach(function (q) { picked[q.id] = true; });
      var rest = FULL_QUESTIONS.filter(function (q) { return !picked[q.id]; });
      for (var j = 0; out.length < mode && j < rest.length; j++) out.push(rest[j]);
    }
    return out;
  }

  function setMode(mode) {
    MODE = mode;
    QUESTIONS = questionsForMode(mode);
    answers = {}; currentIndex = 0;
    document.querySelectorAll('#modeGroup .mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === String(mode));
    });
    var hint = document.getElementById('modeHint');
    if (hint) {
      hint.textContent = mode === 50 ? '约 5 分钟 · 覆盖五大主题各 10 题'
        : mode === 100 ? '约 10 分钟 · 覆盖五大主题各 20 题'
        : '约 20 分钟 · 全部 200 题';
    }
    renderQuestion();
    renderTestProgress();
    toggleSubmit();
  }

  document.querySelectorAll('#modeGroup .mode-btn').forEach(function (b) {
    b.addEventListener('click', function () { setMode(parseInt(b.getAttribute('data-mode'), 10)); });
  });

  // ---------- 视图切换 ----------
  var navLinks = document.querySelectorAll('#mainNav .nav-link');
  var views = {
    home: document.getElementById('view-home'),
    catalog: document.getElementById('view-catalog'),
    test: document.getElementById('view-test'),
    compare: document.getElementById('view-compare'),
    result: document.getElementById('view-result')
  };

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle('active', k === name);
    });
    navLinks.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    document.getElementById('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navLinks.forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });
  document.querySelectorAll('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-goto')); });
  });

  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');
  navToggle.addEventListener('click', function () { mainNav.classList.toggle('open'); });

  // ---------- 意识形态卡片 + 弹窗 ----------
  function renderCatalog() {
    var grid = document.getElementById('ideoGrid');
    grid.innerHTML = '';
    IDEOLOGIES.forEach(function (ideo) {
      var card = document.createElement('div');
      card.className = 'ideo-card';
      card.style.setProperty('--card-color', ideo.color);
      card.innerHTML = '<h3>' + ideo.name + '</h3>' +
        '<div class="en">' + ideo.nameEn + '</div>' +
        '<div class="tag">' + ideo.tagline + '</div>';
      card.addEventListener('click', function () { openModal(ideo); });
      grid.appendChild(card);
    });
  }

  function miniAxesHtml(ideo) {
    var html = '<div class="mini-axes">';
    AXES.forEach(function (a) {
      var v = ideo.axes[a.key];
      var pos = (v + 100) / 2; // 0..100
      html += '<div class="mini-axis"><span>' + a.name + '</span>' +
        '<div class="mini-track"><div class="mini-dot" style="left:' + pos + '%"></div></div></div>';
    });
    html += '</div>';
    return html;
  }

  function openModal(ideo) {
    var modal = document.getElementById('ideoModal');
    var card = document.getElementById('ideoModalCard');
    var thinkers = (ideo.thinkers && ideo.thinkers.length) ? ideo.thinkers.join('、') : '—';
    var tenets = (ideo.tenets || []).map(function (t) { return '<li>' + t + '</li>'; }).join('');
    card.innerHTML = '<button class="modal-close" data-close="1">×</button>' +
      '<h2>' + ideo.name + '</h2>' +
      '<div class="en">' + ideo.nameEn + '</div>' +
      '<div class="modal-tag">' + ideo.tagline + '</div>' +
      '<p style="font-size:14.5px;color:var(--text-soft);margin:0 0 4px">' + ideo.summary + '</p>' +
      '<h4>核心主张</h4><ul>' + tenets + '</ul>' +
      '<h4>代表人物 / 流派</h4><p style="font-size:14px;color:var(--text-soft);margin:0">' + thinkers + '</p>' +
      '<h4>维度画像</h4>' + miniAxesHtml(ideo);
    modal.hidden = false;
    card.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { modal.hidden = true; });
    });
  }
  document.getElementById('ideoModal').querySelector('.modal-backdrop')
    .addEventListener('click', function () { document.getElementById('ideoModal').hidden = true; });

  // ---------- 测试（逐题模式） ----------
  var answers = {}; // id -> optionIndex
  var currentIndex = 0; // 当前题目序号（0-based）

  function renderTestProgress() {
    var answered = Object.keys(answers).length;
    var fill = document.getElementById('progressFill');
    var text = document.getElementById('progressText');
    fill.style.width = (QUESTIONS.length ? (answered / QUESTIONS.length * 100) : 0) + '%';
    text.textContent = '已答 ' + answered + ' / ' + QUESTIONS.length;
  }

  function renderQuestion() {
    var q = QUESTIONS[currentIndex];
    if (!q) return;
    var card = document.getElementById('questionCard');
    card.className = 'question-card single';
    var chosen = (typeof answers[q.id] === 'number') ? answers[q.id] : -1;
    var opts = q.options.map(function (o, idx) {
      var sel = (idx === chosen) ? ' selected' : '';
      return '<div class="option' + sel + '" data-qid="' + q.id + '" data-oidx="' + idx + '">' +
        '<div class="marker">' + (idx === chosen ? '✓' : '') + '</div>' +
        '<div class="opt-text">' + escapeHtml(o.text) + '</div></div>';
    }).join('');
    card.innerHTML =
      '<div class="q-top"><span class="q-num">第 ' + (currentIndex + 1) + ' / ' + QUESTIONS.length + ' 题</span>' +
      '<span class="q-theme">主题 · ' + escapeHtml(q.theme || '通用') + '</span></div>' +
      '<div class="q-stem">' + escapeHtml(q.stem) + '</div>' +
      '<div class="options">' + opts + '</div>';

    card.querySelectorAll('.option').forEach(function (el) {
      el.addEventListener('click', function () {
        var qid = parseInt(el.getAttribute('data-qid'), 10);
        var oidx = parseInt(el.getAttribute('data-oidx'), 10);
        answers[qid] = oidx;
        card.querySelectorAll('.option').forEach(function (o) {
          o.classList.remove('selected');
          o.querySelector('.marker').textContent = '';
        });
        el.classList.add('selected');
        el.querySelector('.marker').textContent = '✓';
        renderTestProgress();
        // 选完自动切换到下一题
        setTimeout(function () {
          if (currentIndex < QUESTIONS.length - 1) {
            currentIndex++;
            renderQuestion();
          } else {
            document.getElementById('testSubmitWrap').hidden = false;
          }
        }, 320);
      });
    });

    document.getElementById('pageIndicator').textContent =
      '第 ' + (currentIndex + 1) + ' / ' + QUESTIONS.length + ' 题';
    document.getElementById('prevBtn').disabled = currentIndex === 0;
    document.getElementById('nextBtn').disabled = currentIndex >= QUESTIONS.length - 1;
    renderTestProgress();
    toggleSubmit();
  }

  function toggleSubmit() {
    var wrap = document.getElementById('testSubmitWrap');
    var allAnswered = Object.keys(answers).length >= QUESTIONS.length;
    var atLast = currentIndex >= QUESTIONS.length - 1;
    wrap.hidden = !(allAnswered || atLast);
  }

  document.getElementById('prevBtn').addEventListener('click', function () {
    if (currentIndex > 0) { currentIndex--; renderQuestion(); }
  });
  document.getElementById('nextBtn').addEventListener('click', function () {
    if (currentIndex < QUESTIONS.length - 1) { currentIndex++; renderQuestion(); }
  });
  document.getElementById('resetBtn').addEventListener('click', function () {
    answers = {}; currentIndex = 0; renderQuestion();
  });

  // 昵称记忆
  var userNameEl = document.getElementById('userName');
  if (userNameEl) {
    try { userNameEl.value = localStorage.getItem('ideology-username') || ''; } catch (e) { /* ignore */ }
    userNameEl.addEventListener('change', function () {
      try { localStorage.setItem('ideology-username', userNameEl.value.trim()); } catch (e) { /* ignore */ }
    });
  }

  // ---------- 计分与结果 ----------
  function computeUserAxes() {
    var sum = {};
    axisKeys.forEach(function (k) { sum[k] = 0; });
    QUESTIONS.forEach(function (q) {
      var oidx = answers[q.id];
      if (typeof oidx !== 'number') return;
      var opt = q.options[oidx];
      if (!opt || !opt.scores) return;
      axisKeys.forEach(function (k) {
        if (typeof opt.scores[k] === 'number') sum[k] += opt.scores[k];
      });
    });
    var norm = {};
    axisKeys.forEach(function (k) {
      // 基准 = 每道题在该轴上「可选的最强力度」之和；
      // 这样若用户每题都选最极端的那个选项，该轴可达 ±100，各轴基准一致、可比。
      var maxAbs = 0;
      QUESTIONS.forEach(function (q) {
        var mx = 0;
        q.options.forEach(function (o) {
          if (o.scores && typeof o.scores[k] === 'number') {
            var a = Math.abs(o.scores[k]);
            if (a > mx) mx = a;
          }
        });
        maxAbs += mx;
      });
      var v = maxAbs > 0 ? (sum[k] / maxAbs) * 100 : 0;
      norm[k] = Math.max(-100, Math.min(100, Math.round(v)));
    });
    return norm;
  }

  function computeMatches(userAxes) {
    var maxDist = Math.sqrt(axisKeys.length * Math.pow(200, 2)); // 每个轴最大差 200
    return IDEOLOGIES.map(function (ideo) {
      var d2 = 0;
      axisKeys.forEach(function (k) {
        var diff = userAxes[k] - ideo.axes[k];
        d2 += diff * diff;
      });
      var dist = Math.sqrt(d2);
      var similarity = Math.max(0, 100 * (1 - dist / maxDist));
      return { ideo: ideo, similarity: similarity, dist: dist };
    }).sort(function (a, b) { return b.similarity - a.similarity; });
  }

  // ---------- 报告叙述与维度解读 ----------
  function describeAxis(value, axis) {
    var abs = Math.abs(value);
    var pole = value < -5 ? axis.left : (value > 5 ? axis.right : null);
    var desc = value < -5 ? axis.leftDesc : (value > 5 ? axis.rightDesc : null);
    var deg = abs >= 60 ? '显著' : (abs >= 25 ? '偏向' : (abs > 5 ? '轻微' : '中立'));
    return { pole: pole, desc: desc, deg: deg, abs: abs };
  }

  function closestAxes(ideo, userAxes) {
    return AXES.map(function (a) {
      return { a: a, d: Math.abs((userAxes[a.key] || 0) - ideo.axes[a.key]) };
    }).sort(function (x, y) { return x.d - y.d; }).slice(0, 2).map(function (o) { return o.a.name; });
  }

  function buildNarrative(userAxes, matches) {
    var top = matches[0], second = matches[1];
    var blend = top && second && (top.similarity - second.similarity) < 8;
    if (!top) return '<h3>综合结论</h3><p>暂无可分析的数据。</p>';
    var html = '<h3>综合结论</h3>';

    // 总括句
    var lead = '总体而言，你的立场以 <span class="hl">' + top.ideo.name + '</span> 为核心特征';
    if (blend && second) {
      lead += '，同时与 <span class="hl">' + second.ideo.name + '</span> 高度交融，呈现混合光谱';
    } else if (second) {
      lead += '，与次接近的 ' + second.ideo.name + ' 拉开明显距离';
    }
    lead += '（与最贴近流派的匹配度为 ' + top.similarity.toFixed(0) + '%）。';
    html += '<p>' + lead + '</p>';

    // 核心维度倾向
    var strong = AXES.map(function (a) { return { a: a, v: userAxes[a.key] }; })
      .filter(function (o) { return Math.abs(o.v) > 10; })
      .sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); }).slice(0, 3);
    if (strong.length) {
      var txt = strong.map(function (o) {
        var d = describeAxis(o.v, o.a);
        return '在「' + o.a.name + '」上' + d.deg + (d.pole || '中立') + (d.desc ? '（' + d.desc + '）' : '');
      }).join('；');
      html += '<p>从维度画像看，你' + txt + '。这些倾向共同勾勒出你的主要政治性格。</p>';
    }

    // 与最贴近流派的主要差异
    if (second) {
      var diffAxes = AXES.map(function (a) {
        return { a: a, d: Math.abs(userAxes[a.key] - top.ideo.axes[a.key]) };
      }).sort(function (x, y) { return y.d - x.d; });
      var big = diffAxes.filter(function (o) { return o.d >= 30; }).slice(0, 2);
      if (big.length) {
        var dtxt = big.map(function (o) {
          var d = describeAxis(userAxes[o.a.key], o.a);
          var their = top.ideo.axes[o.a.key] < 0 ? ('偏向' + o.a.left) : (top.ideo.axes[o.a.key] > 0 ? ('偏向' + o.a.right) : '中立');
          return '在「' + o.a.name + '」上你' + (d.pole ? ('偏向' + d.pole) : '较为中立') + '，而' + top.ideo.name + '则' + their;
        }).join('；');
        html += '<p>需要指出的是，' + dtxt + '，这构成了你与该流派的主要分歧点。</p>';
      }
    }

    html += '<p style="color:var(--text-soft);font-size:13px">注：意识形态光谱是连续的，标签仅为近似；匹配度为与各流派档案在 10 个维度上的整体接近程度。报告中的全部数值均由你的作答按 10 个维度的加权倾向自动生成。</p>';
    return html;
  }

  function renderAxisInterpret(userAxes) {
    var el = document.getElementById('axisInterpret');
    var html = '<h3>你的维度解读（10 个维度，-100 ~ +100）</h3>';
    AXES.forEach(function (a) {
      var d = describeAxis(userAxes[a.key], a);
      html += '<div class="ai-row"><span class="ai-name">' + a.name + '</span> ' +
        '<span style="color:var(--text-soft)">' + (d.pole ? (d.deg + d.pole) : '接近中立') + '</span>' +
        '<div class="ai-desc">' + (d.desc || '') + '　数值 ' + userAxes[a.key] + '</div></div>';
    });
    el.innerHTML = html;
  }

  function renderResults() {
    var userAxes = computeUserAxes();
    var matches = computeMatches(userAxes);
    window.__lastAxes = userAxes;
    window.__lastMatches = matches;

    // 叙述性结论
    document.getElementById('reportNarrative').innerHTML = buildNarrative(userAxes, matches);

    // 匹配列表
    var matchList = document.getElementById('matchList');
    matchList.innerHTML = '';
    matches.slice(0, 5).forEach(function (m, i) {
      var item = document.createElement('div');
      item.className = 'match-item';
      item.style.setProperty('--m-color', m.ideo.color);
      var label = i === 0 ? '最贴近' : '第 ' + (i + 1) + ' 接近';
      var ca = closestAxes(m.ideo, userAxes);
      item.innerHTML = '<h3><span class="pct">' + m.similarity.toFixed(0) + '%</span> ' +
        '<span>' + m.ideo.name + '</span> <span class="en">' + m.ideo.nameEn + '</span></h3>' +
        '<div class="match-bar"><div style="width:' + m.similarity + '%"></div></div>' +
        '<p><strong>' + label + '。</strong>' + m.ideo.tagline + '</p>' +
        '<p style="font-size:13px;color:var(--text-soft)">主要契合维度：' + ca.join('、') + '</p>';
      matchList.appendChild(item);
    });

    // 最矛盾的意识形态（匹配度最低的流派）
    var conflictBox = document.getElementById('conflictBox');
    if (conflictBox && matches.length) {
      var worst = matches[matches.length - 1];
      // 找出你与该流派分歧最大的维度
      var divAxes = AXES.map(function (a) {
        return { a: a, d: Math.abs(userAxes[a.key] - worst.ideo.axes[a.key]) };
      }).sort(function (x, y) { return y.d - x.d; }).slice(0, 3);
      var divTxt = divAxes.map(function (o) {
        return o.a.name + '（相差 ' + o.d + '）';
      }).join('、');
      conflictBox.innerHTML = '<h3>与你最矛盾的意识形态：' + worst.ideo.name + ' <span class="en">' + worst.ideo.nameEn + '</span></h3>' +
        '<p style="color:var(--text-soft)">匹配度仅 ' + worst.similarity.toFixed(0) + '%，为所有流派中最低。<br>' +
        '主要分歧维度：' + divTxt + '。<br>' + worst.ideo.tagline + '</p>';
    }

    // 维度解读
    renderAxisInterpret(userAxes);

    // 雷达图
    drawRadar('radar', userAxes, matches.slice(0, 3));

    // 轴条
    var bars = document.getElementById('axisBars');
    var html = '<h3>各维度得分</h3>';
    AXES.forEach(function (a) {
      var v = userAxes[a.key];
      var pos = (v + 100) / 2;
      html += '<div class="axis-row"><span class="label">' + a.name + '</span>' +
        '<div class="axis-track"><div class="axis-dot" style="left:' + pos + '%"></div></div>' +
        '<span class="axis-val">' + v + '</span></div>';
    });
    bars.innerHTML = html;

    // 详细对比表
    var top = matches.slice(0, 4);
    var detail = document.getElementById('resultDetail');
    var head = '<th>维度</th><th>你</th>' + top.map(function (m) {
      return '<th style="color:' + m.ideo.color + '">' + m.ideo.name + '</th>';
    }).join('') + '</tr>';
    var rows = AXES.map(function (a) {
      var cells = top.map(function (m) {
        return '<td>' + m.ideo.axes[a.key] + '</td>';
      }).join('');
      return '<tr><td class="name">' + a.name + '</td><td><strong>' + userAxes[a.key] + '</strong></td>' + cells + '</tr>';
    }).join('');
    detail.innerHTML = '<h3>你的立场 vs 最贴近的意识形态（数值为 -100 ~ +100）</h3>' +
      '<table><thead><tr>' + head + '</thead><tbody>' + rows + '</tbody></table>';

    // 统一解析
    renderAnswerAnalysis();

    // 与中国政府（当代）的适配度
    renderGovFit(userAxes);

    // 移民适配推荐
    renderMigration(userAxes);

    // 提交到后端（记录答题，用于管理员统计）
    submitToBackend(userAxes, matches);

    showView('result');
  }

  function renderAnswerAnalysis() {
    var el = document.getElementById('answerAnalysis');
    if (!el) return;
    var answered = Object.keys(answers).length;
    if (!answered) { el.innerHTML = ''; return; }
    // 按主题分组
    var groups = {};
    var order = [];
    QUESTIONS.forEach(function (q) {
      var oidx = answers[q.id];
      if (typeof oidx !== 'number') return;
      var theme = q.theme || '通用';
      if (!groups[theme]) { groups[theme] = []; order.push(theme); }
      groups[theme].push({ q: q, oidx: oidx });
    });
    var html = '<details class="ana-details">' +
      '<summary>题目统一解析（共 ' + answered + ' 题，按主题分组）<span class="ana-hint">点击展开查看每题解析</span></summary>' +
      '<div class="ana-body">' +
      '<p style="color:var(--text-soft);font-size:13px;margin:0 0 8px">以下为你在每题所选选项对应的意识形态倾向解析。</p>';
    order.forEach(function (theme) {
      html += '<div class="ana-group"><h4>' + escapeHtml(theme) + '（' + groups[theme].length + '）</h4>';
      groups[theme].forEach(function (item) {
        var q = item.q, opt = q.options[item.oidx];
        html += '<div class="ana-item">' +
          '<div class="ana-q">#' + q.id + '　' + escapeHtml(q.stem) + '</div>' +
          '<div class="ana-a"><span class="ana-pick">你的选择</span>' + escapeHtml(opt.text) + '</div>' +
          '<div class="ana-txt"><span class="ana-label">解析</span>' + escapeHtml(opt.analysis || '') + '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    html += '</div></details>';
    el.innerHTML = html;
  }

  function renderGovFit(userAxes) {
    var el = document.getElementById('govFit');
    if (!el || !window.GOV_PROFILE) return;
    var gov = window.GOV_PROFILE;

    var rows = AXES.map(function (a) {
      var u = userAxes[a.key] || 0, g = gov.axes[a.key];
      var diff = u - g;
      var single = Math.max(0, Math.min(100, 100 - Math.abs(diff)));
      return { a: a, u: u, g: g, diff: diff, single: single };
    });
    // 整体适配度 = 10 个维度单维契合度的平均值（与单维口径一致：差值即差异百分比）
    var overall = Math.round(rows.reduce(function (s, r) { return s + r.single; }, 0) / rows.length);
    var maxFit = rows.slice().sort(function (x, y) { return y.single - x.single; })[0];
    var maxDiff = rows.slice().sort(function (x, y) { return Math.abs(y.diff) - Math.abs(x.diff); })[0];
    var grade = overall >= 75 ? '高度契合' : (overall >= 55 ? '总体契合' : (overall >= 40 ? '部分契合' : '差异显著'));
    var gradeNote = {
      '高度契合': '你与政府画像在多数维度上立场一致，仅个别维度存在小幅差异。',
      '总体契合': '你与政府画像整体方向接近，但在若干维度上存在明显分歧。',
      '部分契合': '你与政府画像在部分维度立场一致，同时有多个维度分歧较大。',
      '差异显著': '你与政府画像在多数维度上立场相左，整体匹配度较低。'
    }[grade];

    var html = '<h3>与中国政府（当代）的适配度分析</h3>';
    html += '<p style="color:var(--text-soft);font-size:13px">' + escapeHtml(gov.note) + '</p>';
    html += '<div class="gov-overall">整体适配度：<span class="gov-pct">' + overall.toFixed(0) + '%</span> <span class="gov-grade">（' + grade + '）</span></div>';
    html += '<p class="gov-note">' + gradeNote + ' 整体适配度为 10 个维度单维契合度的平均值，单维契合 = 100 − |你的得分 − 政府画像|。</p>';

    var head = '<th>维度</th><th>你的得分</th><th>政府画像</th><th>差值</th><th>单维契合</th>';
    var body = rows.map(function (r) {
      var sign = r.diff > 0 ? '+' : '';
      return '<tr><td class="name">' + r.a.name + '</td><td><strong>' + r.u + '</strong></td><td>' + r.g + '</td><td>' + sign + r.diff + '</td><td>' + r.single.toFixed(0) + '%</td></tr>';
    }).join('');
    html += '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';

    var uPole = maxDiff.u < 0 ? maxDiff.a.left : (maxDiff.u > 0 ? maxDiff.a.right : '中立');
    var gPole = maxDiff.g < 0 ? maxDiff.a.left : (maxDiff.g > 0 ? maxDiff.a.right : '中立');
    html += '<p>从各维度看，你在「' + maxFit.a.name + '」上与政府画像最为接近（契合度 ' + maxFit.single.toFixed(0) + '%）；在「' + maxDiff.a.name + '」上分歧最大（差值 ' + (maxDiff.diff > 0 ? '+' : '') + maxDiff.diff + '）：你' + (uPole === '中立' ? '接近中立' : ('偏向' + uPole)) + '，政府' + (gPole === '中立' ? '接近中立' : ('偏向' + gPole)) + '。</p>';

    el.innerHTML = html;
    lastGov = { overall: overall, grade: grade, rows: rows };
    window.__lastGov = lastGov;
  }

  // ---------- 移民适配推荐（社会气候参考） ----------
  function renderMigration(userAxes) {
    var el = document.getElementById('migrationFit');
    var countries = window.MIGRATION_COUNTRIES;
    if (!el || !countries || !countries.length) return;

    var rows = countries.map(function (c) {
      var dims = AXES.map(function (a) {
        var u = userAxes[a.key] || 0, g = c.axes[a.key];
        var single = Math.max(0, Math.min(100, 100 - Math.abs(u - g)));
        return { a: a, u: u, g: g, single: single };
      });
      var overall = Math.round(dims.reduce(function (s, r) { return s + r.single; }, 0) / dims.length);
      var best = dims.slice().sort(function (x, y) { return y.single - x.single; });
      var worst = dims.slice().sort(function (x, y) { return Math.abs(y.u - y.g) - Math.abs(x.u - x.g); });
      return { c: c, overall: overall, best: best, worst: worst };
    }).sort(function (x, y) { return y.overall - x.overall; });

    var top3 = rows.slice(0, 3);
    var others = rows.slice(3, 15);

    var cards = top3.map(function (r, i) {
      var fitDim = r.best.slice(0, 2).map(function (d) {
        return d.a.name + '（' + d.single.toFixed(0) + '%）';
      }).join('、');
      var w = r.worst[0];
      var warn = Math.abs(w.u - w.g) > 25
        ? '注意分歧：「' + w.a.name + '」你偏' + (w.u < 0 ? w.a.left : (w.u > 0 ? w.a.right : '中立')) + '，该国偏' + (w.g < 0 ? w.a.left : (w.g > 0 ? w.a.right : '中立')) + '（差 ' + Math.abs(w.u - w.g) + '）'
        : '各维度无明显冲突';
      return '<div class="mig-card" style="--mc:' + r.c.color + '">' +
        '<div class="mig-top"><span class="mig-rank">№' + (i + 1) + '</span>' +
        '<span class="mig-name">' + r.c.name + ' <em>' + r.c.nameEn + '</em></span>' +
        '<span class="mig-pct">' + r.overall + '%</span></div>' +
        '<span class="mig-ideo">' + escapeHtml(r.c.ideo) + '</span>' +
        '<div class="mig-bar"><div style="width:' + r.overall + '%"></div></div>' +
        '<p class="mig-tag">' + escapeHtml(r.c.tag) + '</p>' +
        '<p class="mig-dim">最契合：' + fitDim + '</p>' +
        '<p class="mig-warn">' + warn + '</p>' +
        '</div>';
    }).join('');

    var othersHtml = others.map(function (r) {
      return '<div class="mig-line"><span class="mig-line-name">' + r.c.name + ' <em>' + r.c.nameEn + '</em></span>' +
        '<span class="mig-line-bar"><i style="width:' + r.overall + '%"></i></span>' +
        '<span class="mig-line-pct">' + r.overall + '%</span></div>';
    }).join('');

    var html = '<h3>移民适配推荐（社会气候参考）</h3>';
    html += '<p style="color:var(--text-soft);font-size:13px">基于你的 10 维立场画像，与 ' + countries.length + ' 个国家（覆盖北欧社会民主、自由主义、保守传统、民族威权、宗教保守、发展威权、平等进步等全球主要意识形态谱系）的社会气候画像匹配（契合度 = 10 维「100 − |差值|」均值，口径与政府适配一致）。以下按契合度从高到低排列。</p>';
    html += '<div class="mig-grid">' + cards + '</div>';
    html += '<h4 class="mig-more-title">其他值得参考</h4><div class="mig-list">' + othersHtml + '</div>';
    html += '<p class="mig-disclaimer">本板块仅基于各国主流社会政治气候的客观匹配，不构成移民建议。实际移民需综合评估签证政策、经济成本、语言文化、家庭规划等现实条件，请以官方渠道信息为准。</p>';

    el.innerHTML = html;
  }

  // ---------- 提交结果到后端（记录答题） ----------
  function submitToBackend(userAxes, matches) {
    if (!window.fetch) return;
    var top = matches[0];
    var payload = {
      mode: String(MODE),
      username: (userNameEl ? userNameEl.value.trim() : '') || '匿名',
      axes: userAxes,
      topMatch: top ? { name: top.ideo.name, nameEn: top.ideo.nameEn, similarity: Math.round(top.similarity) } : null,
      topMatches: matches.slice(0, 5).map(function (m) {
        return { name: m.ideo.name, nameEn: m.ideo.nameEn, similarity: Math.round(m.similarity) };
      }),
      govFit: lastGov ? { overall: lastGov.overall, grade: lastGov.grade } : null
    };
    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () { /* 后端不可用时静默失败，不影响用户体验 */ });
  }

  function exportReport() {
    var get = function (id) { var el = document.getElementById(id); return el ? el.innerHTML : ''; };
    var narrative = get('reportNarrative');
    var matchList = get('matchList');
    var conflictBox = get('conflictBox');
    var axisInterpret = get('axisInterpret');
    var radar = get('radar');
    var axisBars = get('axisBars');
    var detail = get('resultDetail');
    var analysis = get('answerAnalysis');
    var migration = get('migrationFit');
    var ts = new Date().toLocaleString('zh-CN');
    var body =
      '<div class="card">' + narrative + '</div>' +
      '<div class="card"><h3>最贴近的意识形态</h3>' + matchList + '</div>' +
      (conflictBox ? '<div class="card">' + conflictBox + '</div>' : '') +
      '<div class="card"><h3>你的维度画像</h3>' + radar + '<div style="margin-top:14px">' + axisBars + '</div></div>' +
      '<div class="card">' + axisInterpret + '</div>' +
      '<div class="card">' + detail + '</div>' +
      '<div class="card">' + analysis + '</div>' +
      '<div class="card">' + get('govFit') + '</div>' +
      (migration ? '<div class="card">' + migration + '</div>' : '');
    var css = ':root{--bg:#faf9f6;--bg-elev:#fff;--bg-soft:#f1efe9;--text:#23211c;--text-soft:#6f6a5f;--border:#e4e0d7;--accent:#8a5a2b;--primary:#23211c;--serif:"Noto Serif SC",Georgia,"Times New Roman",serif}' +
      '*{box-sizing:border-box}body{font-family:var(--serif);background:var(--bg);color:var(--text);line-height:1.85;margin:0;padding:42px 0}' +
      '.wrap{width:min(900px,92vw);margin:0 auto}h1{font-size:26px;margin:0 0 4px}.meta{color:var(--text-soft);font-size:13px;margin-bottom:24px}' +
      'h3{font-size:18px;margin:0 0 10px}h4{margin:18px 0 8px;font-size:14px;color:var(--accent)}' +
      '.card{background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:22px 24px;margin-bottom:18px;box-shadow:0 1px 2px rgba(40,35,25,.06)}' +
      '.hl{color:var(--accent);font-weight:600}.match-item{border-left:4px solid var(--m-color,#8a5a2b);background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:12px}' +
      '.match-item h3{display:flex;gap:10px;align-items:baseline;margin:0 0 4px}.pct{color:var(--m-color);font-size:20px;font-weight:700}.en{color:var(--text-soft);font-size:13px;font-style:italic}' +
      '.match-bar{height:6px;background:var(--bg-soft);border-radius:999px;overflow:hidden;margin:10px 0}.match-bar>div{height:100%;background:var(--m-color)}' +
      '.ai-row{padding:9px 0;border-bottom:1px solid var(--border);font-size:14px}.ai-row:last-child{border:0}.ai-name{font-weight:600}.ai-desc{color:var(--text-soft)}' +
      'table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid var(--border);padding:8px 10px;text-align:center}th{background:var(--bg-soft)}td.name{text-align:left;font-weight:600}' +
      '.ana-group{margin-top:16px}.ana-item{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;background:var(--bg)}.ana-q{font-weight:600;margin-bottom:6px}.ana-pick{color:var(--accent);font-weight:600;font-size:12px;margin-right:6px}.ana-txt{color:var(--text-soft);font-size:13.5px}' +
      'svg{width:100%;height:auto}.axis-row{display:grid;grid-template-columns:88px 1fr 44px;gap:10px;align-items:center;font-size:13px;margin-bottom:8px}.axis-track{position:relative;height:6px;background:linear-gradient(90deg,#9ab4e0,#e8e4db 50%,#e0b487);border-radius:999px}.axis-dot{position:absolute;top:50%;width:11px;height:11px;border-radius:50%;background:var(--primary);transform:translate(-50%,-50%)}' +
      '.gov-overall{font-size:16px;margin:6px 0 14px}.gov-pct{font-size:26px;font-weight:700;color:var(--accent)}.gov-grade{color:var(--text-soft);font-size:14px}.gov-note{color:var(--text-soft);font-size:13px;margin:0 0 10px}' +
      'details.ana-details{border:1px solid var(--border);border-radius:10px;margin-top:14px;overflow:hidden}details.ana-details>summary{cursor:pointer;padding:14px 18px;font-weight:600;font-size:16px;display:flex;align-items:center;gap:8px;list-style:none;background:var(--bg-soft)}details.ana-details>summary::-webkit-details-marker{display:none}details.ana-details>summary::before{content:"▸";color:var(--accent);transition:transform .2s}details.ana-details[open]>summary::before{transform:rotate(90deg)}details.ana-details .ana-hint{color:var(--text-soft);font-size:12px;font-weight:400;margin-left:auto}details.ana-details .ana-body{padding:4px 18px 18px}' +
      '.mig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}.mig-card{border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--bg)}.mig-top{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.mig-rank{font-size:12px;font-weight:700;color:#fff;background:var(--mc,#8a5a2b);border-radius:6px;padding:2px 8px}.mig-name{font-weight:600;font-size:16px}.mig-name em{color:var(--text-soft);font-size:12px;font-style:italic;margin-left:4px}.mig-ideo{display:inline-block;font-size:11px;color:var(--mc,#8a5a2b);border:1px solid var(--mc,#8a5a2b);border-radius:999px;padding:1px 9px;margin-top:4px}.mig-pct{margin-left:auto;font-weight:700;color:var(--mc,#8a5a2b);font-size:18px}.mig-bar{height:6px;background:var(--bg-soft);border-radius:999px;overflow:hidden;margin:8px 0}.mig-bar>div{height:100%;background:var(--mc,#8a5a2b)}.mig-tag{font-size:13px;margin:6px 0}.mig-dim{font-size:12.5px;color:var(--text-soft);margin:4px 0}.mig-warn{font-size:12.5px;margin:4px 0}.mig-more-title{font-size:14px;color:var(--accent);margin:14px 0 6px}.mig-list{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px}.mig-line{display:grid;grid-template-columns:120px 1fr 44px;gap:10px;align-items:center;font-size:13px}.mig-line-name{font-weight:600}.mig-line-name em{color:var(--text-soft);font-size:11px;font-style:italic}.mig-line-bar{height:5px;background:var(--bg-soft);border-radius:999px;overflow:hidden}.mig-line-bar i{display:block;height:100%;background:var(--accent)}.mig-line-pct{text-align:right;color:var(--text-soft)}.mig-disclaimer{color:var(--text-soft);font-size:12px;margin:12px 0 0;border-top:1px dashed var(--border);padding-top:10px}' +
      '@media print{body{padding:0}}';
    var doc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>意识形态分析报告</title><style>' + css + '</style></head><body><div class="wrap"><h1>意识形态分析报告</h1><div class="meta">生成时间：' + ts + ' ｜ 模式：' + MODE + ' 题 ｜ 共 ' + QUESTIONS.length + ' 题</div>' + body + '</div></body></html>';
    var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = '意识形态分析报告_' + Date.now() + '.html';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- 分享单图（canvas，最大化信息量） ----------
  function shareImage() {
    var canvas = document.createElement('canvas');
    var W = 1080, H = 1350;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    // 背景
    var theme = document.documentElement.getAttribute('data-theme') || 'light';
    var bg = theme === 'dark' ? '#1d1c18' : '#faf9f6';
    var panel = theme === 'dark' ? '#26241f' : '#ffffff';
    var text = theme === 'dark' ? '#f0ede4' : '#23211c';
    var soft = theme === 'dark' ? '#a8a294' : '#6f6a5f';
    var border = theme === 'dark' ? '#3a372f' : '#e4e0d7';
    var accent = '#8a5a2b';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.font = 'bold 34px "Noto Serif SC", Georgia, serif';
    ctx.fillStyle = text; ctx.fillText('意识形态光谱 · 测试报告', 48, 72);
    ctx.font = '20px "Noto Serif SC", Georgia, serif';
    ctx.fillStyle = soft;
    ctx.fillText(new Date().toLocaleString('zh-CN') + ' ｜ 模式：' + MODE + ' 题', 48, 108);

    var matches = window.__lastMatches || [];
    var userAxes = window.__lastAxes || {};
    var top = matches[0], worst = matches[matches.length - 1];

    // 顶部大卡：最贴近意识形态
    var y = 148;
    ctx.fillStyle = panel;
    ctx.strokeStyle = border;
    roundRect(ctx, 48, y, W - 96, 150, 16); ctx.fill(); ctx.stroke();
    ctx.font = 'bold 40px "Noto Serif SC", Georgia, serif';
    ctx.fillStyle = text;
    ctx.fillText(top ? top.ideo.name : '—', 76, y + 62);
    ctx.font = '20px "Noto Serif SC", Georgia, serif';
    ctx.fillStyle = soft;
    ctx.fillText(top ? top.ideo.nameEn : '', 76, y + 94);
    if (top) {
      ctx.font = 'bold 52px Georgia, serif';
      ctx.fillStyle = top.ideo.color;
      ctx.fillText(top.similarity.toFixed(0) + '%', W - 180, y + 72);
      ctx.font = '18px "Noto Serif SC", Georgia, serif';
      ctx.fillStyle = soft;
      ctx.fillText('整体匹配度', W - 216, y + 106);
      // 匹配条
      ctx.fillStyle = border;
      roundRect(ctx, 76, y + 118, W - 190, 8, 4); ctx.fill();
      ctx.fillStyle = top.ideo.color;
      roundRect(ctx, 76, y + 118, (W - 190) * top.similarity / 100, 8, 4); ctx.fill();
    }
    y += 186;

    // 第二行：最矛盾流派 + 政府适配度
    var colW = (W - 96 - 24) / 2;
    ctx.fillStyle = panel; ctx.strokeStyle = border;
    roundRect(ctx, 48, y, colW, 130, 16); ctx.fill(); ctx.stroke();
    ctx.font = '18px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = soft;
    ctx.fillText('与你最矛盾的意识形态', 72, y + 40);
    ctx.font = 'bold 28px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = text;
    ctx.fillText(worst ? worst.ideo.name : '—', 72, y + 82);
    ctx.font = '18px Georgia, serif'; ctx.fillStyle = soft;
    ctx.fillText(worst ? '匹配度 ' + worst.similarity.toFixed(0) + '%' : '', 72, y + 114);

    var gov = window.__lastGov || null;
    ctx.fillStyle = panel; ctx.strokeStyle = border;
    roundRect(ctx, 48 + colW + 24, y, colW, 130, 16); ctx.fill(); ctx.stroke();
    ctx.font = '18px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = soft;
    ctx.fillText('与中国政府（当代）适配度', 72 + colW + 24, y + 40);
    ctx.font = 'bold 40px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = accent;
    ctx.fillText(gov ? gov.overall + '%' : '—', 72 + colW + 24, y + 86);
    ctx.font = '18px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = soft;
    ctx.fillText(gov ? gov.grade : '', 72 + colW + 24, y + 114);
    y += 166;

    // 10 维条形图
    ctx.font = 'bold 26px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = text;
    ctx.fillText('十维立场画像', 48, y + 10);
    y += 40;
    var barH = 34, gap = 56;
    AXES.forEach(function (a) {
      var v = userAxes[a.key] || 0;
      var pos = (v + 100) / 2;
      ctx.font = '17px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = soft;
      ctx.fillText(a.name, 48, y + 16);
      // 轨道
      ctx.fillStyle = border;
      roundRect(ctx, 210, y - 6, 700, 26, 13); ctx.fill();
      // 中心 0
      ctx.fillStyle = theme === 'dark' ? '#55504a' : '#c9c4b8';
      ctx.fillRect(210 + 350 - 1, y - 6, 2, 26);
      // 数值条（从中心展开）
      var fillW = Math.abs(v) / 200 * 700;
      ctx.fillStyle = v >= 0 ? '#b3692f' : '#4a6fa5';
      if (v !== 0) {
        var x0 = v >= 0 ? 210 + 350 : 210 + 350 - fillW;
        roundRect(ctx, x0, y - 6, Math.max(fillW, 3), 26, 13); ctx.fill();
      }
      // 数值
      ctx.font = 'bold 17px Georgia, serif'; ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.fillText(v, 210 + 350, y + 18);
      ctx.textAlign = 'left';
      y += gap;
    });
    y += 16;

    // 底部信息
    ctx.font = '18px "Noto Serif SC", Georgia, serif'; ctx.fillStyle = soft;
    ctx.fillText('本站内容仅作教育与研究用途 · 意识形态光谱', 48, Math.min(y, H - 40));
    ctx.font = '16px Georgia, serif';
    ctx.fillText('https://iweistoicqc5.top/ideology/', 48, Math.min(y + 30, H - 10));

    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '意识形态分析_分享图_' + Date.now() + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  document.getElementById('submitBtn').addEventListener('click', function () {
    var answered = Object.keys(answers).length;
    if (answered < QUESTIONS.length) {
      if (!confirm('还有 ' + (QUESTIONS.length - answered) + ' 题未作答，确定要生成结果吗？')) return;
    }
    renderResults();
  });
  document.getElementById('backHomeBtn').addEventListener('click', function () { showView('home'); });
  document.getElementById('exportBtn').addEventListener('click', function () { exportReport(); });
  var shareBtn = document.getElementById('shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', function () { shareImage(); });

  // ---------- 雷达图（SVG，带刻度与图例） ----------
  function drawRadar(containerId, userAxes, topIdeos) {
    var el = document.getElementById(containerId);
    var size = 400, cx = size / 2, cy = size / 2, R = size / 2 - 60;
    var n = AXES.length;
    var angle = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / n; };
    var point = function (i, r) {
      return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    };
    var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="维度雷达图">';

    // 同心刻度网格（-100 / -50 / 0 / +50 / +100）
    var rings = [1, 0.75, 0.5, 0.25];
    rings.forEach(function (f) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = point(i, R * f); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      svg += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--border)" stroke-width="1" stroke-dasharray="' + (f === 0.5 ? '' : '3 3') + '"/>';
    });
    // 中心 0 刻度线加粗
    var zeroPts = [];
    for (var zi = 0; zi < n; zi++) { var zp = point(zi, R * 0.5); zeroPts.push(zp[0].toFixed(1) + ',' + zp[1].toFixed(1)); }
    svg += '<polygon points="' + zeroPts.join(' ') + '" fill="none" stroke="var(--text-soft)" stroke-width="1" stroke-opacity="0.5"/>';

    // 轴线 + 标签
    for (var i = 0; i < n; i++) {
      var edge = point(i, R);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + edge[0].toFixed(1) + '" y2="' + edge[1].toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>';
      var lp = point(i, R + 20);
      var anchor = Math.abs(lp[0] - cx) < 6 ? 'middle' : (lp[0] < cx ? 'end' : 'start');
      svg += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '" font-size="11" fill="var(--text-soft)" text-anchor="' + anchor + '">' + AXES[i].name + '</text>';
    }
    // 右上角刻度说明
    svg += '<text x="' + (cx + R * 0.72) + '" y="' + (cy - R * 0.62) + '" font-size="10" fill="var(--text-soft)" text-anchor="middle">-100 ← 中立 → +100</text>';

    // 意识形态多边形（半透明，含图例）
    topIdeos.forEach(function (m, idx) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var v = m.ideo.axes[AXES[i].key];
        var r = R * (v + 100) / 200;
        var p = point(i, r);
        pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
      }
      var op = 0.15 - idx * 0.03;
      svg += '<polygon points="' + pts.join(' ') + '" fill="' + m.ideo.color + '" fill-opacity="' + op.toFixed(2) + '" stroke="' + m.ideo.color + '" stroke-width="1.2" stroke-dasharray="' + (idx > 0 ? '4 3' : '') + '"/>';
    });
    // 用户多边形
    var up = [];
    for (var i = 0; i < n; i++) {
      var v = userAxes[AXES[i].key];
      var r = R * (v + 100) / 200;
      var p = point(i, r);
      up.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    svg += '<polygon points="' + up.join(' ') + '" fill="var(--primary)" fill-opacity="0.35" stroke="var(--primary)" stroke-width="2.2"/>';
    // 用户顶点圆点
    for (var i = 0; i < n; i++) {
      var v = userAxes[AXES[i].key];
      var r = R * (v + 100) / 200;
      var p = point(i, r);
      svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="var(--primary)"/>';
    }

    // 图例
    var legend = '<div class="radar-legend">' +
      '<span class="lg lg-me">● 你</span>' +
      topIdeos.map(function (m, idx) {
        return '<span class="lg" style="color:' + m.ideo.color + '">' + (idx > 0 ? '◇ ' : '◆ ') + m.ideo.name + '</span>';
      }).join('') +
      '</div>';
    svg += '</svg>' + legend;
    el.innerHTML = svg;
  }

  // ---------- 对比说明 ----------
  function initCompare() {
    var selA = document.getElementById('compareA');
    var selB = document.getElementById('compareB');
    IDEOLOGIES.forEach(function (ideo, i) {
      var o1 = new Option(ideo.name, ideo.id);
      var o2 = new Option(ideo.name, ideo.id);
      selA.add(o1); selB.add(o2);
    });
    if (IDEOLOGIES.length > 1) selB.selectedIndex = 1;
    selA.addEventListener('change', renderCompare);
    selB.addEventListener('change', renderCompare);
    renderCompare();
  }

  function renderCompare() {
    var a = IDEOLOGIES.find(function (x) { return x.id === document.getElementById('compareA').value; });
    var b = IDEOLOGIES.find(function (x) { return x.id === document.getElementById('compareB').value; });
    if (!a || !b) return;
    var result = document.getElementById('compareResult');
    var head = '<div class="compare-head">' +
      '<div class="compare-col" style="border-top:4px solid ' + a.color + '"><h3>' + a.name + '</h3><div class="en">' + a.nameEn + '</div><p style="font-size:14px;color:var(--text-soft);margin:8px 0 0">' + a.tagline + '</p></div>' +
      '<div class="compare-col" style="border-top:4px solid ' + b.color + '"><h3>' + b.name + '</h3><div class="en">' + b.nameEn + '</div><p style="font-size:14px;color:var(--text-soft);margin:8px 0 0">' + b.tagline + '</p></div>' +
      '</div>';
    var axesHtml = '<div class="compare-axes"><h3 style="margin:0 0 14px">维度对比（圆点为各自立场，-100 ~ +100）</h3>';
    AXES.forEach(function (ax) {
      var va = a.axes[ax.key], vb = b.axes[ax.key];
      var pa = (va + 100) / 2, pb = (vb + 100) / 2;
      var diff = Math.abs(va - vb);
      var divTxt = diff >= 80 ? '分歧很大' : diff >= 40 ? '存在明显分歧' : diff >= 15 ? '有一定差异' : '立场接近';
      axesHtml += '<div class="compare-row">' +
        '<div class="compare-a" style="color:' + a.color + '">' + va + '</div>' +
        '<div class="dim">' + ax.name + '<div style="font-size:11px;color:var(--text-soft)">' + divTxt + '</div></div>' +
        '<div class="compare-b" style="color:' + b.color + '">' + vb + '</div>' +
        '</div>' +
        '<div class="compare-row" style="margin-bottom:16px">' +
        '<div class="compare-track"><div class="compare-dot-a" style="left:' + pa + '%;background:' + a.color + '"></div></div>' +
        '<div></div>' +
        '<div class="compare-track"><div class="compare-dot-b" style="left:' + pb + '%;background:' + b.color + '"></div></div>' +
        '</div>';
    });
    axesHtml += '</div>';
    result.innerHTML = head + axesHtml;
  }

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 初始化 ----------
  renderCatalog();
  if (QUESTIONS.length) renderQuestion();
  else {
    document.getElementById('questionCard').innerHTML =
      '<p style="color:var(--text-soft)">题目数据尚未加载，请稍候或检查 js/questions.js。</p>';
  }
  initCompare();
})();
