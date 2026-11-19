import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 兜底：渲染出错时别白屏。
 *
 * 白屏是最吓人的一种失败 —— 用户第一反应是「我的笔记没了」。其实数据
 * 好好躺在 IndexedDB 里，只是这一屏画不出来。所以这里只做两件事：
 * 说清楚数据还在，给一个刷新按钮。
 *
 * 还是 class 组件，因为 React 只给了 class 这一种错误边界。
 */
async function wipeAndReload(): Promise<void> {
  const ok = window.confirm('清空这台设备上的笔记？云端的不受影响，但本机没同步上去的可能就没了。');
  if (!ok) return;

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('nicenotes');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    // 别的标签页还开着时会 blocked，也放行 —— 刷新之后它自己会重建
    request.onblocked = () => resolve();
  });
  window.location.reload();
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 没有上报的地方，但控制台至少留一份，排查时能顺着组件栈找
    console.error('界面渲染出错', error, info.componentStack);
  }

  /**
   * 最后的出路。
   *
   * 之前的第二个按钮跳到一个 ?reset=1，可那个参数根本没人处理 —— 等于
   * 给了个假出口。这里直接把本地库删掉重来：正常路径上都用不到它，
   * 能走到这一步的多半就是数据坏了。
   */
  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fatal">
        <h1>这一屏画不出来了</h1>
        <p>
          你的笔记还在本机，一条都没少 —— 只是界面出了点问题。刷新一下通常就好；
          如果每次打开都这样，多半是某条数据坏了，可以清空本机重来（云端不受影响）。
        </p>
        <div className="fatal-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            刷新页面
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void wipeAndReload()}>
            清空本机重来
          </button>
        </div>
        <pre className="fatal-detail">{error.message}</pre>
      </div>
    );
  }
}
