import './styles/main.css';
import { load } from './store';
import { mountApp } from './ui/app';

const root = document.getElementById('app');

if (root) {
  load()
    .then(() => mountApp(root))
    .catch((err: unknown) => {
      console.error(err);
      root.textContent = '本地数据库打不开。可能是无痕模式，换个普通窗口试试。';
      root.className = 'boot-error';
    });
}
