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

  // Cron : digests quotidien et hebdomadaire à 8h
  let lastDailyDate = null;
  let lastWeeklyDate = null;
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 8 && lastDailyDate !== today) {
      lastDailyDate = today;
      safeRun('daily_digest', () => sendDailyDigest(ctx));
      if (now.getDay() === 1 && lastWeeklyDate !== today) {  // Lundi
        lastWeeklyDate = today;
        safeRun('weekly_digest', () => sendWeeklyDigest(ctx));
      }
    }
  }, 5 * 60 * 1000); // check toutes les 5 min

  console.log('📧 Notifier démarré (events realtime + digests quotidien 8h, hebdo lundi 8h)');
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

// Daily digest : à chaque membre, ses tâches du jour (groupées par catégorie)
async function sendDailyDigest(ctx) {
  console.log('📧 Daily digest — démarrage');
  const today = new Date().toISOString().slice(0, 10);

  // 1. Récupérer tous les profils avec notification_email
  const { data: profiles } = await ctx.sb
    .from('profiles').select('id, full_name, notification_email')
    .not('notification_email', 'is', null);
  if (!profiles?.length) return;

  // 2. Récupérer toutes les tâches non terminées + toutes les assignations
  const { data: tasks } = await ctx.sb.from('tasks').select('*').neq('status', 'done');
  const { data: links } = await ctx.sb.from('task_assignees').select('*');
  const assigneesByUser = {};
  (links || []).forEach(l => {
    (assigneesByUser[l.user_id] ||= []).push(l.task_id);
  });
  const tasksById = Object.fromEntries((tasks || []).map(t => [t.id, t]));

  let sent = 0;
  for (const p of profiles) {
    const myTaskIds = assigneesByUser[p.id] || [];
    const myTasks = myTaskIds.map(id => tasksById[id]).filter(Boolean);
    if (myTasks.length === 0) continue;

    // Catégoriser
    const overdue   = myTasks.filter(t => t.due_date && t.due_date < today);
    const dueToday  = myTasks.filter(t => t.due_date === today);
    const inProg    = myTasks.filter(t => t.status === 'in_progress' && (!t.due_date || t.due_date > today));
    const upcoming  = myTasks.filter(t => t.status === 'todo' && (!t.due_date || t.due_date > today));

    if (overdue.length === 0 && dueToday.length === 0 && inProg.length === 0 && upcoming.length === 0) continue;

    const sections = [];
    if (overdue.length)  sections.push(renderTaskSection('⚠️ En retard', overdue, 'overdue'));
    if (dueToday.length) sections.push(renderTaskSection('📅 Échéance aujourd\'hui', dueToday, 'today'));
    if (inProg.length)   sections.push(renderTaskSection('⚙️ En cours', inProg, 'progress'));
    if (upcoming.length) sections.push(renderTaskSection('📋 À faire prochainement', upcoming.slice(0, 5), 'todo'));

    await ctx.resend.emails.send({
      from: ctx.from,
      to: p.notification_email,
      subject: `📋 Tes tâches du jour (${myTasks.length})`,
      html: emailTemplate(ctx, {
        title: `Bonjour ${escapeHtml(p.full_name.split(' ')[0])}, voici ton point du jour`,
        bodyHtml: `
          <p>Tu as <strong>${myTasks.length} tâche(s)</strong> en cours.</p>
          ${sections.join('')}`,
        cta: 'Ouvrir le dashboard',
        ctaUrl: ctx.siteUrl + 'dashboard.html'
      })
    });
    sent++;
  }
  console.log(`📧 Daily digest envoyé à ${sent} membre(s)`);
}

// Weekly digest : récap équipe envoyé chaque lundi
async function sendWeeklyDigest(ctx) {
  console.log('📧 Weekly digest — démarrage');
  const today = new Date();
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const todayIso = today.toISOString().slice(0, 10);

  const { data: profiles } = await ctx.sb
    .from('profiles').select('id, full_name, notification_email')
    .not('notification_email', 'is', null);
  if (!profiles?.length) return;

  const { data: doneLastWeek } = await ctx.sb
    .from('tasks').select('*').eq('status', 'done').gte('updated_at', oneWeekAgo);
  const { data: inProgress }   = await ctx.sb
    .from('tasks').select('*').eq('status', 'in_progress');
  const { data: overdue }      = await ctx.sb
    .from('tasks').select('*').neq('status', 'done').lt('due_date', todayIso);

  const bodyHtml = `
    <p>Voici le point hebdomadaire de l'équipe.</p>
    <div style="display: flex; gap: 14px; margin: 18px 0; flex-wrap: wrap;">
      ${statBox('✅', (doneLastWeek || []).length, 'Terminées 7 derniers jours', '#2f9e44')}
      ${statBox('⚙️', (inProgress || []).length, 'En cours', '#f59f00')}
      ${statBox('⚠️', (overdue || []).length, 'En retard', '#e03131')}
    </div>
    ${(overdue || []).length ? renderTaskSection('⚠️ Tâches en retard', overdue.slice(0, 10), 'overdue') : ''}
    ${(doneLastWeek || []).length ? renderTaskSection('✅ Terminées récemment', doneLastWeek.slice(0, 10), 'done') : ''}
  `;

  let sent = 0;
  for (const p of profiles) {
    await ctx.resend.emails.send({
      from: ctx.from,
      to: p.notification_email,
      subject: `📊 Récap hebdo équipe — ${(doneLastWeek || []).length} terminées, ${(overdue || []).length} en retard`,
      html: emailTemplate(ctx, {
        title: 'Récapitulatif de la semaine',
        bodyHtml,
        cta: 'Voir le dashboard',
        ctaUrl: ctx.siteUrl + 'dashboard.html'
      })
    });
    sent++;
  }
  console.log(`📧 Weekly digest envoyé à ${sent} membre(s)`);
}

// Helpers de rendu
function renderTaskSection(title, tasks, kind) {
  const colors = {
    overdue:  { bg: '#fff5f5', border: '#e03131' },
    today:    { bg: '#fff4e6', border: '#e87722' },
    progress: { bg: '#fff9db', border: '#f59f00' },
    todo:     { bg: '#f1f3f5', border: '#868e96' },
    done:     { bg: '#d3f9d8', border: '#2f9e44' }
  };
  const c = colors[kind] || colors.todo;
  return `
    <h3 style="margin: 18px 0 8px; color: #1e3a5f; font-size: 15px;">${escapeHtml(title)}</h3>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${tasks.map(t => {
        const due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '';
        return `
        <li style="background: ${c.bg}; border-left: 3px solid ${c.border}; padding: 8px 12px; margin-bottom: 6px; border-radius: 4px;">
          <strong>${escapeHtml(t.title)}</strong>
          ${t.project ? `<small style="color: #495057;"> · 🏗️ ${escapeHtml(t.project)}</small>` : ''}
          ${due ? `<small style="color: #495057;"> · 📅 ${due}</small>` : ''}
        </li>`;
      }).join('')}
    </ul>`;
}

function statBox(icon, value, label, color) {
  return `
    <div style="flex: 1; min-width: 130px; background: #f8f9fa; padding: 14px; border-radius: 8px; text-align: center; border-top: 3px solid ${color};">
      <div style="font-size: 28px; line-height: 1;">${icon}</div>
      <div style="font-size: 28px; font-weight: 700; color: #1e3a5f; margin-top: 4px;">${value}</div>
      <div style="font-size: 12px; color: #868e96; text-transform: uppercase; letter-spacing: .5px; margin-top: 4px;">${label}</div>
    </div>`;
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
