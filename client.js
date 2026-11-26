/**
 * Run monitor — Client half.
 *
 * A sidebar footer entry ("运行监控") opens a compact popover anchored beside the
 * sidebar (no full-screen scrim). All three states are listed at once, in the
 * order 待回复 / 已完成 / 执行中, and every row shows its workspace directory as a
 * leading badge before the conversation title. Clicking a row jumps to that
 * conversation. Data comes from this package's Host half over a read-only
 * route; colors come only from the host theme tokens so they follow light/dark.
 */
window.__ModuleLoader__.load({
  id: 'dsh-run-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-run-monitor'
    const ENDPOINT = 'run-monitor/api/list'
    const REFRESH_MS = 4000
    const IDLE_REFRESH_MS = 20000
    /** Fallback poll periods while the change stream is connected: it pushes, so polling is only a safety net. */
    const LIVE_REFRESH_MS = 15000
    const LIVE_IDLE_REFRESH_MS = 60000
    /** Coalesces the burst of pings one agent step produces into a single refetch. */
    const STREAM_DEBOUNCE_MS = 120
    const STREAM_ENDPOINT = 'run-monitor/api/stream'
    const PANEL_WIDTH = 340
    const SEEN_KEY = 'dsh-run-monitor:seen-completed'
    const SEEN_LIMIT = 300
    const NOTIFY_KEY = 'dsh-run-monitor:notify'
    const NOTICE_MS = 3000
    const NOTICE_LIMIT = 3
    const PENDING_LIMIT = 8
    /** Long enough to alt-tab away after clicking a preview, like a real event. */
    const TEST_DELAY_MS = 6000
    /** No pointer or key activity for this long counts as "away" while the window is focused. */
    const AWAY_MS = 30000
    /** Sidebar bubble order: most urgent state first. */
    const BADGE_STATES = ['awaiting', 'running', 'completed']

    // The Host locale ids are "zh" and "en" (LOCALE_IDS in @deepseek-ai/dsh-client-locale);
    // a "zh-CN" dictionary is never looked up while the active locale is "zh".
    const TEXT = {
      zh: {
        nav: '运行监控',
        title: '运行监控',
        close: '关闭',
        refresh: '刷新',
        running: '执行中',
        awaiting: '待回复',
        completed: '已完成',
        noRunning: '没有正在执行的任务',
        noAwaiting: '没有等待回复的任务',
        noCompleted: '没有未读的已完成任务',
        childRunning: '子任务运行中',
        loading: '加载中…',
        error: '读取任务列表失败：{error}',
        retry: '重试',
        hint: '点击任务跳转到对话',
        noticeAwaiting: '等待你的回复',
        noticeCompleted: '任务已完成',
        noticeDismiss: '忽略',
        noticeJump: '点击跳转到对话',
        inApp: '内部通知',
        system: '外部通知',
        test: '测试',
        testInAppTitle: '内部通知测试',
        testSystemTitle: '外部通知测试',
        noticePermissionDenied: '系统通知未获授权',
        inAppHint: '在页面内以气泡提醒',
        systemHint: '窗口不在前台时使用系统通知',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        dir: '目录',
      },
      en: {
        nav: 'Run monitor',
        title: 'Run monitor',
        close: 'Close',
        refresh: 'Refresh',
        running: 'Running',
        awaiting: 'Awaiting reply',
        completed: 'Completed',
        noRunning: 'No task is running right now',
        noAwaiting: 'No task is waiting for a reply',
        noCompleted: 'No unread finished task',
        childRunning: 'Child task running',
        loading: 'Loading…',
        error: 'Could not read the task list: {error}',
        retry: 'Retry',
        hint: 'Click a task to open its conversation',
        noticeAwaiting: 'Waiting for your reply',
        noticeCompleted: 'Task finished',
        noticeDismiss: 'Dismiss',
        noticeJump: 'Click to open the conversation',
        inApp: 'In-app',
        system: 'System',
        test: 'Test',
        testInAppTitle: 'In-app notification test',
        testSystemTitle: 'System notification test',
        noticePermissionDenied: 'OS notifications are not permitted',
        inAppHint: 'Show a bubble inside this page',
        systemHint: 'Use an OS notification while the window is in the background',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        dir: 'Directory',
      },
    }

    // Only --dsw-alias-* tokens: they carry both light and dark values, so the
    // popover text and surfaces follow the active appearance.
    const CSS = [
      '.dsh-run-monitor-launcher{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;position:relative;text-align:left}',
      '.dsh-run-monitor-launcher:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-launcher.is-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-launcher.is-rail{justify-content:center;padding:4px}',
      '.dsh-run-monitor-launcher__icon{display:inline-flex;flex:none;color:inherit}',
      '.dsh-run-monitor-launcher__label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
      '.dsh-run-monitor-launcher__badges{display:flex;align-items:center;gap:3px;flex:none}',
      '.dsh-run-monitor-launcher.is-rail .dsh-run-monitor-launcher__badges{position:absolute;top:1px;right:2px}',
      // Filled pills, but the fill is deepened so the white count keeps real
      // contrast against the bright state colours in both appearances.
      '.dsh-run-monitor-launcher__badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-label-secondary);color:#fff;font-size:10px;font-weight:600;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}',
      '.dsh-run-monitor-launcher__badge[data-state="awaiting"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 74%, #17202e)}',
      '.dsh-run-monitor-launcher__badge[data-state="running"]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 74%, #17202e)}',
      '.dsh-run-monitor-launcher__badge[data-state="completed"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, #17202e)}',
      '.dsh-run-monitor-panel{position:fixed;z-index:60;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 14px 34px rgba(0,0,0,.22);pointer-events:auto;outline:none}',
      '.dsh-run-monitor-head{display:flex;align-items:center;gap:6px;padding:9px 10px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-run-monitor-head h2{margin:0;flex:1 1 auto;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-icon-button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsh-run-monitor-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-settings{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:7px 12px 8px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-run-monitor-setting{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-run-monitor-switch{position:relative;flex:none;width:26px;height:15px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .12s ease,border-color .12s ease}',
      '.dsh-run-monitor-switch__knob{position:absolute;top:1px;left:1px;width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .12s ease,background .12s ease}',
      '.dsh-run-monitor-switch.is-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}',
      '.dsh-run-monitor-switch.is-on .dsh-run-monitor-switch__knob{left:12px;background:var(--dsw-alias-bg-base)}',
      '.dsh-run-monitor-test{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:15px;cursor:pointer}',
      '.dsh-run-monitor-test:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-body{flex:1 1 auto;overflow:auto;padding:2px 10px 8px}',
      // At-a-glance counters: one chip per state, doubling as that section's toggle.
      '.dsh-run-monitor-summary{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 2px}',
      '.dsh-run-monitor-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:16px;cursor:pointer}',
      '.dsh-run-monitor-chip:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-run-monitor-chip[aria-expanded="false"]{opacity:.55}',
      '.dsh-run-monitor-chip__dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}',
      '.dsh-run-monitor-chip[data-state="awaiting"] .dsh-run-monitor-chip__dot{background:var(--dsw-alias-state-error-primary)}',
      '.dsh-run-monitor-chip[data-state="running"] .dsh-run-monitor-chip__dot{background:var(--dsw-alias-state-warn-primary)}',
      '.dsh-run-monitor-chip[data-state="completed"] .dsh-run-monitor-chip__dot{background:var(--dsw-alias-brand-primary)}',
      '.dsh-run-monitor-chip__count{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      // Each state is its own card: the head is the control, the rows live inside it.
      '.dsh-run-monitor-section{margin:0 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);overflow:hidden}',
      '.dsh-run-monitor-section[data-state="awaiting"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l1));box-shadow:inset 3px 0 0 var(--dsw-alias-state-error-primary)}',
      '.dsh-run-monitor-section[data-state="running"]{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-state-warn-primary) 60%,transparent)}',
      '.dsh-run-monitor-section__head{display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:16px;text-align:left;cursor:pointer}',
      '.dsh-run-monitor-section.is-open .dsh-run-monitor-section__head{border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-run-monitor-section__head:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-run-monitor-section__label{font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-section__chevron{display:inline-block;flex:none;font-size:9px;opacity:.6}',
      '.dsh-run-monitor-section[data-collapsed="true"] .dsh-run-monitor-section__chevron{transform:rotate(-90deg)}',
      '.dsh-run-monitor-section__dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dsh-run-monitor-section[data-state="awaiting"] .dsh-run-monitor-section__dot{background:var(--dsw-alias-state-error-primary)}',
      '.dsh-run-monitor-section[data-state="completed"] .dsh-run-monitor-section__dot{background:var(--dsw-alias-brand-primary)}',
      '.dsh-run-monitor-section[data-state="running"] .dsh-run-monitor-section__dot{background:var(--dsw-alias-state-warn-primary)}',
      '.dsh-run-monitor-section__count{margin-left:auto;min-width:18px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:10.5px;font-variant-numeric:tabular-nums;text-align:center}',
      // Rows live inside their card, so ownership is structural rather than indentation.
      '.dsh-run-monitor-section ul{margin:0;padding:4px 6px 6px;list-style:none}',
      '.dsh-run-monitor-divider{height:1px;margin:10px 2px 12px;background:var(--dsw-alias-border-l1)}',
      '.dsh-run-monitor-row{display:flex;align-items:center;gap:6px;width:100%;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;min-width:0}',
      '.dsh-run-monitor-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-run-monitor-row__body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.dsh-run-monitor-row__line{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-run-monitor-dir{flex:none;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-size:10px;line-height:14px}',
      '.dsh-run-monitor-row__title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-row__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.dsh-run-monitor-empty{padding:8px 10px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-run-monitor-footer{padding:6px 12px 8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.68}',
      '.dsh-run-monitor-error{padding:6px 10px;font-size:11.5px;color:var(--dsw-alias-state-error-primary)}',
      '.dsh-run-monitor-error button{margin-left:6px;border:0;background:transparent;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}',
      '.dsh-run-monitor-notices{position:fixed;z-index:70;display:flex;flex-direction:column-reverse;gap:10px;pointer-events:none}',
      '.dsh-run-monitor-notice{display:flex;align-items:flex-start;gap:10px;width:100%;padding:13px 12px 13px 14px;border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 18px 46px rgba(0,0,0,.34);pointer-events:auto;text-align:left;font:inherit;cursor:pointer}',
      '.dsh-run-monitor-notice[data-state="awaiting"]{border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-overlay))}',
      '.dsh-run-monitor-notice[data-state="completed"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-overlay))}',
      '.dsh-run-monitor-notice:hover{filter:brightness(1.05)}',
      '.dsh-run-monitor-notice__dot{flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}',
      '.dsh-run-monitor-notice[data-state="awaiting"] .dsh-run-monitor-notice__dot{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary) 26%,transparent)}',
      '.dsh-run-monitor-notice[data-state="completed"] .dsh-run-monitor-notice__dot{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent)}',
      '.dsh-run-monitor-notice__body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dsh-run-monitor-notice__state{font-size:11.5px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-secondary)}',
      '.dsh-run-monitor-notice[data-state="awaiting"] .dsh-run-monitor-notice__state{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-run-monitor-notice[data-state="completed"] .dsh-run-monitor-notice__state{color:var(--dsw-alias-brand-primary)}',
      '.dsh-run-monitor-notice__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.dsh-run-monitor-notice__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}',
      '.dsh-run-monitor-notice__close{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;line-height:20px;cursor:pointer}',
      '.dsh-run-monitor-notice__close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
    ].join('')

    const GROUPS = [
      { state: 'awaiting', labelKey: 'awaiting', emptyKey: 'noAwaiting' },
      { state: 'running', labelKey: 'running', emptyKey: 'noRunning' },
      // Finished work sits last, behind its own divider: it is a log, not a
      // to-do, and should never compete with the two live states.
      { state: 'completed', labelKey: 'completed', emptyKey: 'noCompleted' },
    ]

    /**
     * Completed tasks stay listed until the user opens them from this popover:
     * the pair (session, finish time) is remembered, so a later turn of the same
     * conversation surfaces again as a fresh unread completion.
     */
    const seen = loadSeen()

    function seenKeyOf(task) {
      return task.id + '@' + (task.finishedAt || task.updatedAt || 0)
    }

    function loadSeen() {
      try {
        const raw = window.localStorage.getItem(SEEN_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [])
      } catch {
        return new Set()
      }
    }

    function markSeen(task) {
      const key = seenKeyOf(task)
      if (seen.has(key)) return
      seen.add(key)
      const keys = Array.from(seen)
      try {
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(Math.max(0, keys.length - SEEN_LIMIT))))
      } catch (error) {
        console.error('[run-monitor] could not persist seen tasks:', error)
      }
    }

    /**
     * Two independent channels: the in-app bubble and the OS notification.
     * Both start switched on, and the choice survives reloads.
     */
    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(NOTIFY_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return {
          inApp: !parsed || parsed.inApp !== false,
          system: !parsed || parsed.system !== false,
        }
      } catch {
        return { inApp: true, system: true }
      }
    }

    function saveSettings(settings) {
      try {
        window.localStorage.setItem(NOTIFY_KEY, JSON.stringify(settings))
      } catch (error) {
        console.error('[run-monitor] could not persist notification settings:', error)
      }
    }

    function setSetting(name, value) {
      const settings = Object.assign({}, store.get().settings, { [name]: value })
      store.set({ settings })
      saveSettings(settings)
    }

    /**
     * Prefer the shell's status projection; fall back to our own click history
     * when the projection does not carry this session.
     */
    function isUnreadCompletion(task, statusMap, seenKeys) {
      if (statusMap && typeof statusMap.get === 'function') {
        const status = statusMap.get(task.id)
        if (status && typeof status.completionUnread === 'boolean') return status.completionUnread
      }
      return !seenKeys.has(seenKeyOf(task))
    }

    /** Notify on a transition into 待回复 / 已完成; never on the first sighting. */
    function trackStates(tasks) {
      const alive = new Set()
      for (const task of tasks) {
        if (!task || typeof task.id !== 'string') continue
        alive.add(task.id)
        const previous = lastStates.get(task.id)
        lastStates.set(task.id, task.state)
        if (previous === undefined || previous === task.state) continue
        if (task.state === 'awaiting' || task.state === 'completed') announce(task)
      }
      for (const id of Array.from(lastStates.keys())) {
        if (!alive.has(id)) lastStates.delete(id)
      }
    }

    function announce(task) {
      const settings = store.get().settings || { inApp: true, system: true }
      const focused =
        typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
      const away = isAway(focused)
      // In-app while the window has focus, the OS notification while it does not.
      // A channel that is switched off hands over to the other one, and two
      // switched-off channels stay silent.
      if (!away) {
        if (settings.inApp) {
          pushNotice(task)
          return
        }
        if (settings.system) systemNotify(task)
        return
      }
      if (settings.system) {
        systemNotify(task)
        queuePending(task)
        return
      }
      if (settings.inApp) pushNotice(task)
    }

    /**
     * "Away" covers the window being unfocused or hidden, and also sitting in
     * front of the screen with no input for a while — a completion seen only as
     * a five-second bubble is easy to miss, so that case gets an OS notification.
     */
    function isAway(focused) {
      if (!focused) return true
      return Date.now() - lastInteraction > AWAY_MS
    }

    function noticeKeyOf(task) {
      return task.id + '@' + task.state + '@' + (task.finishedAt || task.updatedAt || 0)
    }

    function noticeOf(task) {
      return {
        key: noticeKeyOf(task),
        id: task.id,
        test: task.test === true,
        state: task.state,
        title: task.title,
        group: dirLabelOf(task),
        question: task.state === 'awaiting' && task.pending ? task.pending.question || '' : '',
        finishedAt: task.finishedAt || 0,
        updatedAt: task.updatedAt || 0,
      }
    }

    function pushNotice(task) {
      showNotice(noticeOf(task))
    }

    function showNotice(notice) {
      // The bubble pops out at the sidebar entry that owns this monitor.
      const anchor = rectOf(launcherElement)
      store.set((state) => ({
        noticeAnchor: anchor || state.noticeAnchor,
        notices: state.notices.filter((item) => item.key !== notice.key).concat([notice]).slice(-NOTICE_LIMIT),
      }))
      const previous = noticeTimers.get(notice.key)
      if (previous) window.clearTimeout(previous)
      noticeTimers.set(
        notice.key,
        window.setTimeout(() => dismissNotice(notice.key), NOTICE_MS),
      )
    }

    /**
     * Notifications that were handed to the OS while the page was hidden are
     * also kept here: if Windows swallows the toast (focus assist, notification
     * settings), coming back to the page still shows the bubble.
     */
    function queuePending(task) {
      const notice = noticeOf(task)
      store.set((state) => ({
        pending: state.pending.filter((item) => item.key !== notice.key).concat([notice]).slice(-PENDING_LIMIT),
      }))
    }

    function flushPending() {
      const pending = store.get().pending
      if (!pending.length) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      store.set({ pending: [] })
      for (const notice of pending) showNotice(notice)
    }

    function dismissNotice(key) {
      const timer = noticeTimers.get(key)
      if (timer) window.clearTimeout(timer)
      noticeTimers.delete(key)
      store.set((state) => ({ notices: state.notices.filter((item) => item.key !== key) }))
    }

    /** No OS notification (or refused): use the in-app bubble when it is on. */
    function fallbackNotice(task) {
      const settings = store.get().settings || {}
      if (settings.inApp !== false) pushNotice(task)
    }

    function openFromNotice(notice) {
      if (notice.test) {
        dismissNotice(notice.key)
        return
      }
      const opened = typeof openTarget === 'function' ? openTarget(notice.id) : false
      if (!opened) return
      if (notice.state === 'completed') markSeen(notice)
      dismissNotice(notice.key)
    }

    /** A throw-away task used only to render a notification preview. */
    function testTask(title) {
      const now = Date.now()
      return {
        // Session-shaped on purpose: the preview must exercise the same tag
        // derivation a real session does, or it cannot catch tag-length bugs.
        id: 'session-00000000-0000-4000-8000-000000000000',
        test: true,
        state: 'completed',
        title,
        group: { label: '' },
        pending: null,
        finishedAt: now,
        updatedAt: now,
      }
    }

    function pushTestNotice(title) {
      pushNotice(testTask(title))
    }

    /** The switches' Test buttons: fire one notification through that channel only. */
    function testNotice(kind) {
      if (kind === 'system') {
        const blocked = typeof Notification === 'undefined' || Notification.permission === 'denied'
        if (blocked) {
          pushTestNotice(t('noticePermissionDenied'))
          requestNotifyPermission()
          return
        }
        if (Notification.permission === 'default') requestNotifyPermission()
        // Deferred on purpose: long enough to alt-tab away after clicking, so
        // the preview runs in exactly the state a real completion runs in.
        window.setTimeout(() => {
          showSystemNotification(testTask(t('testSystemTitle')))
        }, TEST_DELAY_MS)
        return
      }
      pushTestNotice(t('testInAppTitle'))
    }

    /** Call from a user gesture: browsers only grant the permission there. */
    function requestNotifyPermission() {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
        const request = Notification.requestPermission()
        if (request && typeof request.then === 'function') {
          request.catch(() => {})
        }
      } catch (error) {
        console.error('[run-monitor] notification permission failed:', error)
      }
    }

    function systemNotify(task) {
      try {
        if (typeof Notification === 'undefined') {
          fallbackNotice(task)
          return
        }
        if (Notification.permission === 'granted') {
          showSystemNotification(task)
          return
        }
        if (Notification.permission === 'denied') {
          fallbackNotice(task)
          return
        }
        const request = Notification.requestPermission()
        if (request && typeof request.then === 'function') {
          request
            .then((permission) => {
              if (permission === 'granted') showSystemNotification(task)
              else fallbackNotice(task)
            })
            .catch(() => fallbackNotice(task))
          return
        }
        fallbackNotice(task)
      } catch (error) {
        console.error('[run-monitor] system notification failed:', error)
        fallbackNotice(task)
      }
    }

    /**
     * Windows rejects a toast whose tag exceeds 64 characters, and it rejects
     * it silently — the toast simply never appears. A session id alone is 43
     * characters, so the tag carries a hash of the id plus the finish time.
     */
    function notificationTag(task) {
      const seed = String(task.id || 'test')
      let hash = 2166136261
      for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      const stamp = Math.abs(Number(task.finishedAt || Date.now())) % 100000000000
      return 'dsh-run-monitor:' + (hash >>> 0).toString(36) + ':' + stamp.toString(36)
    }

    function showSystemNotification(task) {
      // The state leads the title so a toast reads as 【已完成】<task> at a glance;
      // the body carries the detail instead of repeating it.
      const stateLabel = t(task.state === 'awaiting' ? 'awaiting' : 'completed')
      const parts = []
      if (dirLabelOf(task)) parts.push(dirLabelOf(task))
      if (task.state === 'awaiting' && task.pending && task.pending.question) {
        parts.push(task.pending.question)
      }
      const tag = notificationTag(task)
      const notification = new Notification(`【${stateLabel}】${task.title || t('title')}`, {
        tag,
        body: parts.join(' · '),
      })
      notification.onclick = () => {
        if (task.test) {
          try {
            notification.close()
          } catch {
            /* already closed */
          }
          return
        }
        try {
          window.focus()
        } catch {
          /* focus may be refused */
        }
        const opened = typeof openTarget === 'function' ? openTarget(task.id) : false
        if (opened && task.state === 'completed') markSeen(task)
        try {
          notification.close()
        } catch {
          /* already closed */
        }
      }
    }

    const store = createStore({
      open: false,
      anchor: null,
      noticeAnchor: null,
      tasks: [],
      counts: null,
      notices: [],
      pending: [],
      settings: loadSettings(),
      loading: false,
      error: '',
      updatedAt: 0,
    })

    let translate = (key) => (key in TEXT.zh ? TEXT.zh[key] : key)
    let refreshing = false
    let refreshQueued = false
    let lastFetchAt = 0
    let live = false
    let stream = null
    let streamTimer = null
    let launcherElement = null
    let panelElement = null
    let openTarget = null
    let lastInteraction = Date.now()
    /** Last known state per session, so a transition (not a snapshot) notifies. */
    const lastStates = new Map()
    const noticeTimers = new Map()

    function t(key, vars) {
      const text = translate(key)
      if (vars === undefined) return text
      return Object.keys(vars).reduce(
        (result, name) => result.split('{' + name + '}').join(String(vars[name])),
        text,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        installStyles(ctx)
        installLocale(ctx)
        installInteraction(ctx)

        const openSession = (sessionId) => {
          try {
            const workspace = ctx.get('uiWorkspace')
            if (workspace && typeof workspace.openSession === 'function') {
              workspace.openSession(sessionId)
              return true
            }
          } catch (error) {
            console.error('[run-monitor] openSession failed:', error)
          }
          return false
        }
        openTarget = openSession

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'dsh-run-monitor', order: 22 },
            (props) => h(Launcher, { wide: props?.wide === true }),
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-run-monitor', order: 55 },
            (props) => h(Monitor, { openSession, useSessionStatus: props?.useSessionStatus }),
          ),
        )

        // In-app notifications: reaching 待回复 / 已完成 while the page has focus.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-run-monitor-notice', order: 56 },
            () => h(Notices, null),
          ),
        )

        // Keeps the sidebar badge fresh while the popover is closed.
        ctx.effect(() => {
          const timer = window.setInterval(() => {
            if (store.get().open) return
            const period = live ? LIVE_IDLE_REFRESH_MS : IDLE_REFRESH_MS
            if (Date.now() - lastFetchAt >= period) void refresh()
          }, 2000)
          void refresh()
          return () => window.clearInterval(timer)
        }, 'dsh-run-monitor: idle refresh')

        // The Host pushes "the session log moved" over SSE, so state changes land
        // in the badge and the popover within a debounce instead of a poll period.
        ctx.effect(() => {
          installStream(ctx)
          return () => stopStream()
        }, 'dsh-run-monitor: change stream')

        ctx.effect(() => () => close(), 'dsh-run-monitor: close on dispose')
      },
    }

    function installStyles(ctx) {
      try {
        const previous = document.querySelector('style[data-plugin-css="dsh-run-monitor"]')
        if (previous) previous.remove()
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-run-monitor'
        style.dataset.pluginCss = 'dsh-run-monitor'
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-run-monitor: styles')
      } catch (error) {
        console.error('[run-monitor] styles failed:', error)
      }
    }

    function installLocale(ctx) {
      if (typeof ctx.inject !== 'function') return
      try {
        ctx.inject(['locale'], (scoped) => {
          const locale = scoped?.locale ?? scoped?.get?.('locale')
          if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
          try {
            locale.register(NS, 'zh', TEXT.zh)
            locale.register(NS, 'en', TEXT.en)
            const bound = locale.bind(NS)
            if (typeof bound === 'function') {
              translate = (key) => {
                const value = bound(key)
                return typeof value === 'string' && value !== key ? value : (key in TEXT.zh ? TEXT.zh[key] : key)
              }
            }
            if (typeof locale.subscribe === 'function') locale.subscribe(() => store.set({}))
          } catch (error) {
            console.error('[run-monitor] locale registration failed:', error)
          }
        })
      } catch (error) {
        console.error('[run-monitor] locale injection failed:', error)
      }
    }

    /** Tracks the last real user gesture, so "still at the screen" is measurable. */
    function installInteraction(ctx) {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
      const mark = () => {
        lastInteraction = Date.now()
      }
      const names = ['pointerdown', 'keydown', 'wheel']
      ctx.effect(() => {
        for (const name of names) document.addEventListener(name, mark, true)
        // Coming back to the page replays whatever the OS toast did not show.
        const back = () => {
          if (document.visibilityState === 'visible') flushPending()
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', flushPending)
        }
        document.addEventListener('visibilitychange', back)
        return () => {
          for (const name of names) document.removeEventListener(name, mark, true)
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', flushPending)
          }
          document.removeEventListener('visibilitychange', back)
        }
      }, 'dsh-run-monitor: interaction tracking')
    }

    /** Subscribes to the Host change feed; EventSource reconnects on its own. */
    function installStream(ctx) {
      if (typeof EventSource !== 'function') return
      try {
        const source = new EventSource(routeUrl(STREAM_ENDPOINT))
        stream = source
        source.onopen = () => {
          live = true
          // A reconnect may have missed changes while the socket was down.
          scheduleRefresh()
        }
        source.onerror = () => {
          live = false
        }
        source.onmessage = () => {
          live = true
          scheduleRefresh()
        }
      } catch (error) {
        console.error('[run-monitor] change stream failed:', error)
      }
    }

    function stopStream() {
      if (streamTimer !== null) {
        window.clearTimeout(streamTimer)
        streamTimer = null
      }
      if (stream !== null && typeof stream.close === 'function') {
        try {
          stream.close()
        } catch (error) {
          console.error('[run-monitor] change stream close failed:', error)
        }
      }
      stream = null
      live = false
    }

    function scheduleRefresh() {
      if (streamTimer !== null) return
      streamTimer = window.setTimeout(() => {
        streamTimer = null
        void refresh()
      }, STREAM_DEBOUNCE_MS)
    }

    function rectOf(element) {
      if (!element || typeof element.getBoundingClientRect !== 'function') return null
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }

    function toggle() {
      if (store.get().open) {
        close()
        return
      }
      // A click is a user gesture, which is when a browser lets us ask.
      requestNotifyPermission()
      flushPending()
      const anchor = rectOf(launcherElement)
      store.set({ open: true, anchor })
      void refresh()
    }

    function close() {
      if (store.get().open) store.set({ open: false })
    }

    function refresh() {
      if (refreshing) {
        // A push that lands mid-request must not be dropped: refetch once, after.
        refreshQueued = true
        return Promise.resolve()
      }
      refreshing = true
      if (store.get().tasks.length === 0) store.set({ loading: true })
      return fetch(url(), { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then((body) => {
          if (!body || body.ok !== true || !Array.isArray(body.tasks)) throw new Error('invalid payload')
          lastFetchAt = Date.now()
          trackStates(body.tasks)
          store.set({
            tasks: body.tasks,
            loading: false,
            error: '',
            updatedAt: typeof body.now === 'number' ? body.now : Date.now(),
          })
        })
        .catch((error) => {
          store.set({ loading: false, error: String(error && error.message ? error.message : error) })
        })
        .then(() => {
          refreshing = false
          if (refreshQueued) {
            refreshQueued = false
            void refresh()
          }
        })
    }

    function url() {
      return routeUrl(ENDPOINT)
    }

    function routeUrl(path) {
      const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : String(window.location.href)
      const resolved = new URL(base)
      resolved.search = ''
      resolved.hash = ''
      if (!resolved.pathname.endsWith('/')) resolved.pathname += '/'
      return new URL(path, resolved.href).href
    }

    /**
     * In-app counterpart of the system notification: shown when the page has
     * focus, so a finished task is announced without stealing the window.
     */
    function Notices() {
      const state = useStore(store)
      const notices = Array.isArray(state.notices) ? state.notices : []
      if (notices.length === 0) return null
      // Anchored above the 运行监控 entry, so the bubble reads as a callout from
      // that row rather than a floating toast in a corner of the page.
      const anchor = state.noticeAnchor
      const width = Math.min(360, Math.max(240, window.innerWidth - 24))
      const left = anchor
        ? Math.min(Math.max(8, anchor.right + 8), Math.max(8, window.innerWidth - width - 8))
        : Math.max(8, window.innerWidth - width - 16)
      const bottom = anchor
        ? Math.min(Math.max(8, window.innerHeight - anchor.top - 16), Math.max(8, window.innerHeight - 40))
        : 16
      return h(
        'div',
        {
          className: 'dsh-run-monitor-notices',
          role: 'status',
          'aria-live': 'polite',
          style: { left: left + 'px', bottom: bottom + 'px', width: width + 'px' },
        },
        notices.map((notice) =>
          h(
            'div',
            { className: 'dsh-run-monitor-notice', 'data-state': notice.state, key: notice.key },
            h('span', { className: 'dsh-run-monitor-notice__dot', 'aria-hidden': 'true' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-run-monitor-notice__body',
                title: t('noticeJump'),
                onClick: () => openFromNotice(notice),
              },
              h(
                'span',
                { className: 'dsh-run-monitor-notice__state' },
                t(notice.state === 'awaiting' ? 'noticeAwaiting' : 'noticeCompleted'),
              ),
              h('span', { className: 'dsh-run-monitor-notice__title' }, notice.title || notice.id),
              notice.question
                ? h('span', { className: 'dsh-run-monitor-notice__sub' }, notice.question)
                : notice.group
                  ? h('span', { className: 'dsh-run-monitor-notice__sub' }, notice.group)
                  : null,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-run-monitor-notice__close',
                title: t('noticeDismiss'),
                'aria-label': t('noticeDismiss'),
                onClick: () => dismissNotice(notice.key),
              },
              '×',
            ),
          ),
        ),
      )
    }

    function Launcher(props) {
      const state = useStore(store)
      const wide = props !== null && typeof props === 'object' && props.wide === true
      // No status projection here: `sidebar.footer.action` renders before the
      // projection provider settles, and reading it there took the whole
      // sidebar down. Bubbles fall back to the click history instead.
      try {
        return renderLauncher(state, wide)
      } catch (error) {
        console.error('[run-monitor] launcher render failed:', error)
        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-run-monitor-launcher is-fallback',
            title: '运行监控',
            onClick: () => toggle(),
          },
          '运行监控',
        )
      }
    }

    function renderLauncher(state, wide) {
      // Counts are published by the popover (the only place that can read the
      // status projection), so the bubbles always agree with the sections.
      const counts = state.counts || countsOf(state.tasks, null)
      const label = t('nav')
      const children = [
        h(
          'span',
          { className: 'dsh-run-monitor-launcher__icon', 'aria-hidden': 'true', key: 'icon' },
          h(
            'svg',
            {
              viewBox: '0 0 16 16',
              width: wide ? 16 : 18,
              height: wide ? 16 : 18,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              style: { display: 'block' },
            },
            h('rect', { x: 1.8, y: 3, width: 12.4, height: 10, rx: 2 }),
            h('path', { d: 'M4 8.1h1.9l1.1-2 1.5 3.8 1-1.8H12' }),
          ),
        ),
      ]
      if (wide) {
        children.push(h('span', { className: 'dsh-run-monitor-launcher__label', key: 'label' }, label))
      }
      const badges = badgeNodes(counts, wide)
      if (badges.length > 0) {
        children.push(h('span', { className: 'dsh-run-monitor-launcher__badges', key: 'badges' }, badges))
      }
      return h(
        'button',
        {
          type: 'button',
          className:
            'dsh-run-monitor-launcher' + (wide ? '' : ' is-rail') + (state.open ? ' is-active' : ''),
          ref: (element) => {
            launcherElement = element
          },
          'aria-label': label,
          'aria-haspopup': 'dialog',
          'aria-expanded': state.open ? 'true' : 'false',
          title: label,
          onClick: () => toggle(),
        },
        children,
      )
    }

    function Monitor(props) {
      const state = useStore(store)
      // Collapsing lives here (not in the store) so a reopened popover starts
      // with every state expanded.
      const [collapsed, setCollapsed] = React.useState({})
      const toggleSection = (name) =>
        setCollapsed((previous) => ({ ...previous, [name]: previous[name] !== true }))
      // Host-shipped per-session status projection: `completionUnread` is the
      // shell's own "finished, not opened yet" flag, so 已完成 can follow the
      // conversation the user actually looked at instead of our click history.
      const statusMap =
        typeof props.useSessionStatus === 'function' ? props.useSessionStatus((value) => value) : null
      const completedUnread = (task) => isUnreadCompletion(task, statusMap, seen)
      const counts = countsOf(state.tasks, statusMap)

      // The sidebar bubbles mount before the projection settles, so they render
      // whatever this popover publishes — same predicate as the sections.
      React.useEffect(() => {
        const previous = store.get().counts
        if (
          previous &&
          previous.running === counts.running &&
          previous.awaiting === counts.awaiting &&
          previous.completed === counts.completed
        ) {
          return
        }
        store.set({ counts })
      }, [state.tasks, statusMap])

      React.useEffect(() => {
        if (!state.open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (panelElement && target instanceof Node && panelElement.contains(target)) return
          if (launcherElement && target instanceof Node && launcherElement.contains(target)) return
          close()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }
        const onResize = () => {
          const anchor = rectOf(launcherElement)
          if (anchor) store.set({ anchor })
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onResize)
        const timer = window.setInterval(() => {
          const period = live ? LIVE_REFRESH_MS : REFRESH_MS
          if (Date.now() - lastFetchAt >= period) void refresh()
        }, 1000)
        if (panelElement && typeof panelElement.focus === 'function') panelElement.focus()
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onResize)
          window.clearInterval(timer)
        }
      }, [state.open])

      const anchor = state.anchor
      if (!state.open || !anchor) return null

      const width = Math.min(PANEL_WIDTH, Math.max(240, window.innerWidth - 24))
      const left = Math.min(Math.max(8, anchor.right + 8), Math.max(8, window.innerWidth - width - 8))
      const bottom = Math.max(8, window.innerHeight - anchor.bottom)
      const maxHeight = Math.max(220, Math.min(560, anchor.bottom - 16))

      const body = []
      body.push(
        h(
          'header',
          { className: 'dsh-run-monitor-head', key: 'head' },
          h('h2', null, t('title')),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-run-monitor-icon-button',
              title: t('refresh'),
              'aria-label': t('refresh'),
              onClick: () => {
                void refresh()
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 14,
                height: 14,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }),
              h('path', { d: 'M13 2.6V5.2h-2.6' }),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-run-monitor-icon-button',
              title: t('close'),
              'aria-label': t('close'),
              onClick: () => close(),
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 14,
                height: 14,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M4 4l8 8' }),
              h('path', { d: 'M12 4l-8 8' }),
            ),
          ),
        ),
      )

      body.push(summaryBar(counts, collapsed, toggleSection))

      const sections = []
      if (state.error !== '') {
        sections.push(
          h(
            'div',
            { className: 'dsh-run-monitor-error', key: 'error' },
            t('error', { error: state.error }),
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  void refresh()
                },
              },
              t('retry'),
            ),
          ),
        )
      }

      if (state.loading && state.tasks.length === 0) {
        sections.push(h('div', { className: 'dsh-run-monitor-empty', key: 'loading' }, t('loading')))
      } else {
        for (const group of GROUPS) {
          if (group.state === 'completed') {
            sections.push(h('div', { className: 'dsh-run-monitor-divider', key: 'divider', role: 'separator' }))
          }
          sections.push(sectionOf(group, state.tasks, props, completedUnread, collapsed, toggleSection))
        }
      }

      body.push(h('div', { className: 'dsh-run-monitor-body', key: 'body' }, sections))
      body.push(
        h(
          'div',
          { className: 'dsh-run-monitor-settings', key: 'settings' },
          settingRow('inApp', 'inAppHint'),
          settingRow('system', 'systemHint'),
        ),
      )
      body.push(h('footer', { className: 'dsh-run-monitor-footer', key: 'footer' }, t('hint')))

      return h(
        'div',
        {
          className: 'dsh-run-monitor-panel',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': t('title'),
          tabIndex: -1,
          ref: (element) => {
            panelElement = element
          },
          style: { left: left + 'px', bottom: bottom + 'px', width: width + 'px', maxHeight: maxHeight + 'px' },
          onClick: (event) => event.stopPropagation(),
        },
        body,
      )
    }

    function settingRow(name, hintKey) {
      const settings = store.get().settings || {}
      const checked = settings[name] !== false
      return h(
        'div',
        { className: 'dsh-run-monitor-setting', key: name, title: t(hintKey) },
        h('span', null, t(name)),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': t(name),
            title: t(hintKey),
            className: 'dsh-run-monitor-switch' + (checked ? ' is-on' : ''),
            onClick: () => setSetting(name, !checked),
          },
          h('span', { className: 'dsh-run-monitor-switch__knob', 'aria-hidden': 'true' }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-run-monitor-test',
            title: t('test') + ' · ' + t(name),
            onClick: () => testNotice(name === 'system' ? 'system' : 'inApp'),
          },
          t('test'),
        ),
      )
    }

    // Counters first, one chip per state: the numbers are readable before any
    // row, and each chip also folds its section away.
    function summaryBar(counts, collapsed, onToggle) {
      return h(
        'div',
        { className: 'dsh-run-monitor-summary', key: 'summary' },
        GROUPS.map((group) =>
          h(
            'button',
            {
              type: 'button',
              key: group.state,
              className: 'dsh-run-monitor-chip',
              'data-state': group.state,
              'aria-expanded': collapsed[group.state] === true ? 'false' : 'true',
              title: t(group.labelKey),
              onClick: () => onToggle(group.state),
            },
            h('span', { className: 'dsh-run-monitor-chip__dot', 'aria-hidden': 'true' }),
            h('span', null, t(group.labelKey)),
            h('span', { className: 'dsh-run-monitor-chip__count' }, String(counts[group.state] || 0)),
          ),
        ),
      )
    }

    function sectionOf(group, tasks, props, completedUnread, collapsed, onToggle) {
      const rows = tasks.filter((task) => task.state === group.state)
      rows.sort(
        (left, right) =>
          (group.state === 'completed' ? right.finishedAt || right.updatedAt : right.updatedAt || 0) -
          (group.state === 'completed' ? left.finishedAt || left.updatedAt : left.updatedAt || 0),
      )
      const visible = group.state === 'completed' ? rows.filter((task) => completedUnread(task)) : rows
      const folded = collapsed[group.state] === true
      return h(
        'section',
        {
          className: 'dsh-run-monitor-section' + (folded ? '' : ' is-open'),
          'data-state': group.state,
          'data-collapsed': folded ? 'true' : 'false',
          key: group.state,
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-run-monitor-section__head',
            'aria-expanded': folded ? 'false' : 'true',
            onClick: () => onToggle(group.state),
          },
          h('span', { className: 'dsh-run-monitor-section__dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dsh-run-monitor-section__label' }, t(group.labelKey)),
          h('span', { className: 'dsh-run-monitor-section__count' }, String(visible.length)),
          h('span', { className: 'dsh-run-monitor-section__chevron', 'aria-hidden': 'true' }, '▾'),
        ),
        folded
          ? null
          : visible.length === 0
            ? h('div', { className: 'dsh-run-monitor-empty' }, t(group.emptyKey))
            : h(
                'ul',
                null,
                visible.map((task) =>
                  h(
                    'li',
                    { key: task.id },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-run-monitor-row',
                        title: task.title,
                        onClick: () => {
                          if (!props.openSession(task.id)) return
                          if (task.state === 'completed') markSeen(task)
                          close()
                        },
                      },
                      h(
                        'span',
                        { className: 'dsh-run-monitor-row__body' },
                        h(
                          'span',
                          { className: 'dsh-run-monitor-row__line' },
                          dirLabelOf(task) === ''
                            ? null
                            : h('span', { className: 'dsh-run-monitor-dir', title: task.group?.path || dirLabelOf(task) }, dirLabelOf(task)),
                          h('span', { className: 'dsh-run-monitor-row__title' }, task.title),
                        ),
                        h('span', { className: 'dsh-run-monitor-row__sub' }, subtitleOf(task)),
                      ),
                    ),
                  ),
                ),
              ),
      )
    }

    function dirLabelOf(task) {
      const group = task.group
      if (group && typeof group.label === 'string' && group.label !== '') return group.label
      return ''
    }

    function subtitleOf(task) {
      const parts = []
      if (task.state === 'awaiting' && task.pending && task.pending.question) {
        parts.push(task.pending.question)
      } else if (task.state === 'running' && task.childRunning) {
        // The main turn closed but delegated children still run — say so instead
        // of showing a stale "turn/end" activity line.
        parts.push(t('childRunning'))
      } else if (task.state === 'running' && task.lastActivity) {
        parts.push(task.lastActivity)
      }
      const time = timeAgo(task.state === 'completed' ? task.finishedAt || task.updatedAt : task.updatedAt)
      if (time) parts.push(time)
      return parts.join(' · ')
    }

    // Bubble order also reads as urgency: 待回复 > 执行中 > 已完成（未读）。
    function badgeNodes(counts, wide) {
      const active = BADGE_STATES.filter((name) => counts[name] > 0)
      // The 56px rail has room for one bubble only; the popover lists the rest.
      const shown = wide ? active : active.slice(0, 1)
      return shown.map((name) =>
        h(
          'span',
          {
            className: 'dsh-run-monitor-launcher__badge',
            'data-state': name,
            key: name,
            title: t(name) + ' ' + counts[name],
          },
          counts[name] > 99 ? '99+' : String(counts[name]),
        ),
      )
    }

    function countsOf(tasks, statusMap) {
      const counts = { running: 0, awaiting: 0, completed: 0 }
      for (const task of tasks) {
        if (task.state === 'running') counts.running += 1
        else if (task.state === 'awaiting') counts.awaiting += 1
        else if (task.state === 'completed' && isUnreadCompletion(task, statusMap, seen)) counts.completed += 1
      }
      return counts
    }

    function timeAgo(timestamp) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return ''
      const diff = Date.now() - timestamp
      if (diff < 60e3) return t('justNow')
      const minutes = Math.floor(diff / 60e3)
      if (minutes < 60) return t('minutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('hoursAgo', { n: hours })
      return t('daysAgo', { n: Math.floor(hours / 24) })
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(patch) {
          state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch)
          for (const listener of Array.from(listeners)) {
            try {
              listener()
            } catch (error) {
              console.error('[run-monitor] listener failed:', error)
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    function useStore(store) {
      const [snapshot, setSnapshot] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [store])
      return snapshot
    }
  },
})
