import { useState } from 'react';
import { hasBackend } from '../lib/api';
import { pastLabel } from '../lib/date';
import type { Theme } from '../lib/theme';
import { signIn, signOut, syncNow, useApp } from '../store';

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
  const { account, syncing, lastSyncAt, syncError, notes } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              <span className="account-state">
                {syncing ? '同步中…' : lastSyncAt ? `${pastLabel(lastSyncAt)}同步过` : '还没同步'}
              </span>
            </div>
            {syncError && <p className="panel-error">{syncError}</p>}
            <div className="account-actions">
              <button type="button" className="btn btn-primary" disabled={syncing} onClick={() => void syncNow()}>
                {syncing ? '同步中' : '立即同步'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <form className="auth" onSubmit={submit}>
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
            <kbd>N</kbd> 记一条
          </li>
          <li>
            <kbd>/</kbd> 打开全部笔记并搜索
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2 className="panel-title">关于</h2>
        <p className="panel-desc">
          目前手上有 {visible} 条笔记。数据格式是普通 JSON，随时能导出带走。
        </p>
        <p className="panel-note">
          NiceNotes v2 · MIT ·{' '}
          <a href="https://github.com/" target="_blank" rel="noreferrer">
            源码
          </a>
        </p>
      </div>
    </section>
  );
}
