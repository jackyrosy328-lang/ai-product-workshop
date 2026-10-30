(function () {
  'use strict';

  // ============================================================
  // 设备数据库 — 真实功率参数
  // ============================================================
  const DEVICES = [
    { id: 'fridge',     name: '车载冰箱',     watt: 45,  defaultHours: 24, category: 'essential' },
    { id: 'phone',      name: '手机充电',     watt: 10,  defaultHours: 3,  category: 'essential', perPerson: true },
    { id: 'light',      name: 'LED 露营灯',   watt: 5,   defaultHours: 6,  category: 'essential' },
    { id: 'laptop',     name: '笔记本电脑',   watt: 65,  defaultHours: 4,  category: 'work' },
    { id: 'projector',  name: '便携投影仪',   watt: 100, defaultHours: 2,  category: 'entertainment' },
    { id: 'fan',        name: 'USB 风扇',     watt: 8,   defaultHours: 8,  category: 'comfort' },
    { id: 'speaker',    name: '蓝牙音箱',     watt: 15,  defaultHours: 3,  category: 'entertainment' },
    { id: 'camera',     name: '相机电池充电', watt: 12,  defaultHours: 2,  category: 'work' },
    { id: 'kettle',     name: '电热水壶',     watt: 800, defaultHours: 0.5, category: 'kitchen' },
    { id: 'router',     name: '4G 路由器',    watt: 10,  defaultHours: 10, category: 'essential' },
  ];

  // 电池参数
  const BATTERY_CAPACITY = 1500; // Wh
  const BATTERY_INITIAL_SOC = 100; // %
  const SAFE_THRESHOLD = 20; // 低于 20% 进入安全预警
  const CRITICAL_THRESHOLD = 10; // 低于 10% 进入紧急状态
  const ROUND_TRIP_EFFICIENCY = 0.85; // 电池充放电效率

  // 天气对太阳能板的影响系数
  const WEATHER_SOLAR_FACTOR = {
    sunny: 1.0,
    cloudy: 0.5,
    rainy: 0.2,
  };

  // ============================================================
  // 状态管理
  // ============================================================
  const state = {
    devices: {},       // { deviceId: { active, hours } }
    people: 2,
    days: 2,
    weather: 'sunny',
    solar: 100,        // W
    simulationData: null,
    deepseekReady: false,  // 后端是否配置了 DeepSeek API
  };

  // 初始化设备状态
  DEVICES.forEach((d) => {
    state.devices[d.id] = {
      active: ['fridge', 'phone', 'light'].includes(d.id),
      hours: d.defaultHours,
    };
  });

  // ============================================================
  // 预设场景
  // ============================================================
  const PRESETS = {
    family: {
      people: 2, days: 2, weather: 'sunny', solar: 100,
      devices: { fridge: 24, phone: 3, light: 6, laptop: 2, speaker: 2, fan: 4 },
    },
    family4: {
      people: 4, days: 2, weather: 'sunny', solar: 200,
      devices: { fridge: 24, phone: 3, light: 8, laptop: 3, projector: 2, speaker: 3, fan: 6, kettle: 0.5 },
    },
    creator: {
      people: 1, days: 3, weather: 'cloudy', solar: 200,
      devices: { fridge: 24, phone: 3, light: 4, laptop: 8, camera: 3, router: 12, speaker: 2 },
    },
    emergency: {
      people: 3, days: 1, weather: 'rainy', solar: 0,
      devices: { fridge: 24, phone: 3, light: 5, router: 10, laptop: 2 },
    },
  };

  // ============================================================
  // 电量计算引擎 — 核心逻辑
  // ============================================================

  /**
   * 计算每小时设备总功耗 (Wh)
   * 人数相关设备按人数倍增
   */
  function calcHourlyLoad(hour) {
    let totalW = 0;
    const activeDevices = [];

    DEVICES.forEach((d) => {
      const ds = state.devices[d.id];
      if (!ds.active) return;

      let actualHours = ds.hours;
      let multiplier = 1;

      // 人数相关设备
      if (d.perPerson) {
        multiplier = state.people;
      }

      // 判断该小时是否在使用
      // 电冰箱 24 小时运行但压缩机不是持续满载，按 40% 占空比计算
      let isRunning = false;
      if (d.id === 'fridge') {
        isRunning = true; // 电冰箱始终接入，但功率按占空比
      } else if (d.id === 'router') {
        isRunning = true; // 路由器持续运行
      } else if (d.id === 'kettle') {
        // 电热水壶只在特定时段短时使用（早 7:00-7:30, 晚 18:00-18:30）
        isRunning = (hour === 7 || hour === 18);
      } else {
        // 其他设备按每日使用时长，分布在合理时段
        isRunning = isDeviceRunningAtHour(d.id, hour, actualHours);
      }

      if (isRunning) {
        let power = d.watt;
        // 冰箱占空比
        if (d.id === 'fridge') power = d.watt * 0.4;
        totalW += power * multiplier;
        activeDevices.push({ name: d.name, power: power * multiplier, id: d.id });
      }
    });

    return { totalW, activeDevices };
  }

  /**
   * 判断设备在某个小时是否运行
   * 基于露营用户的典型使用时段
   */
  function isDeviceRunningAtHour(deviceId, hour, dailyHours) {
    const schedules = {
      phone: [7, 8, 9, 22, 23],          // 早晚充电
      light: [18, 19, 20, 21, 22, 23],   // 晚间照明
      laptop: [9, 10, 11, 14, 15, 16, 20, 21], // 工作时段
      projector: [20, 21, 22],           // 晚间观影
      fan: [12, 13, 14, 15, 16, 17, 22, 23, 0, 1, 2, 3], // 白天热时和夜间
      speaker: [12, 13, 18, 19, 20, 21], // 休闲时段
      camera: [10, 11, 15, 16],          // 白天拍摄
    };

    const schedule = schedules[deviceId];
    if (!schedule) return false;

    // 如果每日使用时长小于排程时长，只取前 N 个小时
    const limitedSchedule = schedule.slice(0, Math.ceil(dailyHours));
    return limitedSchedule.includes(hour);
  }

  /**
   * 计算太阳能板每小时发电量
   * 太阳能板在 6:00-18:00 发电，峰值在 10:00-14:00
   */
  function calcSolarHourly(hour) {
    if (state.solar === 0 || hour < 6 || hour > 18) return 0;

    const weatherFactor = WEATHER_SOLAR_FACTOR[state.weather] || 1;

    // 太阳辐照曲线：6:00 起步, 12:00 峰值, 18:00 落地
    let irradiance;
    if (hour >= 6 && hour <= 9) {
      irradiance = (hour - 5) / 5; // 0.2 -> 0.8
    } else if (hour >= 10 && hour <= 14) {
      irradiance = 0.9 + Math.sin((hour - 10) * Math.PI / 8) * 0.1; // 0.9-1.0
    } else {
      irradiance = (19 - hour) / 5; // 0.8 -> 0.2
    }

    return state.solar * irradiance * weatherFactor;
  }

  /**
   * 核心：模拟 72 小时电量变化
   * 返回每小时 SOC、负载、太阳能、事件
   */
  function simulate() {
    const totalHours = state.days * 24;
    const data = {
      hours: [],
      soc: [],         // 电量百分比
      socWh: [],       // 电量 Wh
      load: [],        // 负载 Wh
      solar: [],       // 太阳能 Wh
      events: [],      // 关键事件
      hourlyDevices: [], // 每小时运行设备
    };

    let currentSOC = BATTERY_INITIAL_SOC;
    let currentEnergy = BATTERY_CAPACITY * (currentSOC / 100);
    let minSOC = 100;
    let totalLoad = 0;
    let totalSolar = 0;

    for (let h = 0; h < totalHours; h++) {
      const day = Math.floor(h / 24) + 1;
      const hourOfDay = h % 24;

      // 计算负载
      const loadResult = calcHourlyLoad(hourOfDay);
      const loadWh = loadResult.totalW; // 每小时 Wh = W * 1h

      // 计算太阳能
      const solarWh = calcSolarHourly(hourOfDay);

      // 净能量变化（考虑充放电效率）
      let netEnergy = solarWh - loadWh;
      if (netEnergy > 0) {
        // 充电：考虑效率
        netEnergy = netEnergy * ROUND_TRIP_EFFICIENCY;
      }

      currentEnergy += netEnergy;

      // 限制电量范围
      if (currentEnergy < 0) currentEnergy = 0;
      if (currentEnergy > BATTERY_CAPACITY) currentEnergy = BATTERY_CAPACITY;

      currentSOC = (currentEnergy / BATTERY_CAPACITY) * 100;
      if (currentSOC < minSOC) minSOC = currentSOC;

      totalLoad += loadWh;
      totalSolar += solarWh;

      data.hours.push(`第${day}天 ${String(hourOfDay).padStart(2, '0')}:00`);
      data.soc.push(Math.round(currentSOC * 10) / 10);
      data.socWh.push(Math.round(currentEnergy));
      data.load.push(Math.round(loadWh));
      data.solar.push(Math.round(solarWh));
      data.hourlyDevices.push(loadResult.activeDevices);

      // 记录关键事件
      if (currentSOC <= CRITICAL_THRESHOLD && (h === 0 || data.soc[h - 1] > CRITICAL_THRESHOLD)) {
        data.events.push({
          hour: h,
          label: `第${day}天 ${String(hourOfDay).padStart(2, '0')}:00`,
          type: 'critical',
          message: `电量降至 ${currentSOC.toFixed(1)}%，进入紧急状态，建议立即减少非必要设备`,
        });
      } else if (currentSOC <= SAFE_THRESHOLD && (h === 0 || data.soc[h - 1] > SAFE_THRESHOLD)) {
        data.events.push({
          hour: h,
          label: `第${day}天 ${String(hourOfDay).padStart(2, '0')}:00`,
          type: 'warning',
          message: `电量降至 ${currentSOC.toFixed(1)}%，进入安全预警区间`,
        });
      }
    }

    data.minSOC = Math.round(minSOC * 10) / 10;
    data.totalLoad = Math.round(totalLoad);
    data.totalSolar = Math.round(totalSolar);
    data.avgDailyLoad = Math.round(totalLoad / state.days);
    data.avgDailySolar = Math.round(totalSolar / state.days);
    data.finalSOC = Math.round(currentSOC * 10) / 10;

    return data;
  }

  // ============================================================
  // 规则引擎方案生成器 — 100% 可靠的 fallback
  // ============================================================

  function ruleEnginePlans(data) {
    const minSOC = data.minSOC;
    const finalSOC = data.finalSOC;
    const dailyLoad = data.avgDailyLoad;
    const dailySolar = data.avgDailySolar;
    const solarCover = dailySolar > 0 ? Math.round((dailySolar / dailyLoad) * 100) : 0;

    const activeDeviceList = DEVICES.filter((d) => state.devices[d.id].active);
    const essentialDevices = activeDeviceList.filter((d) => d.category === 'essential');
    const comfortDevices = activeDeviceList.filter((d) => d.category === 'comfort' || d.category === 'entertainment');

    const essentialNames = essentialDevices.map((d) => d.name).join('、') || '手机、照明';
    const comfortNames = comfortDevices.map((d) => d.name).join('、') || '投影仪';

    // ---- 边界信息（多组合选项）----
    let safeText = '';
    let safeList = [];

    if (minSOC < 10) {
      safeText = `当前配置下最低电量将跌至 ${minSOC}%，已触及产品硬边界。以下列出几种可行组合，可基于你的场景自主选择。`;
      safeList.push(`组合 A：仅 ${essentialNames}，可续航完整行程并保留 20% 余量`);
      safeList.push(`组合 B：${essentialNames} + 投影 1 小时/天，预计结束时剩余 5-8%`);
      safeList.push(`组合 C：保持当前全设备，预计第 ${Math.ceil(state.days / 2)} 天触发低电保护`);
      safeList.push(`10:00-14:00 是太阳能充电黄金时段，此时用电不消耗电池库存`);
    } else if (minSOC < 20) {
      safeText = `当前配置下最低电量 ${minSOC}%，接近 20% 安全余量线。以下组合均在产品边界内，差别在于余量厚度。`;
      safeList.push(`当前组合：可续航完整行程，结束时剩余约 ${finalSOC}%`);
      safeList.push(`若想保留 30% 余量：可减少 ${comfortNames} 各 1 次`);
      safeList.push(`白天太阳能直供时段（10-14 点）用电不影响整体续航`);
      safeList.push(`阴雨天气下，最低电量将再降 5-8%，可预留缓冲`);
    } else {
      safeText = `当前配置下最低电量 ${minSOC}%，所有设备均在产品安全边界内运行。`;
      safeList.push(`全设备组合可续航完整行程`);
      safeList.push(`太阳能日充电约 ${dailySolar}Wh，覆盖率约 ${solarCover}%`);
      safeList.push(`行程结束时剩余 ${finalSOC}%，可作为下次出行的初始余量`);
    }

    // ---- 舒适体验边界 ----
    let comfortText = '';
    let comfortList = [];

    if (minSOC > 30) {
      comfortText = `电池余量充足（最低 ${minSOC}%），你可以在产品边界内自由组合所有设备。`;
      comfortList.push(`投影仪可连续使用 ${state.devices.projector?.active ? state.devices.projector.hours : 2} 小时/天`);
      comfortList.push(`音箱、风扇可覆盖全天使用`);
      if (state.devices.kettle?.active) {
        comfortList.push(`电热水壶每日可使用 3-4 次（每次耗电约 400Wh）`);
      }
      comfortList.push(`所有设备同时开启也不触及功率边界（额定 2000W）`);
    } else if (minSOC > 15) {
      comfortText = `电池余量中等（最低 ${minSOC}%）。以下列出舒适设备组合的边界，便于你基于场景自选。`;
      comfortList.push(`投影仪晚 20:00-21:00 使用 1 小时：对续航影响 < 5%`);
      comfortList.push(`风扇 12:00-15:00 使用：利用太阳能直供，零电池消耗`);
      comfortList.push(`音箱 2 小时/天：对续航影响 < 3%`);
      comfortList.push(`热水壶每次 400Wh，使用 1 次约降低结束电量 25%`);
    } else {
      comfortText = `电池余量紧张（最低 ${minSOC}%）。舒适设备的边界如下，是否使用由你判断。`;
      comfortList.push(`投影仪 1 小时约消耗 100Wh，将使最低电量再降 6-7%`);
      comfortList.push(`风扇午间 2 小时可利用太阳能直供，不影响电池`);
      comfortList.push(`如坚持使用舒适设备，建议缩短行程或携带额外电池包`);
    }

    // ---- 应急边界信息 ----
    let emergencyText = '';
    let emergencyList = [];

    if (minSOC < 10) {
      emergencyText = `当前已接近产品硬边界。以下信息帮助你评估行程是否需要调整。`;
      emergencyList.push(`当前天气下太阳能日充电约 ${dailySolar}Wh，仅覆盖日消耗的 ${solarCover}%`);
      emergencyList.push(`若转为仅 ${essentialNames} 的极简模式，可续航约 ${Math.ceil(1500 / Math.max(dailyLoad * 0.3, 50))} 天`);
      emergencyList.push(`产品硬边界：持续 2000W / 峰值 2500W，超过将触发保护`);
      emergencyList.push(`如行程超过 ${state.days} 天且无市电补充，建议携带扩展电池包`);
    } else if (minSOC < 20) {
      emergencyText = `当前接近产品边界。以下数据帮助你判断缓冲空间。`;
      emergencyList.push(`阴雨天气（太阳能效率降至 20%）时，最低电量将再降 8-12%`);
      emergencyList.push(`每增加 1 人，日均负载将增加约 30Wh（手机充电）`);
      emergencyList.push(`500Wh 扩展包可将续航延长约 ${Math.round(500 / dailyLoad * 10) / 10} 天`);
      emergencyList.push(`电池长期低于 20% 存放将影响循环寿命`);
    } else {
      emergencyText = `当前距离应急状态很远。以下数据展示产品的极限边界供参考。`;
      emergencyList.push(`即使完全无太阳能，当前配置也可续航约 ${Math.floor(1500 / Math.max(dailyLoad, 1))} 天`);
      emergencyList.push(`温度边界：-10°C 至 40°C 正常工作，超出将降功率运行`);
      emergencyList.push(`电池 3000 次循环后容量保持率约 80%`);
    }

    return {
      safe: { text: safeText, list: safeList },
      comfort: { text: comfortText, list: comfortList },
      emergency: { text: emergencyText, list: emergencyList },
    };
  }

  // ============================================================
  // 场景复杂度评估 — 决定是否调用 LLM
  // ============================================================

  function assessComplexity(data) {
    const minSOC = data.minSOC;
    const deviceCount = Object.values(state.devices).filter((d) => d.active).length;
    const hasHighPowerDevice = state.devices.kettle?.active;
    const hasCustomHours = Object.entries(state.devices).some(([id, ds]) => {
      if (!ds.active) return false;
      const dev = DEVICES.find((d) => d.id === id);
      return dev && Math.abs(ds.hours - dev.defaultHours) > 2;
    });

    // 断电或即将断电：规则引擎最可靠
    if (minSOC <= 0) return 'critical';
    if (minSOC < 10) return 'critical';

    // 安全且简单：规则引擎足够
    if (minSOC > 30 && deviceCount <= 4 && !hasCustomHours) return 'simple';

    // 灰色区域：调 LLM
    if (minSOC > 30 && deviceCount > 4) return 'complex';
    if (minSOC >= 10 && minSOC <= 30) return 'complex';
    if (hasHighPowerDevice && minSOC < 40) return 'complex';
    if (hasCustomHours) return 'complex';

    return 'simple';
  }

  // ============================================================
  // LLM 方案生成器 — 调用 DeepSeek API
  // ============================================================

  async function llmPlans(data) {
    const weatherMap = { sunny: '晴天', cloudy: '多云', rainy: '阴雨' };
    const activeDevices = DEVICES
      .filter((d) => state.devices[d.id].active)
      .map((d) => {
        const hours = state.devices[d.id].hours;
        const multiplier = d.perPerson ? ` ×${state.people}人` : '';
        return `${d.name}(${d.watt}W, ${hours}h/天${multiplier})`;
      })
      .join('、');

    const eventText = data.events.length > 0
      ? data.events.map((e) => `${e.label}: ${e.message}`).join('；')
      : '无';

    const payload = {
      people: state.people,
      days: state.days,
      weather: weatherMap[state.weather],
      solar: state.solar,
      minSOC: data.minSOC,
      finalSOC: data.finalSOC,
      avgDailyLoad: data.avgDailyLoad,
      avgDailySolar: data.avgDailySolar,
      solarCoverage: data.avgDailySolar > 0 ? Math.round((data.avgDailySolar / data.avgDailyLoad) * 100) : 0,
      devices: activeDevices,
      events: eventText,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('/api/sandbox-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const result = await response.json();

    if (result.fallback || result.error) {
      throw new Error(result.error || 'LLM fallback triggered');
    }

    if (!result.plans || !result.plans.safe || !result.plans.comfort || !result.plans.emergency) {
      throw new Error('LLM response missing required fields');
    }

    return result.plans;
  }

  // ============================================================
  // 智能方案生成 — 三层触发机制
  // ============================================================

  async function generatePlansSmart(data) {
    // 第一层：硬性条件检查
    if (!navigator.onLine) {
      return { plans: ruleEnginePlans(data), source: 'rule-offline' };
    }

    // 检查后端是否配置了 DeepSeek
    if (!state.deepseekReady) {
      return { plans: ruleEnginePlans(data), source: 'rule-no-api' };
    }

    // 第二层：场景复杂度评估
    const complexity = assessComplexity(data);

    if (complexity === 'simple' || complexity === 'critical') {
      return { plans: ruleEnginePlans(data), source: complexity === 'critical' ? 'rule-critical' : 'rule-simple' };
    }

    // 第三层：调 LLM，带降级
    try {
      const plans = await llmPlans(data);
      return { plans, source: 'llm' };
    } catch (err) {
      return { plans: ruleEnginePlans(data), source: 'rule-fallback' };
    }
  }

  // ============================================================
  // 场景日志生成
  // ============================================================
  function generateScenarioLog(data) {
    const parts = [];
    const activeCount = Object.values(state.devices).filter((d) => d.active).length;
    const weatherMap = { sunny: '晴天', cloudy: '多云', rainy: '阴雨' };

    parts.push(`<strong>场景设定</strong>：${state.people} 人出行，${state.days} 天露营，${weatherMap[state.weather]}，太阳能板 ${state.solar}W，共 ${activeCount} 个设备接入。`);
    parts.push(`<strong>日均负载</strong>：${data.avgDailyLoad} Wh/天，<strong>日均太阳能</strong>：${data.avgDailySolar} Wh/天，太阳能覆盖率 ${data.avgDailySolar > 0 ? Math.round((data.avgDailySolar / data.avgDailyLoad) * 100) : 0}%。`);
    parts.push(`<strong>最低电量</strong>：${data.minSOC}%，<strong>结束电量</strong>：${data.finalSOC}%。`);

    if (data.events.length > 0) {
      const eventTexts = data.events.map((e) => `${e.label} ${e.message}`);
      parts.push(`<strong>关键事件</strong>：${eventTexts.join('；')}`);
    } else {
      parts.push(`<strong>关键事件</strong>：全程电量正常，无预警。`);
    }

    return parts.join('<br>');
  }

  // ============================================================
  // ECharts 图表渲染
  // ============================================================
  let chartInstance = null;

  function renderChart(data) {
    if (!chartInstance) {
      chartInstance = echarts.init(document.getElementById('chart-main'));
    }

    // 标记线
    const markLines = [
      { yAxis: 20, name: '安全预警 20%' },
      { yAxis: 10, name: '紧急 10%' },
    ];

    chartInstance.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: function (params) {
          let html = `<strong>${params[0].axisValue}</strong><br/>`;
          params.forEach((p) => {
            const unit = p.seriesName === '电量' ? '%' : 'Wh';
            html += `${p.marker} ${p.seriesName}：${p.value} ${unit}<br/>`;
          });
          return html;
        },
      },
      legend: {
        data: ['电量', '负载', '太阳能'],
        top: 5,
        textStyle: { fontSize: 12 },
      },
      grid: { left: 50, right: 30, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: data.hours,
        axisLabel: {
          fontSize: 10,
          interval: Math.floor(data.hours.length / 12),
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '电量 (%)',
          min: 0,
          max: 100,
          position: 'left',
          axisLabel: { formatter: '{value}%' },
        },
        {
          type: 'value',
          name: '能量 (Wh)',
          position: 'right',
        },
      ],
      series: [
        {
          name: '电量',
          type: 'line',
          data: data.soc,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#1f6f78' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(31,111,120,0.3)' },
                { offset: 1, color: 'rgba(31,111,120,0.02)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: markLines.map((m) => ({
              yAxis: m.yAxis,
              label: { formatter: m.name, fontSize: 10, color: '#e67e22' },
              lineStyle: { color: '#e67e22', type: 'dashed', width: 1 },
            })),
          },
        },
        {
          name: '负载',
          type: 'bar',
          data: data.load,
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(192,57,43,0.5)' },
          barWidth: '60%',
        },
        {
          name: '太阳能',
          type: 'bar',
          data: data.solar,
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(212,160,23,0.6)' },
          barWidth: '60%',
        },
      ],
    });

    chartInstance.resize();
  }

  // ============================================================
  // UI 渲染
  // ============================================================

  function renderDeviceList() {
    const container = document.getElementById('deviceList');
    container.innerHTML = '';

    DEVICES.forEach((d) => {
      const ds = state.devices[d.id];
      const item = document.createElement('div');
      item.className = 'device-item' + (ds.active ? ' active' : '');
      item.innerHTML = `
        <div class="device-item-left">
          <div class="device-check"></div>
          <div>
            <div class="device-name">${d.name}${d.perPerson ? ` ×${state.people}` : ''}</div>
            <div class="device-watt">${d.watt}W ${d.perPerson ? `× ${state.people}人 = ${d.watt * state.people}W` : ''}</div>
          </div>
        </div>
        <input type="number" class="device-hours" min="0" max="24" step="0.5" value="${ds.hours}" ${ds.active ? '' : 'disabled'} data-device="${d.id}">
      `;

      // 点击切换
      item.addEventListener('click', function (e) {
        if (e.target.classList.contains('device-hours')) return;
        ds.active = !ds.active;
        renderDeviceList();
      });

      container.appendChild(item);
    });

    // 绑定时长输入
    container.querySelectorAll('.device-hours').forEach((input) => {
      input.addEventListener('change', function () {
        const devId = this.dataset.device;
        const val = parseFloat(this.value);
        if (!isNaN(val) && val >= 0 && val <= 24) {
          state.devices[devId].hours = val;
        }
      });
      input.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });
  }

  function updateStats(data) {
    document.getElementById('statMinSOC').textContent = data.minSOC + '%';
    document.getElementById('statDaily').textContent = data.avgDailyLoad;
    document.getElementById('statSolar').textContent = data.avgDailySolar;

    const minCard = document.getElementById('statMinCard');
    minCard.classList.remove('danger', 'warn', 'safe');
    if (data.minSOC < 10) minCard.classList.add('danger');
    else if (data.minSOC < 20) minCard.classList.add('warn');
    else minCard.classList.add('safe');
  }

  function updatePlans(plans, source) {
    document.getElementById('planSafe').textContent = plans.safe.text;
    document.getElementById('planComfort').textContent = plans.comfort.text;
    document.getElementById('planEmergency').textContent = plans.emergency.text;

    const renderList = (id, list) => {
      const ul = document.getElementById(id);
      ul.innerHTML = list.map((t) => `<li>${t}</li>`).join('');
    };
    renderList('planSafeList', plans.safe.list);
    renderList('planComfortList', plans.comfort.list);
    renderList('planEmergencyList', plans.emergency.list);

    // 更新来源标签
    const badge = document.getElementById('aiBadge');
    if (badge) {
      const labels = {
        'llm': { text: 'DeepSeek AI 生成', cls: 'ai' },
        'rule-simple': { text: '规则引擎 · 场景简单', cls: 'rule' },
        'rule-critical': { text: '规则引擎 · 断电预警', cls: 'rule' },
        'rule-fallback': { text: '规则引擎 · AI 降级', cls: 'fallback' },
        'rule-offline': { text: '规则引擎 · 离线', cls: 'rule' },
        'rule-no-api': { text: '规则引擎', cls: 'rule' },
      };
      const info = labels[source] || labels['rule-no-api'];
      badge.textContent = info.text;
      badge.className = 'ai-badge ' + info.cls;
      badge.style.display = 'inline-flex';
    }
  }

  // 显示 AI 加载状态
  function showAILoading() {
    const badge = document.getElementById('aiBadge');
    if (badge) {
      badge.textContent = 'AI 生成中...';
      badge.className = 'ai-badge loading';
      badge.style.display = 'inline-flex';
    }
  }

  async function runSimulation() {
    // 检查至少有一个设备
    const hasActive = Object.values(state.devices).some((d) => d.active);
    if (!hasActive) {
      document.getElementById('scenarioLog').innerHTML = '<strong>请至少选择一个设备</strong> — 当前未勾选任何设备，无法模拟。';
      return;
    }

    const data = simulate();
    const log = generateScenarioLog(data);

    state.simulationData = data;

    // 立即更新统计和图表（不等 AI）
    updateStats(data);
    renderChart(data);
    document.getElementById('scenarioLog').innerHTML = log;

    // 先用规则引擎立即填充方案（保证用户立刻看到内容）
    const instantPlans = ruleEnginePlans(data);
    updatePlans(instantPlans, 'rule-simple');

    // 评估是否需要调 LLM
    const complexity = assessComplexity(data);
    if (complexity === 'complex' && state.deepseekReady && navigator.onLine) {
      showAILoading();
      try {
        const result = await generatePlansSmart(data);
        if (result.source === 'llm') {
          updatePlans(result.plans, result.source);
        } else if (result.source === 'rule-fallback') {
          updatePlans(result.plans, result.source);
        }
      } catch (err) {
        // 静默降级，保留已有规则引擎结果
        updatePlans(instantPlans, 'rule-fallback');
      }
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  function bindEvents() {
    // People
    document.getElementById('peopleGroup').addEventListener('click', function (e) {
      if (e.target.classList.contains('btn-chip')) {
        this.querySelectorAll('.btn-chip').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        state.people = parseInt(e.target.dataset.val);
        renderDeviceList();
      }
    });

    // Days slider
    const daysSlider = document.getElementById('daysSlider');
    const daysVal = document.getElementById('daysVal');
    daysSlider.addEventListener('input', function () {
      state.days = parseInt(this.value);
      daysVal.textContent = state.days + ' 天';
    });

    // Weather
    document.getElementById('weatherGroup').addEventListener('click', function (e) {
      if (e.target.classList.contains('btn-chip')) {
        this.querySelectorAll('.btn-chip').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        state.weather = e.target.dataset.val;
      }
    });

    // Solar
    document.getElementById('solarGroup').addEventListener('click', function (e) {
      if (e.target.classList.contains('btn-chip')) {
        this.querySelectorAll('.btn-chip').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        state.solar = parseInt(e.target.dataset.val);
      }
    });

    // Run button
    document.getElementById('runBtn').addEventListener('click', runSimulation);

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const preset = PRESETS[this.dataset.preset];
        if (!preset) return;

        state.people = preset.people;
        state.days = preset.days;
        state.weather = preset.weather;
        state.solar = preset.solar;

        // 重置设备
        Object.keys(state.devices).forEach((id) => {
          state.devices[id].active = false;
        });
        Object.entries(preset.devices).forEach(([id, hours]) => {
          if (state.devices[id]) {
            state.devices[id].active = true;
            state.devices[id].hours = hours;
          }
        });

        // 更新 UI
        document.getElementById('peopleGroup').querySelectorAll('.btn-chip').forEach((b) => {
          b.classList.toggle('active', parseInt(b.dataset.val) === state.people);
        });
        document.getElementById('daysSlider').value = state.days;
        document.getElementById('daysVal').textContent = state.days + ' 天';
        document.getElementById('weatherGroup').querySelectorAll('.btn-chip').forEach((b) => {
          b.classList.toggle('active', b.dataset.val === state.weather);
        });
        document.getElementById('solarGroup').querySelectorAll('.btn-chip').forEach((b) => {
          b.classList.toggle('active', parseInt(b.dataset.val) === state.solar);
        });

        renderDeviceList();
        runSimulation();
      });
    });

    // Window resize
    window.addEventListener('resize', function () {
      if (chartInstance) chartInstance.resize();
    });
  }

  // ============================================================
  // 初始化
  // ============================================================
  async function init() {
    renderDeviceList();
    bindEvents();

    // 检查后端 DeepSeek API 是否已配置
    try {
      const resp = await fetch('/api/status');
      const status = await resp.json();
      state.deepseekReady = !!status.deepseekConfigured;
    } catch (e) {
      state.deepseekReady = false;
    }

    // 默认运行一次
    runSimulation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
