const fail = (message) => { throw new Error(message); };

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象。`);
  return value;
}

function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} 必须是 1–${max} 字的文本。`);
  return value.trim();
}

function optionalText(value, label, max) {
  return value == null ? null : text(value, label, max);
}

export function cents(value, label = '金额') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    fail(`${label} 必须是非负金额，最多两位小数。`);
  }
  return Math.round(value * 100);
}

function strings(value, label, maxCount = 12) {
  if (!Array.isArray(value) || value.length > maxCount) fail(`${label} 必须是最多 ${maxCount} 项的文本数组。`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 150));
}

function rejectCredentials(value, path = 'data') {
  if (typeof value === 'string' && /Bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)) {
    fail(`${path} 包含凭证格式，不能导出。`);
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/token|password|secret|authorization|api[-_]?key|phone|mobile|address|email|credential/i.test(key)) {
      fail(`${path}.${key} 可能包含凭证或个人信息，请移除该字段。`);
    }
    rejectCredentials(child, `${path}.${key}`);
  }
}

const arts = ['burger', 'fries', 'drink', 'nuggets', 'wrap', 'salad', 'dessert', 'coffee', 'generic'];

// Construct an allowlisted payload: raw MCP objects never enter the HTML.
export function normalizeMenu(input) {
  object(input, 'data');
  rejectCredentials(input);
  if (input.version !== 1) fail('version 必须为 1。');
  if (typeof input.isDemo !== 'boolean') fail('isDemo 必须明确设置为 true 或 false。');
  const request = object(input.request, 'request');
  const budget = cents(request.budget, 'request.budget');
  if (!Number.isInteger(request.people) || request.people < 1 || request.people > 50) fail('request.people 必须为 1–50 的整数。');
  if (!['dine-in', 'takeaway', 'delivery'].includes(request.dining)) fail('request.dining 必须为 dine-in / takeaway / delivery。');
  const preferences = strings(request.preferences ?? [], 'request.preferences');
  const rawResult = object(input.result ?? { status: 'ready' }, 'result');
  if (!['ready', 'no-match'].includes(rawResult.status)) fail('result.status 必须为 ready / no-match。');
  const noMatch = rawResult.status === 'no-match';
  let result = { status: 'ready' };
  if (noMatch) {
    if (!['budget', 'preferences', 'availability'].includes(rawResult.reason)) fail('result.reason 必须为 budget / preferences / availability。');
    const minimumTotal = rawResult.minimumTotal == null ? null : cents(rawResult.minimumTotal, 'result.minimumTotal') / 100;
    if (minimumTotal != null && (rawResult.reason !== 'budget' || cents(minimumTotal) <= budget)) fail('预算不足的已核验起价必须高于当前预算，其他原因不能填写起价。');
    result = {
      status: 'no-match', reason: rawResult.reason,
      message: text(rawResult.message ?? ({ budget: '当前门店与需求下，暂未找到预算内可点的餐品。', preferences: '当前门店暂未找到符合用餐需求的餐品。', availability: '当前门店暂时没有符合需求的可售餐品。' })[rawResult.reason], 'result.message', 500),
      minimumTotal
    };
  }
  const clientName = text(input.clientName ?? '当前客户端', 'clientName', 60);
  const quote = object(input.quote, 'quote');
  if (noMatch) {
    if (quote.status !== 'not-applicable') fail('没有匹配菜单时必须使用 quote.status: not-applicable。');
  } else {
    if (!['demo', 'verified', 'unknown'].includes(quote.status)) fail('quote.status 必须为 demo / verified / unknown。');
    if (input.isDemo && quote.status !== 'demo') fail('示例数据必须使用 quote.status: demo。');
    if (!input.isDemo && quote.status === 'demo') fail('实际查询不能使用示例报价。');
  }
  if (!Array.isArray(input.items) || input.items.length > 30 || (noMatch ? input.items.length !== 0 : input.items.length < 1)) fail(noMatch ? '没有匹配菜单时 items 必须为空数组，不能推荐超预算餐品。' : 'items 必须包含 1–30 项餐品。');

  const ids = new Set();
  const items = input.items.map((item, index) => {
    const label = `items[${index}]`;
    object(item, label);
    const id = text(item.id, `${label}.id`, 100);
    if (ids.has(id)) fail(`${label}.id 重复。`);
    ids.add(id);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) fail(`${label}.quantity 必须为 1–100 的整数。`);
    if (!arts.includes(item.art)) fail(`${label}.art 不支持，请使用 ${arts.join(' / ')}。`);
    const unitPrice = item.unitPrice == null ? null : cents(item.unitPrice, `${label}.unitPrice`) / 100;
    const hints = strings(item.hints, `${label}.hints`, 3);
    if (!hints.length) fail(`${label}.hints 至少需要一条提示。`);
    if (item.image != null && (typeof item.image !== 'string' || item.image.length > 7000000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.image))) {
      fail(`${label}.image 仅支持嵌入的 PNG / JPEG / WebP，不能放远程 URL 或 SVG。`);
    }
    return {
      id, name: text(item.name, `${label}.name`, 100), quantity: item.quantity,
      role: text(item.role, `${label}.role`, 30), art: item.art, unitPrice,
      image: item.image ?? null,
      imageFile: optionalText(item.imageFile, `${label}.imageFile`, 1000),
      hints, entrance: text(item.entrance, `${label}.entrance`, 150),
      reason: text(item.reason, `${label}.reason`, 300),
      nutrition: optionalText(item.nutrition, `${label}.nutrition`, 150)
    };
  });

  const sourceTools = strings(input.sourceTools ?? [], 'sourceTools', 20);
  let queriedAt = null;
  if (input.queriedAt != null) {
    queriedAt = text(input.queriedAt, 'queriedAt', 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(queriedAt) || Number.isNaN(Date.parse(queriedAt))) fail('queriedAt 必须为包含时区的 ISO 时间。');
  }
  const store = input.store == null ? null : { name: text(object(input.store, 'store').name, 'store.name', 100) };
  if (!input.isDemo && (!store || !queriedAt || !sourceTools.includes('query-meals'))) {
    fail('实际查询必须填写门店、查询时间及 query-meals 工具来源。');
  }
  if (!input.isDemo) {
    const claimIndex = sourceTools.indexOf('auto-bind-coupons');
    const couponsIndex = sourceTools.indexOf('query-store-coupons');
    const mealsIndex = sourceTools.indexOf('query-meals');
    if (claimIndex < 0 || couponsIndex < 0 || claimIndex >= couponsIndex || couponsIndex >= mealsIndex) {
      fail('真实推荐必须先 auto-bind-coupons 领券，再 query-store-coupons 查询门店券，后 query-meals 查询菜单。');
    }
    if (noMatch && result.minimumTotal != null && sourceTools.indexOf('calculate-price') <= mealsIndex) fail('预算不足页面的具体起价必须有查询菜单后的 calculate-price 核验记录。');
  }

  let normalizedQuote;
  if (noMatch || quote.status === 'unknown') {
    for (const key of ['subtotal', 'discount', 'deliveryFee', 'otherFees', 'total']) {
      if (quote[key] != null) fail(noMatch ? '没有匹配菜单时不能填写报价金额，包括 0 元总价。' : '待核价模式的报价金额必须为 null 或省略。');
    }
    if (items.some((item) => item.unitPrice != null)) fail('待核价模式的 unitPrice 必须为 null。');
    normalizedQuote = { status: noMatch ? 'not-applicable' : 'unknown', subtotal: null, discount: null, deliveryFee: null, otherFees: null, total: null, couponLabel: null };
  } else {
    const amounts = {};
    for (const key of ['subtotal', 'discount', 'deliveryFee', 'otherFees', 'total']) amounts[key] = cents(quote[key], `quote.${key}`);
    if (amounts.discount > amounts.subtotal) fail('优惠金额不能大于餐品小计。');
    if (amounts.total !== amounts.subtotal - amounts.discount + amounts.deliveryFee + amounts.otherFees) fail('报价合计不一致：小计 - 优惠 + 配送费 + 其他费用 必须等于总价。');
    if (amounts.total > budget) fail('推荐菜单超过预算，请重新选餐。');
    if (request.dining !== 'delivery' && amounts.deliveryFee !== 0) fail('到店用餐的配送费必须为 0。');
    if (items.every((item) => item.unitPrice != null)) {
      const subtotal = items.reduce((sum, item) => sum + cents(item.unitPrice) * item.quantity, 0);
      if (subtotal !== amounts.subtotal) fail('餐品单价合计与报价小计不一致；无法分摊的套餐单价应设为 null。');
    }
    if (quote.status === 'verified' && !sourceTools.includes('calculate-price')) fail('已核价菜单必须包含 calculate-price 工具来源。');
    if (quote.status === 'verified' && sourceTools.indexOf('calculate-price') <= sourceTools.indexOf('query-meals')) fail('calculate-price 必须在领券、查询门店券和菜单之后调用。');
    normalizedQuote = { status: quote.status, ...Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value / 100])), couponLabel: optionalText(quote.couponLabel, 'quote.couponLabel', 150) };
  }

  return {
    version: 1, isDemo: input.isDemo, result, clientName,
    title: text(input.title ?? (noMatch ? '这次的饭点，先等一等。' : '今天的饭点，主角登场。'), 'title', 100),
    request: { text: text(request.text, 'request.text'), budget: budget / 100, people: request.people, dining: request.dining, preferences },
    store, queriedAt, sourceTools, quote: normalizedQuote, items
  };
}

export function injectMenu(template, data) {
  const marker = /(<script id="menu-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!marker.test(template)) fail('HTML 模板缺少 menu-data 数据插槽。');
  const json = JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace(marker, (_match, start, end) => `${start}\n${json}\n${end}`);
}
