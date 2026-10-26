import { useCallback, useEffect, useState } from 'react';
import { BellRing, CalendarClock, Check, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { getNotificationPermission, getNotificationSettings, openNotificationSettings, requestNotificationPermission, saveNotificationSettings } from '../services/settingsService.js';

function Overlay({ title, onClose, children, footer }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><div className="dialog-content">{children}</div><footer className="dialog-footer">{footer}</footer></section></div>;
}
function Notice({ children }) { return <div className="notice" role="status"><span className="notice-icon"><BellRing size={16} /></span><span>{children}</span></div>; }

export default function NotificationSettingsModal({ onClose }) {
  const [settings, setSettings] = useState({ classReminders: false, dailySummary: false });
  const [permission, setPermission] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) { setLoading(false); return; }
    try {
      const [preferences, systemPermission] = await Promise.all([getNotificationSettings(), getNotificationPermission()]);
      setSettings({ classReminders: preferences.classReminders, dailySummary: preferences.dailySummary });
      setPermission(Boolean(systemPermission.granted));
    } catch (error) { setMessage(error.message || 'Notification preferences could not be loaded.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  async function updateSetting(key, enabled) {
    if (saving) return;
    setSaving(true); setMessage('');
    try {
      if (enabled && !permission) {
        const result = await requestNotificationPermission();
        setPermission(Boolean(result.granted));
        if (!result.granted) {
          setMessage('Notifications are blocked. Allow them in Android notification settings, then try again.');
          return;
        }
      }
      const next = { ...settings, [key]: enabled };
      const saved = await saveNotificationSettings(next);
      setSettings({ classReminders: saved.classReminders, dailySummary: saved.dailySummary });
      setMessage(enabled ? 'Notification preference saved on this device.' : 'Notification preference turned off.');
    } catch (error) { setMessage(error.message || 'Notification preference could not be saved.'); }
    finally { setSaving(false); }
  }

  async function openSystemSettings() {
    try { await openNotificationSettings(); }
    catch (error) { setMessage(error.message || 'Could not open Android notification settings.'); }
  }

  const toggle = (key, label, detail, Icon) => <div className="notification-setting-row" key={key}>
    <span className="notification-setting-icon"><Icon size={17} /></span>
    <span className="notification-setting-copy"><strong>{label}</strong><small>{detail}</small></span>
    <button type="button" role="switch" aria-checked={settings[key]} aria-label={label} className={`toggle-control${settings[key] ? ' toggle-on' : ''}`} disabled={loading || saving || !Capacitor.isNativePlatform()} onClick={() => updateSetting(key, !settings[key])}><span /></button>
  </div>;

  return <Overlay title="Notification settings" onClose={onClose} footer={<button type="button" className="button button-secondary" onClick={onClose}>Done</button>}>
    {!Capacitor.isNativePlatform() && <Notice>Notification controls are available in the installed Android app.</Notice>}
    {loading && <div className="notification-loading"><LoaderCircle size={16} />Loading notification settings…</div>}
    {!loading && Capacitor.isNativePlatform() && <>
      <div className={`notification-permission${permission ? ' permission-granted' : ' permission-needed'}`}><span className="notification-permission-icon">{permission ? <Check size={16} /> : <BellRing size={16} />}</span><div><strong>{permission ? 'Android notifications allowed' : 'Android permission needed'}</strong><small>{permission ? 'Attendance Tracker can show notifications.' : 'Allow notifications in Android settings to receive reminders.'}</small></div>{!permission && <button type="button" className="icon-button" aria-label="Open Android notification settings" onClick={openSystemSettings}><ExternalLink size={15} /></button>}</div>
      <div className="notification-setting-list">
        {toggle('classReminders', 'Class reminders', 'Best-effort reminder 10 minutes before an active scheduled class.', CalendarClock)}
        {toggle('dailySummary', 'Daily attendance summary', 'Around 8 PM, only when there are pending reviews or subjects below target.', BellRing)}
      </div>
      <p className="notification-footnote">Android battery settings may delay notifications. Class reminders use your saved timetable and do not depend on the attendance scheduler.</p>
    </>}
    {message && <p className="notification-message" role="status">{message}</p>}
    {saving && <div className="notification-loading"><LoaderCircle size={15} />Saving…</div>}
  </Overlay>;
}
