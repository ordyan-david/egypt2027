import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Локальный просмотр без npm-зависимостей. Публикация использует файлы dist/ напрямую.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = await realpath(resolve(projectRoot, 'dist'));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');
};
const port = Number(option('--port') ?? option('-p') ?? process.env.PORT ?? 3000);
const host = option('--host') ?? option('--hostname') ?? process.env.HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT должен быть целым числом от 1 до 65535.');
  process.exit(1);
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

const insideRoot = (candidate) => {
  const pathFromRoot = relative(webRoot, candidate);
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
};

const server = createServer(async (request, response) => {
  const sendError = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : message);
  };

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    sendError(405, 'Метод не поддерживается');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  } catch {
    sendError(400, 'Некорректный адрес');
    return;
  }

  // Не открываем исходники вне dist/, dotfiles, обход через .. или обратные слэши.
  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((segment) => segment.startsWith('.'))) {
    sendError(403, 'Доступ запрещён');
    return;
  }

  try {
    let target = resolve(webRoot, `.${pathname}`);
    if (!insideRoot(target)) {
      sendError(403, 'Доступ запрещён');
      return;
    }
    let info = await stat(target);
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(308, { Location: `${encodeURI(pathname)}/` });
        response.end();
        return;
      }
      target = resolve(target, 'index.html');
    }
    // realpath запрещает выход через символическую ссылку внутри dist/.
    target = await realpath(target);
    if (!insideRoot(target)) {
      sendError(403, 'Доступ запрещён');
      return;
    }
    info = await stat(target);
    if (!info.isFile()) {
      sendError(404, 'Страница не найдена');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(target);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    sendError(error.code === 'EACCES' ? 403 : 404, 'Файл не найден');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Например, запустите: PORT=3001 npm run dev` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`Египет 2027: http://localhost:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
