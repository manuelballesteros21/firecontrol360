'use client';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
function AcceptInvitationForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password,setPassword] = useState('');
  const [confirm,setConfirm] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [done,setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('');
    if (!token) { setMessage('El enlace no contiene un token de invitación.'); return; }
    if (password.length < 12) { setMessage('La contraseña debe tener al menos 12 caracteres.'); return; }
    if (password !== confirm) { setMessage('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API}/invitations/accept`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,password}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible aceptar la invitación.');
      localStorage.setItem('fc360_access_token', data.access_token);
      localStorage.setItem('fc360_tenant_id', data.tenant_id);
      setDone(true);
      setMessage('Tu cuenta fue activada. Ya puedes ingresar al inventario.');
    } catch(error) { setMessage(error instanceof Error ? error.message : 'Error de conexión.'); }
    finally { setBusy(false); }
  }
  return <main className="shell"><div className="brand">FIRECONTROL 360</div><section className="panel" style={{maxWidth:520,margin:'70px auto'}}><h1>Aceptar invitación</h1><p className="muted">Define una contraseña segura para activar tu acceso a la empresa.</p>{done ? <><p className="success">{message}</p><a className="button" href="/">Ir al inventario</a></> : <form onSubmit={submit}><label>Nueva contraseña</label><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} /><label>Confirmar contraseña</label><input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)} /><p className="muted">Mínimo 12 caracteres. El enlace es de un solo uso y vence a las 48 horas.</p><button disabled={busy || !token}>{busy?'Activando…':'Activar cuenta'}</button>{message && <p className="error" role="alert">{message}</p>}</form>}</section></main>;
}

export default function AcceptInvitationPage() { return <Suspense fallback={<main className="shell">Cargando invitación…</main>}><AcceptInvitationForm /></Suspense>; }
