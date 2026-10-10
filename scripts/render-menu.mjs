import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMenu, injectMenu } from './menu-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(root, 'templates/menu-stage.html');
const options = { data: resolve(root, 'data/menu.json'), out: resolve(root, 'outputs/menu.html') };

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('用法：node scripts/render-menu.mjs --data data/menu.json --out outputs/menu.html');
    process.exit(0);
  }
  for (let index = 0; index < args.length; index += 2) {
    if (!['--data', '--out'].includes(args[index]) || !args[index + 1]) throw new Error('只支持 --data <JSON> 和 --out <HTML>。');
    options[args[index].slice(2)] = resolve(args[index + 1]);
  }
  const pathKey = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  if ([templatePath, options.data].some((path) => pathKey(path) === pathKey(options.out))) throw new Error('输出不能覆盖模板或输入数据。');
  if (extname(options.out).toLowerCase() !== '.html') throw new Error('输出文件必须以 .html 结尾。');
  const data = normalizeMenu(JSON.parse(await readFile(options.data, 'utf8')));
  for (const item of data.items) {
    if (item.imageFile) {
      const imagePath = resolve(dirname(options.data), item.imageFile);
      const type = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }[extname(imagePath).toLowerCase()];
      if (!type) throw new Error(`${item.name} 的图片必须是 PNG / JPEG / WebP。`);
      const bytes = await readFile(imagePath);
      if (bytes.length > 5000000) throw new Error(`${item.name} 的图片超过 5 MB。`);
      const valid = type === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : type === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
      if (!valid) throw new Error(`${item.name} 的图片内容与扩展名不一致。`);
      item.image = `data:image/${type};base64,${bytes.toString('base64')}`;
    }
    delete item.imageFile;
  }
  const html = injectMenu(await readFile(templatePath, 'utf8'), data);
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, html, 'utf8');
  console.log(`已生成：${options.out}`);
  console.log(`${data.result.status === 'no-match' ? '未匹配到菜单' : `餐品 ${data.items.length} 项`} · ${data.isDemo ? '示例数据' : data.result.status === 'no-match' ? 'MCP 查询结果' : data.quote.status === 'verified' ? 'MCP 已核价' : 'MCP 待核价'}`);
} catch (error) {
  console.error(`生成失败：${error.message}`);
  process.exitCode = 1;
}
