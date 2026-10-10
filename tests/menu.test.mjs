import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeMenu, injectMenu } from '../scripts/menu-data.mjs';

const example = JSON.parse(await readFile(new URL('../data/menu.example.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('../templates/menu-stage.html', import.meta.url), 'utf8');
const fresh = () => structuredClone(example);
const lowBudgetExample = JSON.parse(await readFile(new URL('../data/menu.low-budget.example.json', import.meta.url), 'utf8'));
const empty = () => structuredClone(lowBudgetExample);
const real = () => {
  const data = fresh();
  data.isDemo = false; data.quote.status = 'verified';
  data.queriedAt = '2026-10-10T18:00:00+08:00';
  data.sourceTools = ['auto-bind-coupons', 'query-store-coupons', 'query-meals', 'calculate-price'];
  return data;
};

test('预算包含优惠、配送费和其他费用，超支时拒绝生成', () => {
  const data = fresh(); data.request.dining = 'delivery';
  data.quote.deliveryFee = 2; data.quote.total = 35;
  assert.equal(normalizeMenu(data).quote.total, 35);
  data.quote.otherFees = .01; data.quote.total = 35.01;
  assert.throws(() => normalizeMenu(data), /超过预算/);
});

test('核价合计与单价小计必须吻合，套餐可保留未知单价', () => {
  const data = fresh(); data.quote.total = 32;
  assert.throws(() => normalizeMenu(data), /合计不一致/);
  data.quote.total = 33; data.items[0].unitPrice = 20;
  assert.throws(() => normalizeMenu(data), /单价合计/);
  data.items[0].unitPrice = null;
  assert.equal(normalizeMenu(data).quote.subtotal, 40);
});

test('使用分核算小数，不接受三位小数', () => {
  const data = fresh(); data.items = [data.items[0], data.items[1]];
  data.items[0].unitPrice = .1; data.items[1].unitPrice = .2;
  Object.assign(data.quote, {subtotal:.3,discount:0,deliveryFee:0,otherFees:0,total:.3});
  assert.equal(normalizeMenu(data).quote.total, .3);
  data.items[0].unitPrice = .101;
  assert.throws(() => normalizeMenu(data), /最多两位小数/);
});

test('实际推荐必须有门店、查询时间和报价工具来源', () => {
  const data = real();
  assert.equal(normalizeMenu(data).isDemo, false);
  data.sourceTools = ['auto-bind-coupons', 'query-store-coupons', 'query-meals'];
  assert.throws(() => normalizeMenu(data), /calculate-price/);
  data.sourceTools.push('calculate-price'); data.queriedAt = null;
  assert.throws(() => normalizeMenu(data), /查询时间/);
});

test('待核价菜单不能显示虚构价格或余额', () => {
  const data = real(); data.quote = {status:'unknown'};
  data.items.forEach((item) => { item.unitPrice = null; });
  assert.equal(normalizeMenu(data).quote.total, null);
  data.quote.total = 33;
  assert.throws(() => normalizeMenu(data), /待核价模式/);
});

test('真实推荐不能跳过领券或领取后的门店券查询', () => {
  for (const missing of ['auto-bind-coupons', 'query-store-coupons']) {
    const data = real();
    data.sourceTools = data.sourceTools.filter((tool) => tool !== missing);
    assert.throws(() => normalizeMenu(data), /必须先 auto-bind-coupons/);
  }
});

test('领取、门店券、菜单及核价的首次调用记录必须依次执行', () => {
  const data = real();
  data.sourceTools = ['query-store-coupons', 'auto-bind-coupons', 'query-meals', 'calculate-price'];
  assert.throws(() => normalizeMenu(data), /必须先 auto-bind-coupons/);
  data.sourceTools = ['auto-bind-coupons', 'query-meals', 'query-store-coupons', 'calculate-price'];
  assert.throws(() => normalizeMenu(data), /必须先 auto-bind-coupons/);
  data.sourceTools = ['auto-bind-coupons', 'query-store-coupons', 'calculate-price', 'query-meals'];
  assert.throws(() => normalizeMenu(data), /calculate-price 必须在/);
});

test('待核价菜单也必须先领取优惠券', () => {
  const data = real(); data.quote = {status:'unknown'};
  data.items.forEach((item) => { item.unitPrice = null; });
  data.sourceTools = ['query-store-coupons', 'query-meals'];
  assert.throws(() => normalizeMenu(data), /必须先 auto-bind-coupons/);
});

test('无适用优惠时保留领取记录并按原价核算，演示不伪造调用', () => {
  const data = real();
  data.request.budget = 40; data.quote.discount = 0; data.quote.total = 40;
  assert.equal(normalizeMenu(data).quote.discount, 0);
  assert.deepEqual(normalizeMenu(fresh()).sourceTools, []);
});

test('预算不足生成空结果，不伪造总价、余额或起价', () => {
  const data = normalizeMenu(empty());
  assert.equal(data.result.status, 'no-match');
  assert.equal(data.result.minimumTotal, null);
  assert.equal(data.quote.status, 'not-applicable');
  assert.equal(data.quote.total, null);
  assert.deepEqual(data.items, []);
  assert.equal(data.clientName, '当前客户端');
});

test('无匹配状态不能夹带推荐餐品或 0 元报价，普通菜单不能为空', () => {
  const data = empty(); data.items = fresh().items;
  assert.throws(() => normalizeMenu(data), /items 必须为空数组/);
  data.items = []; data.quote.total = 0;
  assert.throws(() => normalizeMenu(data), /包括 0 元总价/);
  const ready = fresh(); ready.items = [];
  assert.throws(() => normalizeMenu(ready), /1–30/);
});

test('具体起价必须高于预算，真实起价需要核价来源', () => {
  const data = empty(); data.result.minimumTotal = 1;
  assert.throws(() => normalizeMenu(data), /必须高于当前预算/);
  data.result.minimumTotal = 8;
  data.isDemo = false; data.queriedAt = '2026-10-10T18:00:00+08:00';
  data.sourceTools = ['auto-bind-coupons', 'query-store-coupons', 'query-meals'];
  assert.throws(() => normalizeMenu(data), /具体起价必须有/);
  data.sourceTools.push('calculate-price');
  assert.equal(normalizeMenu(data).result.minimumTotal, 8);
});

test('真实空结果也不能跳过领券；其他无匹配原因不伪造预算起价', () => {
  const data = empty(); data.isDemo = false; data.queriedAt = '2026-10-10T18:00:00+08:00';
  data.sourceTools = ['query-store-coupons', 'query-meals'];
  assert.throws(() => normalizeMenu(data), /必须先 auto-bind-coupons/);
  data.sourceTools.unshift('auto-bind-coupons');
  assert.equal(normalizeMenu(data).items.length, 0);
  data.result.reason = 'preferences'; data.result.minimumTotal = 8;
  assert.throws(() => normalizeMenu(data), /其他原因不能填写起价/);
});

test('低预算不固定判为失败，核验后的免费方案仍能生成菜单', () => {
  const data = real(); data.request.budget = 1; data.items = [data.items[0]];
  Object.assign(data.quote, {subtotal:22,discount:22,total:0});
  const output = normalizeMenu(data);
  assert.equal(output.result.status, 'ready');
  assert.equal(output.quote.total, 0);
  assert.equal(output.items.length, 1);
});

test('客户端名写入结果数据，并安全嵌入 HTML', () => {
  const data = empty(); data.clientName = 'WorkBuddy';
  assert.equal(normalizeMenu(data).clientName, 'WorkBuddy');
  data.clientName = '<img src=x onerror=alert(1)>';
  const html = injectMenu(template, normalizeMenu(data));
  assert.equal(html.includes(data.clientName), false);
  const payload = JSON.parse(html.match(/<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.clientName, data.clientName);
});

test('凭证及个人信息字段拒绝导出，其他额外字段不进入页面', () => {
  const data = fresh(); data.internal = {owner:'internal-only'};
  assert.equal(normalizeMenu(data).internal, undefined);
  data.internal.accessToken = 'should-not-be-exported';
  assert.throws(() => normalizeMenu(data), /个人信息/);
  delete data.internal; data.request.text = 'Bearer example-credential';
  assert.throws(() => normalizeMenu(data), /凭证格式/);
});

test('餐品名称中的 HTML、脚本结束符和替换字符只作为 JSON 数据', () => {
  const data = fresh();
  data.items[0].name = '</script><script>globalThis.injected=1</script> $& $`';
  const normalized = normalizeMenu(data);
  const html = injectMenu(template, normalized);
  assert.equal(html.includes(data.items[0].name), false);
  const embedded = html.match(/<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(embedded).items[0].name, data.items[0].name);
  assert.equal(html.includes('globalThis.injected=1</script>'), false);
});

test('更换餐品数量与类别时模板仍可复用，不引入远程图片依赖', () => {
  const data = fresh(); data.items = [data.items[2]];
  Object.assign(data.quote, {subtotal:8,discount:0,total:8});
  const html = injectMenu(template, normalizeMenu(data));
  const payload = JSON.parse(html.match(/<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.items.length, 1); assert.equal(payload.items[0].art, 'drink');
  data.items[0].image = 'https://example.com/photo.png';
  assert.throws(() => normalizeMenu(data), /远程 URL/);
});

test('CLI 生成文件，并在失败时保留现有输出', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcd-stage-'));
  try {
    const source = resolve(directory, 'menu.json'), output = resolve(directory, 'menu.html');
    await writeFile(source, JSON.stringify(fresh()));
    const script = new URL('../scripts/render-menu.mjs', import.meta.url);
    const run = () => spawnSync(process.execPath, [fileURLToPath(script), '--data', source, '--out', output], {encoding:'utf8'});
    assert.equal(run().status, 0);
    const generated = await readFile(output, 'utf8');
    assert.ok(generated.startsWith('<!doctype html>'));
    const data = fresh(); data.request.budget = 1;
    await writeFile(source, JSON.stringify(data));
    assert.equal(run().status, 1);
    assert.equal(await readFile(output, 'utf8'), generated);
    await writeFile(source, JSON.stringify(empty()));
    assert.equal(run().status, 0);
    const emptyHtml = await readFile(output, 'utf8');
    const emptyPayload = JSON.parse(emptyHtml.match(/<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(emptyPayload.result.status, 'no-match');
    assert.deepEqual(emptyPayload.items, []);
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
});
