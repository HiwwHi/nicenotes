import { useEffect, useRef, useState } from 'react';
import { hasBackend } from '../lib/api';
import { pastLabel, splitBody, todayStamp } from '../lib/date';
import { downloadText } from '../lib/download';
import { buildHeatmap, computeStreak, longestStreak, totalReviews, weekReviews } from '../lib/stats';
import type { Theme } from '../lib/theme';
import {
  buildExport,
  buildHtml,
  buildMarkdown,
  changePassword,
  importJson,
  importMarkdownFiles,
  restoreDeletedNotes,
  signIn,
  signOut,
  syncNow,
  toast,
  useApp,
  wipeLocal,
} from '../store';

interface Props {
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export function Settings({ theme, onTheme }: Props) {
  const { account, allowRegister, syncing, lastSyncAt, syncError, notes, log } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  // 清空要连点两次：第一次只是把按钮变成确认态，6 秒内不再点就复原
  const [confirmWipe, setConfirmWipe] = useState(false);
  // 改密码的表单默认收着，不占地方
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');

  // 顺手报一下本地占了多少，几百条笔记也就几百 KB，但知道个量级安心
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        const bytes = estimate.usage ?? 0;
        if (bytes <= 0) return;
        setUsage(bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
      })
      .catch(() => undefined);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);
  const now = Date.now();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password, mode);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '没成功，再试一次');
    } finally {
      setBusy(false);
    }
  }

  const visible = notes.filter((note) => !note.deletedAt).length;
  // 归档的也算在「笔记」里，但不再参与复习 —— 数字摊开说，别让人以为
  // 这些全都在循环里
  const archivedCount = notes.filter((note) => !note.deletedAt && note.archivedAt).length;
  // 删除是软删除，内容还躺在库里 —— 撤销提示过了之后就没入口了，这里给一个
  const deletedCount = notes.filter((note) => note.deletedAt).length;
  const streak = computeStreak(log, now);
  const reviews = totalReviews(log);
  const weekCount = weekReviews(log, now);
  const best = longestStreak(log);
  // 第一条笔记是什么时候写的 —— 用 reduce 而不是 Math.min(...)，笔记多了
  // 展开成参数会爆栈
  const firstAt = notes.reduce<number | null>(
    (min, note) => (note.deletedAt ? min : min == null || note.createdAt < min ? note.createdAt : min),
    null,
  );
  const daysSince = firstAt == null ? 0 : Math.max(1, Math.floor((now - firstAt) / 86_400_000) + 1);

  // 平均间隔：只算已经进入复习循环的那些（从没复习过的 interval 是 0，
  // 算进去会把平均数拉低到没意义）
  const intervals = notes
    .filter((note) => !note.deletedAt && note.memory.reps > 0)
    .map((note) => note.memory.interval);
  const avgInterval =
    intervals.length === 0
      ? 0
      : Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length);
  const cells = buildHeatmap(log, 12, now);

  /** 导出文件名里带上条数：备份攒了几个之后，光看日期分不出内容和大小 */
  const liveCount = notes.filter((note) => !note.deletedAt).length;

  function doExport() {
    downloadText(buildExport(), `nicenotes-${liveCount}条-${todayStamp()}.json`, 'application/json');
    toast('已导出，是一个普通 JSON 文件');
  }

  async function doChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!pwCurrent || pwNext.length < 8) return;

    setBusy(true);
    const ok = await changePassword(pwCurrent, pwNext);
    setBusy(false);

    if (ok) {
      setPwOpen(false);
      setPwCurrent('');
      setPwNext('');
    }
  }

  async function doImport(file: File) {
    try {
      const result = await importJson(await file.text());

      if (result.added === 0 && result.skipped === 0) {
        toast('文件里没有笔记', 'warn');
        return;
      }

      const parts: string[] = [];
      if (result.added > 0) parts.push(`导入 ${result.added} 条`);
      if (result.skipped > 0) parts.push(`${result.skipped} 条本机已有，留着本机的`);
      toast(parts.join('，'), result.added > 0 ? 'ok' : 'warn');
    } catch (error) {
      toast(
        error instanceof Error && error.message ? error.message : '这个文件读不了，需要之前导出的 JSON',
        'error',
      );
    }
  }

  function doExportMarkdown() {
    const text = buildMarkdown();
    if (!text.trim()) {
      toast('还没有笔记可以导出', 'warn');
      return;
    }

    downloadText(text, `nicenotes-${liveCount}条-${todayStamp()}.md`, 'text/markdown;charset=utf-8');

    /*
     * 正文里以 ## 开头的行，在不同工具里含义不一样 —— 这份文件的结构就是
     * 「一条笔记 = 一个 ## 标题」，所以导回来时那些行会被当成新的一条，
     * 把原文切成两半。格式固有的局限，改不了，但得说。
     */
    const risky = notes.filter(
      (note) => !note.deletedAt && /^## /m.test(splitBody(note.body).rest),
    ).length;

    if (risky > 0) {
      toast(
        `导出好了。有 ${risky} 条笔记的正文里有 ## 开头的行，这份文件导回来会被拆成多条 —— 要保真请用「导出全部」那份 JSON`,
        'warn',
      );
      return;
    }
    toast('已导出 Markdown，这个文件能原样导回来');
  }

  function doExportHtml() {
    const html = buildHtml();
    if (!html.trim()) {
      toast('还没有笔记可以导出', 'warn');
      return;
    }

    downloadText(html, `nicenotes-${liveCount}条-${todayStamp()}.html`, 'text/html;charset=utf-8');
    toast('导出了一个 HTML，双击就能看');
  }

  async function doImportMarkdown(list: FileList) {
    try {
      const files = await Promise.all(
        [...list].map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      const result = await importMarkdownFiles(files);

      if (result.added === 0 && result.skipped === 0) {
        toast('这些文件里没有能导入的内容', 'warn');
        return;
      }

      const parts: string[] = [];
      if (result.added > 0) parts.push(`导入 ${result.added} 条`);
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条重复的`);
      toast(parts.join('，'), result.added > 0 ? 'ok' : 'warn');
    } catch {
      toast('读不了这个文件，确认是 UTF-8 的纯文本', 'error');
    }
  }

  return (
    <section className="settings">
      <div className="panel">
        <h2 className="panel-title">账号与同步</h2>
        <p className="panel-desc">
          不登录也能一直用，笔记只存在这台设备上。登录之后多一个能力：换设备时把笔记接回来。
        </p>

        {!hasBackend ? (
          <p className="panel-note">当前部署没有连接后端，同步功能关闭。本地功能不受影响。</p>
        ) : account ? (
          <div className="account">
            <div className="account-row">
              <span className="account-email">{account.email}</span>
              <span
                className="account-state"
                // 相对时间好读，但排查问题时想知道准确到分钟的那一次
                title={lastSyncAt ? new Date(lastSyncAt).toLocaleString('zh-CN') : undefined}
              >
                {syncing ? '同步中…' : lastSyncAt ? `${pastLabel(lastSyncAt)}同步过` : '还没同步'}
              </span>
            </div>
            {syncError && <p className="panel-error">{syncError}</p>}
            <div className="account-actions">
              <button type="button" className="btn btn-primary" disabled={syncing} onClick={() => void syncNow()}>
                {syncing ? '同步中' : '立即同步'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPwOpen((open) => !open)}
                aria-expanded={pwOpen}
              >
                {pwOpen ? '不改了' : '改密码'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
                退出登录
              </button>
            </div>

            {pwOpen && (
              <form className="auth pw-form" onSubmit={doChangePassword}>
                {/* .field 是给 input 的类（38px 高、带边框），套在 label 上会
                    变成「一个假输入框里塞着标签和输入框」—— 手机上挤成一团 */}
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  placeholder="原密码"
                  aria-label="原密码"
                  value={pwCurrent}
                  onChange={(event) => setPwCurrent(event.target.value)}
                  required
                />
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  placeholder="新密码（至少 8 位）"
                  aria-label="新密码"
                  minLength={8}
                  value={pwNext}
                  onChange={(event) => setPwNext(event.target.value)}
                  required
                />
                <p className="panel-hint">改完之后，其他设备上的登录会被退出，这台保持在线。</p>
                <button type="submit" className="btn btn-primary" disabled={busy || !pwCurrent || pwNext.length < 8}>
                  {busy ? '改着…' : '改密码'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form className="auth" onSubmit={submit}>
            {allowRegister && (
              <div className="auth-tabs">
                <button
                  type="button"
                  className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
                  onClick={() => setMode('login')}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`}
                  onClick={() => setMode('register')}
                >
                  注册
                </button>
              </div>
            )}
            <input
              className="field"
              type="email"
              required
              autoComplete="email"
              placeholder="邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              className="field"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="密码（至少 8 位）"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error && <p className="panel-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '处理中' : mode === 'login' ? '登录' : '注册并同步'}
            </button>
            <p className="auth-note">只用邮箱和密码，不发验证邮件，不接第三方登录。</p>
          </form>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">记录</h2>
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{streak}</span>
            <span className="stat-label">
              连续天数
              {best > streak && <span className="stat-sub">最好 {best}</span>}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{reviews}</span>
            <span className="stat-label">
              累计复习
              <span className="stat-sub">本周 {weekCount}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{visible}</span>
            <span className="stat-label">
              笔记{archivedCount > 0 ? `（${archivedCount} 已归档）` : ''}
            </span>
          </div>
        </div>

        <div className="heat" aria-label="最近 12 周的复习记录">
          {cells.map((cell) => {
            const level = cell.count === 0 ? 0 : cell.count < 3 ? 1 : cell.count < 6 ? 2 : 3;
            return (
              <span
                key={cell.ts}
                className={`heat-cell heat-${level} ${cell.future ? 'is-future' : ''}`}
                title={cell.count ? `${new Date(cell.ts).toLocaleDateString('zh-CN')} · ${cell.count} 次` : ''}
              />
            );
          })}
        </div>
        {firstAt != null && (
          <p className="panel-note">
            从 {new Date(firstAt).toLocaleDateString('zh-CN')} 记到现在，跨了 {daysSince} 天。
            {avgInterval > 0 && ` 手上这些平均每 ${avgInterval} 天见一次面。`}
          </p>
        )}

        <p className="panel-note">每一格是一天。空着不代表失败，只说明那天没打开。</p>
      </div>

      <div className="panel">
        <h2 className="panel-title">外观</h2>
        <div className="segmented">
          {THEMES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`segmented-item ${theme === item.value ? 'is-active' : ''}`}
              onClick={() => onTheme(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">快捷键</h2>
        <ul className="keys">
          <li>
            <kbd>空格</kbd> 展开内容
          </li>
          <li>
            <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 忘了 / 有点模糊 / 记得
          </li>
          <li>
            <kbd>J</kbd> <kbd>K</kbd> 上下看下一条 / 上一条
          </li>
          <li>
            <kbd>N</kbd> 记一条
          </li>
          <li>
            <kbd>/</kbd> 或 <kbd>Ctrl</kbd> + <kbd>K</kbd> 跳到搜索框
          </li>
          <li>
            <kbd>Enter</kbd> 搜索结果里看第一条
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 在编辑框里保存
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>S</kbd> 在编辑框里保存
          </li>
          <li>
            <kbd>Shift</kbd> + <kbd>Tab</kbd> 退一级缩进
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>P</kbd> 打印（展开着就只打那一条）
          </li>
          <li>
            <kbd>Esc</kbd> 关掉编辑框 / 清空搜索 / 退出设置
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2 className="panel-title">数据</h2>
        <p className="panel-desc">
          导出是一个普通 JSON，任何编辑器都能打开。换设备、换浏览器、哪天不想用了，都能把东西带走。
        </p>
        {usage && <p className="panel-note">这台设备上用了 {usage}（浏览器一般给几百 MB）。</p>}
        {deletedCount > 0 && (
          <p className="panel-note">
            有 {deletedCount} 条删掉的笔记还留着（8 秒撤销过了就看不见了），
            <button type="button" className="link" onClick={() => void restoreDeletedNotes()}>
              全都找回来
            </button>
          </p>
        )}
        <div className="panel-actions">
          <button type="button" className="btn btn-ghost" onClick={doExport}>
            导出全部
          </button>
          <button type="button" className="btn btn-ghost" onClick={doExportMarkdown}>
            导出 Markdown
          </button>
          <button type="button" className="btn btn-ghost" onClick={doExportHtml}>
            导出 HTML
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            从 JSON 导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void doImport(file);
              event.target.value = '';
            }}
          />
        </div>

        <p className="panel-desc panel-desc-gap">
          已有的笔记文件可以直接搬进来。文件里如果有 <code className="icode">## </code> 分节，
          会按节拆成多条；没有就整个文件当一条。内容一样的会自动跳过，重复导入不会翻倍。
        </p>
        <div className="panel-actions">
          <button type="button" className="btn btn-ghost" onClick={() => mdRef.current?.click()}>
            导入 Markdown（可多选）
          </button>
          <input
            ref={mdRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            multiple
            hidden
            onChange={(event) => {
              const list = event.target.files;
              if (list && list.length > 0) void doImportMarkdown(list);
              event.target.value = '';
            }}
          />
        </div>

        <p className="panel-desc panel-desc-gap">
          清空只影响这台设备。登录状态下清空后会立刻从服务器把笔记拉回来 —— 想把云端一起清掉，
          得先登出再清。
        </p>
        <div className="panel-actions">
          <button
            type="button"
            className={`btn btn-ghost ${confirmWipe ? 'btn-wipe-confirm' : ''}`}
            onClick={() => {
              if (!confirmWipe) {
                setConfirmWipe(true);
                window.setTimeout(() => setConfirmWipe(false), 6000);
                return;
              }
              setConfirmWipe(false);
              void wipeLocal();
            }}
          >
            {confirmWipe ? '再点一次，确认清空' : '清空这台设备的笔记'}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">关于</h2>
        <p className="panel-note">
          目前手上有 {visible} 条笔记。数据格式是普通 JSON，随时能导出带走。
        </p>
        <p className="panel-note">
          iPhone：
          <a href="./nicenotes.mobileconfig">用描述文件加主屏</a>
          ——装完主屏直接出现图标，全屏打开，不用手动「分享 → 添加到主屏幕」。
        </p>
        <p className="panel-note">
          NiceNotes v{__APP_VERSION__} · MIT ·{' '}
          <a href="https://github.com/HiwwHi/nicenotes" target="_blank" rel="noreferrer">
            源码
          </a>
        </p>
      </div>
    </section>
  );
}
