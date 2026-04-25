// =========================================================
// GCBTP — Module de notifications email
// Écoute Supabase Realtime et envoie via Resend
// =========================================================
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export function startNotifier(opts) {
  const { supabaseUrl, serviceKey, resendKey, fromEmail, siteUrl } = opts;

  if (!resendKey) {
    console.log('⚠️  RESEND_API_KEY absente — notifications email désactivées');
    return;
  }
  if (!serviceKey) {
    console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY absente — notifications désactivées');
    return;
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const resend = new Resend(resendKey);
  const ctx = { sb, resend, from: fromEmail || 'GCBTP <noreply@guindoconstruction.xyz>', siteUrl };

  sb.channel('notifier')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'task_assignees' },
      (p) => safeRun('task_assigned', () => onTaskAssigned(ctx, p)))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'tasks' },
      (p) => safeRun('task_updated', () => onTaskUpdated(ctx, p)))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (p) => safeRun('new_message', () => onNewMessage(ctx, p)))
    .subscribe((status) => console.log(`📧 Notifier: ${status}`));

  // Cron : check des tâches en retard tous les jours à 8h
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 8 && now.getMinutes() < 5) {
      safeRun('overdue_check', () => checkOverdueTasks(ctx));
    }
  }, 5 * 60 * 1000); // toutes les 5 min

  console.log('📧 Notifier démarré (events realtime + cron tâches en retard à 8h)');
}

function safeRun(label, fn) {
  Promise.resolve().then(fn).catch(err => console.error(`📧 [${label}] erreur:`, err.message));
}

// -----------------------------------------------------------
// Handlers
// -----------------------------------------------------------

async function onTaskAssigned(ctx, payload) {
  const { task_id, user_id } = payload.new;
  const profile = await getProfile(ctx, user_id);
  if (!profile?.notification_email) return;
  const task = await getTask(ctx, task_id);
  if (!task) return;

  const dueText = task.due_date ? new Date(task.due_date).toLocaleDateString('fr-FR') : null;

  await ctx.resend.emails.send({
    from: ctx.from,
    to: profile.notification_email,
    subject: `📋 Nouvelle tâche assignée : ${task.title}`,
    html: emailTemplate(ctx, {
      title: 'Une nouvelle tâche t\'est assignée',
      bodyHtml: `
        <p>Bonjour ${escapeHtml(profile.full_name)},</p>
        <p>Tu as été ajouté(e) comme participant(e) sur la tâche :</p>
        <h3 style="color: #e87722; margin: 14px 0 8px;">${escapeHtml(task.title)}</h3>
        ${task.description ? `<p style="color: #495057;">${escapeHtml(task.description)}</p>` : ''}
        ${task.project ? `<p>🏗️ Chantier : <strong>${escapeHtml(task.project)}</strong></p>` : ''}
        ${dueText ? `<p>📅 Échéance : <strong>${dueText}</strong></p>` : ''}`,
      cta: 'Voir la tâche',
      ctaUrl: ctx.siteUrl + 'dashboard.html'
    })
  });
  console.log(`📧 → ${profile.notification_email} : tâche assignée "${task.title}"`);
}

async function onTaskUpdated(ctx, payload) {
  const oldT = payload.old || {};
  const newT = payload.new || {};
  // Ne notifier que sur changement de statut
  if (oldT.status === newT.status) return;

  const STATUS = { todo: 'À faire', in_progress: 'En cours', done: 'Terminée' };
  const newLabel = STATUS[newT.status] || newT.status;

  // Récupérer les assignés
  const { data: rows } = await ctx.sb
    .from('task_assignees').select('user_id').eq('task_id', newT.id);
  if (!rows?.length) return;

  for (const r of rows) {
    const profile = await getProfile(ctx, r.user_id);
    if (!profile?.notification_email) continue;

    const subject = newT.status === 'done'
      ? `✅ Tâche terminée : ${newT.title}`
      : `🔄 Tâche modifiée : ${newT.title}`;

    await ctx.resend.emails.send({
      from: ctx.from,
      to: profile.notification_email,
      subject,
      html: emailTemplate(ctx, {
        title: newT.status === 'done' ? 'Tâche marquée terminée' : 'Statut de tâche modifié',
        bodyHtml: `
          <p>Bonjour ${escapeHtml(profile.full_name)},</p>
          <p>La tâche <strong>${escapeHtml(newT.title)}</strong> est passée à :</p>
          <p style="font-size: 20px; color: #e87722; margin: 14px 0;"><strong>${newLabel}</strong></p>`,
        cta: 'Voir la tâche',
        ctaUrl: ctx.siteUrl + 'dashboard.html'
      })
    });
    console.log(`📧 → ${profile.notification_email} : statut "${newT.title}" → ${newLabel}`);
  }
}

