import { useState } from 'react'
import { ArrowRight, Server } from 'lucide-react'
import { getApiBase, hasBuildApiBase, isNativeApp, resetApiBase, saveApiBase } from '../apiConfig'
import type { FormEvent } from 'react'

export default function ServerSettings({ initialSetup = false }: { initialSetup?: boolean }) {
  const [address, setAddress] = useState(getApiBase)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      saveApiBase(address); setSaving(true)
      window.location.reload()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
  }
  const reset = () => {
    setError('')
    try { resetApiBase(); setSaving(true); window.location.reload() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '重置失败，请重试') }
  }
  return <div className="server-settings-form">
    {initialSetup && <><div className="server-setup-icon"><Server size={28} /></div><h1>连接你的短剧服务</h1></>}
    <p className="server-settings-intro">填写你自己部署的红果剧场后端地址。安装包需要连接该服务，才能搜索和播放真实短剧。</p>
    <form onSubmit={submit}>
      <label htmlFor="server-address">HTTPS 服务地址</label>
      <input id="server-address" name="serverAddress" type="url" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="https://your-server.example.com" value={address} onChange={event => { setAddress(event.target.value); setError('') }} required disabled={saving} aria-describedby="server-address-help" />
      <p id="server-address-help" className="server-settings-hint">填写服务根地址，不带末尾的 /api。这里不填写红果或抖音账号。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={saving} type="submit">{saving ? '正在连接…' : '保存并连接'}<ArrowRight size={16} /></button>
    </form>
    <p className="server-settings-note">本站账号、收藏和观看记录由你连接的服务保存。更换地址后会重新读取账号状态。服务需要允许此 App 连接；HTTPS 和登录 Cookie 设置请参考仓库中的部署说明。</p>
    <p className="server-settings-note"><a href="licenses/index.html">开源许可与素材说明</a></p>
    {!initialSetup && <button className="server-settings-reset" type="button" disabled={saving} onClick={reset}>{hasBuildApiBase() ? '恢复安装包预设地址' : isNativeApp() ? '清除已保存的服务地址' : '恢复当前网站服务'}</button>}
  </div>
}
