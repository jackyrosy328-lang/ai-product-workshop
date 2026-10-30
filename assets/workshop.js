(function () {
  'use strict';

  // ============================================================
  // 步骤定义
  // ============================================================
  const STEPS = [
    { id: 'market',   name: '机会发现',      agent: '市场洞察 Agent',   color: '#1f6f78', icon: 'M' },
    { id: 'user',     name: '用户假设',      agent: '用户假设 Agent',   color: '#b66a2c', icon: 'U' },
    { id: 'engineering', name: '工程约束',   agent: '工程约束 Agent',   color: '#c0392b', icon: 'E' },
    { id: 'business', name: '商业评估',      agent: '商业评估 Agent',   color: '#d4a017', icon: 'B' },
    { id: 'review',   name: '对抗评审',      agent: '评审裁判 Agent',   color: '#7b3fa0', icon: 'R' },
    { id: 'final',    name: '产品定义',      agent: '汇总输出',         color: '#27ae60', icon: 'F' },
  ];

  const REVIEWS = [
    { id: 'review1', name: '机会评审', desc: '产品经理 / 品类负责人' },
    { id: 'review2', name: '工程评审', desc: '研发 / 供应链 / 认证' },
    { id: 'review3', name: '立项评审', desc: '产品委员会 / 销售 / 品牌' },
  ];

  // ============================================================
  // 状态
  // ============================================================
  const state = {
    proposition: '',
    currentStep: -1,
    stepData: {},      // { stepId: { content, output } }
    reviewStatus: {},  // { reviewId: 'pending' | 'pass' | 'reject' }
    running: false,
  };

  // ============================================================
  // 渲染步骤导航
  // ============================================================
  function renderSteps() {
    const container = document.getElementById('stepList');
    container.innerHTML = STEPS.map((s, i) => {
      const isActive = i === state.currentStep;
      const isDone = i < state.currentStep;
      const cls = isActive ? 'active' : isDone ? 'done' : '';
      return `
        <div class="step-item ${cls}" data-index="${i}">
          <div class="step-num">${isDone ? '&#10003;' : i + 1}</div>
          <div>
            <div class="step-name">${s.name}</div>
            <div class="step-agent">${s.agent}</div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.step-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        if (idx <= state.currentStep && state.stepData[STEPS[idx].id]) {
          showStepContent(idx);
        }
      });
    });
  }

  function renderReviews() {
    const container = document.getElementById('reviewList');
    container.innerHTML = REVIEWS.map((r) => {
      const status = state.reviewStatus[r.id] || 'pending';
      const statusIcon = status === 'pass' ? '&#10003;' : status === 'reject' ? '&#10007;' : '&#9679;';
      const statusColor = status === 'pass' ? 'color:#27ae60' : status === 'reject' ? 'color:#c0392b' : 'color:#64748b';
      return `
        <div class="step-item" style="font-size:0.78rem;">
          <div style="${statusColor};margin-top:0.1rem;">${statusIcon}</div>
          <div>
            <div class="step-name">${r.name}</div>
            <div class="step-agent">${r.desc}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // 渲染右栏输出面板
  // ============================================================
  function renderOutputPanel() {
    const panel = document.getElementById('outputPanel');
    const outputs = [
      { id: 'market',    title: '市场机会地图',     badge: 'STEP 1' },
      { id: 'user',      title: '需求主题库',       badge: 'STEP 2' },
      { id: 'engineering', title: '工程约束清单',   badge: 'STEP 3' },
      { id: 'business',  title: '商业评估摘要',     badge: 'STEP 4' },
      { id: 'review',    title: '冲突点与修正',     badge: 'STEP 5' },
      { id: 'final',     title: '产品定义包',       badge: 'FINAL' },
    ];

    panel.innerHTML = outputs.map((o) => {
      const data = state.stepData[o.id];
      const visible = !!data;
      const content = data && data.output ? renderOutputContent(o.id, data.output) : '';
      return `
        <div class="output-section ${visible ? 'visible' : ''}" id="output-${o.id}">
          <div class="output-badge">${o.badge}</div>
          <h4>${o.title}</h4>
          ${content}
        </div>
      `;
    }).join('');
  }

  function renderOutputContent(stepId, output) {
    if (typeof output === 'string') {
      return `<p>${output.substring(0, 120)}${output.length > 120 ? '...' : ''}</p>`;
    }
    if (Array.isArray(output)) {
      return `<ul>${output.slice(0, 4).map((item) => `<li>${item}</li>`).join('')}${output.length > 4 ? '<li>...</li>' : ''}</ul>`;
    }
    if (typeof output === 'object') {
      const keys = Object.keys(output).slice(0, 3);
      return keys.map((k) => `<p><strong>${k}:</strong> ${String(output[k]).substring(0, 60)}</p>`).join('');
    }
    return '';
  }

  // ============================================================
  // 打字机效果
  // ============================================================
  async function typeText(element, text, speed = 15) {
    element.innerHTML = '<span class="typing-text"></span><span class="typing-cursor"></span>';
    const span = element.querySelector('.typing-text');
    const cursor = element.querySelector('.typing-cursor');

    for (let i = 0; i < text.length; i++) {
      span.textContent += text[i];
      if (i % 3 === 0) {
        await sleep(speed);
      }
    }

    cursor.remove();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // 调用 Agent API
  // ============================================================
  async function callAgent(role, proposition, previousData) {
    const payload = {
      role,
      proposition,
      previousData,
    };

    const response = await fetch('/api/agent/' + role, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Agent API error: ' + response.status);
    }

    return await response.json();
  }

  // ============================================================
  // 显示步骤内容
  // ============================================================
  function showStepContent(stepIndex) {
    const step = STEPS[stepIndex];
    const data = state.stepData[step.id];
    if (!data) return;

    const area = document.getElementById('contentArea');

    if (step.id === 'final') {
      area.innerHTML = `
        <div class="final-output">
          <h3>产品定义包 — ${state.proposition}</h3>
          <div class="typing-text">${data.content}</div>
        </div>
        <div class="sample-banner">
          <div class="sample-banner-title">工作坊已产出样品 demo</div>
          <div class="sample-banner-desc">
            上方产品定义包中描述的核心功能<strong>「用电沙盘」</strong>已做成可交互 demo。
            点击进入，亲手体验这个产品被定义出来后长什么样。
          </div>
          <a class="sample-banner-btn" href="/sandbox">
            查看样品 demo — 用电沙盘
            <span class="arrow">→</span>
          </a>
        </div>
        <div class="action-bar">
          <button class="btn-secondary" id="backBtn">查看上一步</button>
          <button class="btn-primary" id="exportBtn">导出定义包</button>
        </div>
      `;
      document.getElementById('backBtn')?.addEventListener('click', () => {
        showStepContent(stepIndex - 1);
      });
      return;
    }

    const evidenceTags = data.evidence ? `
      <div class="evidence-bar">
        ${data.evidence.map((e) => `<span class="ev-tag ev-${e.level.toLowerCase()}">${e.level}: ${e.source}</span>`).join('')}
      </div>
    ` : '';

    area.innerHTML = `
      <div class="content-card">
        <h3>
          <span class="agent-icon" style="background:${step.color}15;color:${step.color}">${step.icon}</span>
          ${step.agent} — ${step.name}
        </h3>
        <div id="typingArea"></div>
        ${evidenceTags}
        <div class="action-bar" id="actionBar"></div>
      </div>
    `;

    const typingArea = document.getElementById('typingArea');
    typeText(typingArea, data.content);

    // 设置底部按钮
    const actionBar = document.getElementById('actionBar');
    if (stepIndex === STEPS.length - 2) {
      // 倒数第二步（对抗评审）→ 下一步是最终输出
      actionBar.innerHTML = `
        <button class="btn-secondary" id="prevBtn">上一步</button>
        <button class="btn-primary" id="nextBtn">生成产品定义包</button>
      `;
      document.getElementById('nextBtn')?.addEventListener('click', () => {
        runStep(stepIndex + 1);
      });
    } else if (stepIndex < STEPS.length - 1) {
      const nextStep = STEPS[stepIndex + 1];
      const reviewIdx = Math.floor(stepIndex / 2);
      const needsReview = stepIndex % 2 === 0 && reviewIdx < REVIEWS.length;

      if (needsReview && state.reviewStatus[REVIEWS[reviewIdx].id] !== 'pass') {
        actionBar.innerHTML = `
          <button class="btn-secondary" id="prevBtn">上一步</button>
          <button class="btn-primary" id="reviewBtn">进入${REVIEWS[reviewIdx].name}</button>
        `;
        document.getElementById('reviewBtn')?.addEventListener('click', () => {
          showReviewNode(reviewIdx);
        });
      } else {
        actionBar.innerHTML = `
          <button class="btn-secondary" id="prevBtn">上一步</button>
          <button class="btn-primary" id="nextBtn">下一步：${nextStep.name}</button>
        `;
        document.getElementById('nextBtn')?.addEventListener('click', () => {
          runStep(stepIndex + 1);
        });
      }
    }

    document.getElementById('prevBtn')?.addEventListener('click', () => {
      if (stepIndex > 0) showStepContent(stepIndex - 1);
    });
  }

  // ============================================================
  // 专家评审节点
  // ============================================================
  function showReviewNode(reviewIndex) {
    const review = REVIEWS[reviewIndex];
    const area = document.getElementById('contentArea');
    const stepData = state.stepData;

    // 收集当前已有数据作为评审材料
    const materials = [];
    if (stepData.market) materials.push('市场洞察：识别了 ' + (stepData.market.output?.opportunities?.length || 0) + ' 个机会点');
    if (stepData.user) materials.push('用户假设：生成了 ' + (stepData.user.output?.personas?.length || 0) + ' 个用户画像');
    if (stepData.engineering) materials.push('工程约束：列出了 ' + (stepData.engineering.output?.constraints?.length || 0) + ' 项技术约束');
    if (stepData.business) materials.push('商业评估：评估了价格带和毛利空间');

    area.innerHTML = `
      <div class="review-node">
        <h4>${review.name}</h4>
        <p style="font-size:0.85rem;color:var(--muted);margin:0.5rem 0;">
          <strong>评审人：</strong>${review.desc}<br>
          请基于以下材料判断是否通过该阶段：
        </p>
        <ul style="font-size:0.82rem;color:var(--ink);margin:0.5rem 0;padding-left:1.2rem;">
          ${materials.map((m) => `<li>${m}</li>`).join('')}
        </ul>
        <div class="review-options">
          <button class="btn-pass" data-action="pass">&#10003; 通过</button>
          <button class="btn-reject" data-action="reject">&#10007; 驳回</button>
        </div>
      </div>
    `;

    area.querySelectorAll('.review-options button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        state.reviewStatus[review.id] = action;
        renderReviews();

        if (action === 'pass') {
          // 通过：跑下一步。reviewIndex 0/1/2 分别对应 step 1/3/5
          const stepIdx = reviewIndex * 2 + 1;
          if (stepIdx < STEPS.length) {
            runStep(stepIdx);
          }
        } else {
          // 驳回：回到触发本次评审的那个步骤（评审发生在 step 0/2/4 完成后）
          const prevStepIdx = reviewIndex * 2;
          // 重置该评审状态为 pending，便于重新提交
          state.reviewStatus[review.id] = 'pending';
          renderReviews();

          area.innerHTML = `
            <div class="review-node">
              <h4>${review.name} — 已驳回</h4>
              <p style="font-size:0.85rem;color:var(--muted);">
                评审意见已记录。点击下方按钮返回「${STEPS[prevStepIdx].name}」补充材料或修正假设，完成后可重新提交评审。
              </p>
              <div class="review-options">
                <button class="btn-secondary" id="backToStep">返回修改 — ${STEPS[prevStepIdx].name}</button>
              </div>
            </div>
          `;
          document.getElementById('backToStep')?.addEventListener('click', () => {
            showStepContent(prevStepIdx);
          });
        }
      });
    });
  }

  // ============================================================
  // 运行单个步骤
  // ============================================================
  async function runStep(stepIndex) {
    if (state.running) return;
    state.running = true;
    state.currentStep = stepIndex;
    renderSteps();

    const step = STEPS[stepIndex];
    const area = document.getElementById('contentArea');

    // 显示加载动画
    area.innerHTML = `
      <div class="content-card">
        <h3>
          <span class="agent-icon" style="background:${step.color}15;color:${step.color}">${step.icon}</span>
          ${step.agent} — ${step.name}
        </h3>
        <div class="loading-dots">
          <span></span><span></span><span></span>
        </div>
        <p style="text-align:center;color:var(--muted);font-size:0.85rem;">
          ${step.agent} 正在分析命题，请稍候...
        </p>
      </div>
    `;

    try {
      // 收集前面步骤的数据
      const previousData = {};
      for (let i = 0; i < stepIndex; i++) {
        const prevStep = STEPS[i];
        if (state.stepData[prevStep.id]) {
          previousData[prevStep.id] = state.stepData[prevStep.id].output;
        }
      }

      const result = await callAgent(step.id, state.proposition, previousData);

      state.stepData[step.id] = {
        content: result.content,
        output: result.output || {},
        evidence: result.evidence || [],
      };

      renderOutputPanel();
      showStepContent(stepIndex);

    } catch (err) {
      area.innerHTML = `
        <div class="content-card">
          <h3 style="color:var(--danger)">出错了</h3>
          <p style="color:var(--muted)">${err.message}</p>
          <div class="action-bar">
            <button class="btn-secondary" id="retryBtn">重试</button>
          </div>
        </div>
      `;
      document.getElementById('retryBtn')?.addEventListener('click', () => {
        runStep(stepIndex);
      });
    } finally {
      state.running = false;
    }
  }

  // ============================================================
  // 启动工作坊
  // ============================================================
  async function startWorkshop() {
    const input = document.getElementById('propositionInput');
    const proposition = input.value.trim();
    if (!proposition) {
      alert('请输入产品命题');
      return;
    }

    state.proposition = proposition;
    state.currentStep = -1;
    state.stepData = {};
    state.reviewStatus = {};
    document.getElementById('resetBtn').disabled = false;

    renderSteps();
    renderReviews();
    renderOutputPanel();

    // 从第一步开始
    runStep(0);
  }

  function resetWorkshop() {
    state.proposition = '';
    state.currentStep = -1;
    state.stepData = {};
    state.reviewStatus = {};
    state.running = false;

    document.getElementById('propositionInput').value = '为欧洲家庭露营用户设计下一代 Solix 智能户外电源';
    document.getElementById('resetBtn').disabled = true;
    document.getElementById('contentArea').innerHTML = `
      <div class="content-placeholder">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">&#128736;</div>
        输入产品命题后点击"开始工作坊"，<br>
        体验五类 Agent 协作完成产品定义的过程
      </div>
    `;

    renderSteps();
    renderReviews();
    renderOutputPanel();
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    renderSteps();
    renderReviews();
    renderOutputPanel();

    document.getElementById('startBtn').addEventListener('click', startWorkshop);
    document.getElementById('resetBtn').addEventListener('click', resetWorkshop);

    // 回车触发
    document.getElementById('propositionInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startWorkshop();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
