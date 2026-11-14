import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, readTheme } from './lib/theme';
import './styles.css';

applyTheme(readTheme());

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * 注册离线缓存。只在生产构建里注册 —— 开发时开着 SW 会缓存住旧的模块，
 * HMR 就失效了，改一行要手动清缓存才能看到。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
        await navigator.serviceWorker.ready;

        // 首次访问时 SW 还没接管页面，JS/CSS 是绕过它加载的。
        // 把它们主动交给 SW 存起来，否则「离线能打开」只能靠浏览器 HTTP 缓存碰运气。
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(location.origin) && !url.includes('/api/'))
          .filter((url) => /\.(js|css|png|svg|webmanifest)$/.test(url));

        registration.active?.postMessage({ type: 'cache-urls', urls });
      } catch {
        /* 注册失败不影响正常使用 */
      }
    })();
  });
}