async function onNewMessage(ctx, payload) {
  const msg = payload.new;
  const author = await getProfile(ctx, msg.user_id);
  if (!author) return;

  // Notifier tous les autres membres ayant un notification_email
  const { data: profiles } = await ctx.sb
    .from('profiles').select('id, full_name, notification_email').neq('id', msg.user_id);

  for (const p of (profiles || [])) {
    if (!p.notification_email) continue;
    const preview = msg.content.length > 100 ? msg.content.slice(0, 100) + '…' : msg.content;
    await ctx.resend.emails.send({
      from: ctx.from,
      to: p.notification_email,
      subject: `💬 ${author.full_name} : ${msg.content.slice(0, 50)}`,
      html: emailTemplate(ctx, {
        title: 'Nouveau message dans le chat',
        bodyHtml: `
          <p>Bonjour ${escapeHtml(p.full_name)},</p>
          <p><strong>${escapeHtml(author.full_name)}</strong> a écrit dans le canal général :</p>
          <blockquote style="border-left: 3px solid #e87722; padding: 8px 14px; margin: 14px 0; background: #fff4e6; color: #495057;">
            ${escapeHtml(preview)}
          </blockquote>`,
        cta: 'Répondre dans le chat',
        ctaUrl: ctx.siteUrl + 'chat.html'
      })
    });
  }
  console.log(`📧 Chat → ${(profiles || []).filter(p => p.notification_email).length} destinataires`);
}

async function checkOverdueTasks(ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks } = await ctx.sb
    .from('tasks').select('*').lt('due_date', today).neq('status', 'done');
  if (!tasks?.length) return;
  console.log(`📧 ${tasks.length} tâche(s) en retard à signaler`);

  for (const task of tasks) {
    const { data: assignees } = await ctx.sb
      .from('task_assignees').select('user_id').eq('task_id', task.id);
    for (const a of (assignees || [])) {
      const profile = await getProfile(ctx, a.user_id);
      if (!profile?.notification_email) continue;

      const dueDate = new Date(task.due_date).toLocaleDateString('fr-FR');
      await ctx.resend.emails.send({
        from: ctx.from,
        to: profile.notification_email,
        subject: `⚠️ Tâche en retard : ${task.title}`,
        html: emailTemplate(ctx, {
          title: 'Tu as une tâche en retard',
          bodyHtml: `
            <p>Bonjour ${escapeHtml(profile.full_name)},</p>
            <p>La tâche <strong>${escapeHtml(task.title)}</strong> avait pour échéance le <strong>${dueDate}</strong> et n'est pas encore terminée.</p>
            ${task.project ? `<p>🏗️ Chantier : ${escapeHtml(task.project)}</p>` : ''}`,
          cta: 'Mettre à jour la tâche',
          ctaUrl: ctx.siteUrl + 'dashboard.html'
        })
      });
    }
  }
}

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

async function getProfile(ctx, id) {
  const { data } = await ctx.sb.from('profiles').select('*').eq('id', id).single();
  return data;
}
async function getTask(ctx, id) {
  const { data } = await ctx.sb.from('tasks').select('*').eq('id', id).single();
  return data;
}

function emailTemplate(ctx, { title, bodyHtml, cta, ctaUrl }) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f3f5; padding: 24px 12px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #0f2542 100%); padding: 22px 24px; color: #fff;">
      <h1 style="margin: 0; font-size: 18px; font-weight: 600;">GCBTP — Espace équipe</h1>
      <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Guindo Construction BTP</p>
    </div>
    <div style="padding: 28px 24px;">
      <h2 style="color: #1e3a5f; margin: 0 0 16px; font-size: 20px;">${escapeHtml(title)}</h2>
      <div style="color: #495057; line-height: 1.55; font-size: 15px;">${bodyHtml}</div>
      ${cta ? `<div style="text-align: center; margin: 28px 0 8px;">
        <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; padding: 13px 28px; background: #e87722; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">${escapeHtml(cta)}</a>
      </div>` : ''}
    </div>
    <div style="background: #f8f9fa; padding: 14px 24px; color: #adb5bd; font-size: 12px; text-align: center;">
      Tu reçois cet email car ton email perso est défini sur ton profil.<br>
      <a href="${escapeHtml(ctx.siteUrl)}profil.html" style="color: #868e96;">Modifier mes notifications</a>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
