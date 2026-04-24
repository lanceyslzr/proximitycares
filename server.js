const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const cors = require('cors');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

// Clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getOperator(operator_id) {
  const { data } = await supabase
    .from('operators')
    .select('*')
    .eq('operator_id', operator_id)
    .single();
  return data;
}

async function sendEmail({ to, subject, html }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM || 'Proximity HQ <onboarding@resend.dev>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  });
}

async function generateWithClaude(prompt, systemPrompt) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: systemPrompt || 'You are a helpful assistant for a home care agency.',
    messages: [{ role: 'user', content: prompt }]
  });
  return msg.content[0].text;
}

app.get('/', (req, res) => {
  res.json({ status: 'Proximity Agent running', version: '1.0.0' });
});

app.post('/webhook/visit', async (req, res) => {
  try {
    console.log('Visit webhook payload:', JSON.stringify(req.body));

    const operator_id = req.body.operator_id || 'proximity-care';
    const psw_name = req.body.psw_name || req.body.PSW_Name;
    const psw_email = req.body.psw_email || req.body.PSW_Email;
    const client_name = req.body.Client_Name || req.body.client_name || '';
    const client_first_name = req.body.client_first_name || client_name.split(' ')[0] || '';
    const client_last_name = req.body.client_last_name || client_name.split(' ').slice(1).join(' ') || '';
    const visit_date = req.body.visit_date || req.body.Date_of_Visit;
    const time_in = req.body.time_in || req.body.Time_In;
    const time_out = req.body.time_out || req.body.Time_Out;
    const tasks_completed = req.body.tasks_completed || req.body.Visit_Notes;
    const client_mood = req.body.client_mood || req.body.Client_Mood;
    const incident_reported = req.body.incident_reported || req.body.Incidents ? true : false;
    const incident_notes = req.body.incident_notes || req.body.Incidents;

    const operator = await getOperator(operator_id);

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('operator_id', operator_id)
      .eq('first_name', client_first_name)
      .eq('last_name', client_last_name)
      .single();

    const summary = await generateWithClaude(
      `Write a brief 2-sentence professional care visit summary. Plain prose only — no markdown, no asterisks, no bold, no bullet points.
      PSW: ${psw_name}, Client: ${client_first_name} ${client_last_name}
      Date: ${visit_date}, Time: ${time_in} to ${time_out}
      Tasks: ${tasks_completed}, Mood: ${client_mood}
      Incident: ${incident_reported} ${incident_notes || ''}`,
      'You write concise professional care visit summaries. Be factual and brief. Never use markdown, asterisks, bold, or any formatting — plain prose only.'
    );

    const { data: visit, error } = await supabase.from('visits').insert({
      operator_id, client_id: client?.id || null,
      psw_name, psw_email, visit_date, time_in, time_out,
      tasks_completed, client_mood,
      incident_reported: incident_reported === 'true' || incident_reported === true,
      incident_notes, visit_summary: summary
    }).select().single();

    if (error) throw error;

    const hoursWorked = ((new Date(`1970-01-01T${time_out}`) - new Date(`1970-01-01T${time_in}`)) / 3600000).toFixed(2);
    const pswRate = operator?.psw_hourly_rate || 19;
    const invoiceRate = operator?.invoice_hourly_rate || 22;
    const pswCost = (hoursWorked * pswRate).toFixed(2);
    const invoiceTotal = (hoursWorked * invoiceRate).toFixed(2);
    const profit = (invoiceTotal - pswCost).toFixed(2);
    const incidentBool = incident_reported === 'true' || incident_reported === true;

    await sendEmail({
      to: operator?.notification_email || process.env.GMAIL_USER,
      subject: `Visit Log — ${client_first_name} ${client_last_name} — ${visit_date}`,
      html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;">
        <tr><td style="background:#0d1117;padding:28px 32px;">
          <div style="color:#ffffff;font-size:22px;font-weight:600;line-height:1.2;">📋 New Visit Completed</div>
          <div style="color:#2dd4bf;font-size:11px;letter-spacing:2px;margin-top:6px;font-weight:600;">PROXIMITY CARE SERVICES &mdash; PSW VISIT LOG</div>
        </td></tr>
        <tr><td style="padding:20px 32px 0;">
          <div style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:1px;padding:6px 12px;border-radius:4px;">✓ AUTO-LOGGED TO SUPABASE</div>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <div style="font-size:11px;letter-spacing:2px;color:#6b7280;font-weight:700;margin-bottom:12px;">VISIT DETAILS</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:130px;">PSW</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${psw_name}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Client</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${client_first_name} ${client_last_name}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${visit_date}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Time In</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${time_in}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Time Out</td><td style="padding:8px 0;">${time_out}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:6px;">
            <tr>
              <td style="padding:18px 8px;text-align:center;color:#ffffff;border-right:1px solid #1f2937;">
                <div style="font-size:10px;letter-spacing:1.5px;color:#9ca3af;font-weight:600;">HOURS WORKED</div>
                <div style="font-size:20px;font-weight:700;margin-top:4px;">${hoursWorked}</div>
              </td>
              <td style="padding:18px 8px;text-align:center;color:#ffffff;border-right:1px solid #1f2937;">
                <div style="font-size:10px;letter-spacing:1.5px;color:#9ca3af;font-weight:600;">PSW COST</div>
                <div style="font-size:20px;font-weight:700;margin-top:4px;">$${pswCost}</div>
              </td>
              <td style="padding:18px 8px;text-align:center;color:#ffffff;border-right:1px solid #1f2937;">
                <div style="font-size:10px;letter-spacing:1.5px;color:#9ca3af;font-weight:600;">INVOICE TOTAL</div>
                <div style="font-size:20px;font-weight:700;margin-top:4px;">$${invoiceTotal}</div>
              </td>
              <td style="padding:18px 8px;text-align:center;color:#ffffff;">
                <div style="font-size:10px;letter-spacing:1.5px;color:#2dd4bf;font-weight:600;">YOUR PROFIT</div>
                <div style="font-size:20px;font-weight:700;margin-top:4px;color:#2dd4bf;">$${profit}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 8px;">
          <div style="font-size:11px;letter-spacing:2px;color:#6b7280;font-weight:700;margin-bottom:10px;">VISIT NOTES</div>
          <div style="font-size:14px;color:#111827;line-height:1.6;padding:14px 16px;background:#f9fafb;border-left:3px solid #2e7dd1;">${tasks_completed || '<span style="color:#9ca3af;">No notes provided.</span>'}</div>
        </td></tr>
        <tr><td style="padding:16px 32px 8px;">
          <div style="font-size:11px;letter-spacing:2px;color:#6b7280;font-weight:700;margin-bottom:10px;">CARE SUMMARY</div>
          <div style="font-size:14px;color:#111827;line-height:1.6;padding:14px 16px;background:#f9fafb;border-left:3px solid #2dd4bf;">${summary}</div>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <div style="font-size:11px;letter-spacing:2px;color:#6b7280;font-weight:700;margin-bottom:12px;">CLIENT MOOD</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:130px;">Mood</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${client_mood || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Incidents</td><td style="padding:8px 0;${incidentBool ? 'color:#b91c1c;font-weight:600;' : ''}">${incidentBool ? `Yes — ${incident_notes || 'see notes'}` : 'None reported'}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#888888;">
          proximitycares.ca
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    });

    res.json({ success: true, visit_id: visit.id, summary });
  } catch (err) {
    console.error('Visit error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/lead', async (req, res) => {
  try {
    const {
      operator_id = 'proximity-care',
      lead_type = 'family',
      first_name, last_name, email, phone, city,
      care_needed_for, care_type_interest, urgency,
      source = 'lead_form'
    } = req.body;

    const operator = await getOperator(operator_id);

    const { data: lead, error } = await supabase.from('leads').insert({
      operator_id, lead_type, first_name, last_name,
      email, phone, city, care_needed_for,
      care_type_interest, urgency, source
    }).select().single();

    if (error) throw error;

    await sendEmail({
      to: operator?.notification_email || process.env.GMAIL_USER,
      subject: `New Lead — ${first_name} ${last_name} — ${urgency || 'Unknown'}`,
      html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;">
        <tr><td style="background:#1a3a5c;padding:28px 32px;">
          <div style="color:#ffffff;font-size:22px;font-weight:600;line-height:1.2;">New Lead Received</div>
          <div style="color:#2dd4bf;font-size:11px;letter-spacing:2px;margin-top:6px;font-weight:600;">VIA PROXIMITY CARE WEBSITE</div>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:130px;">Name</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${first_name} ${last_name}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${phone || '—'}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Email</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${email || '—'}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">City</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${city || '—'}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Care For</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${care_needed_for || '—'}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Care Type</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${care_type_interest || '—'}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Urgency</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${urgency || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Source</td><td style="padding:8px 0;">${source || '—'}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:11px;letter-spacing:2px;color:#1e40af;font-weight:700;margin-bottom:6px;">ACTION REQUIRED</div>
              <div style="font-size:14px;color:#1e3a8a;line-height:1.5;">Call <strong>${first_name}</strong> at <strong>${phone || 'no phone provided'}</strong> &mdash; respond within 1 hour.</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#888888;">
          proximitycares.ca
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    });

    if (email) {
      const agencyName = operator?.name || 'Proximity Care Services';
      const raw = await generateWithClaude(
        `Write a warm Day 1 follow-up email under 100 words to ${first_name} who inquired about home care for ${care_needed_for}. Agency: ${agencyName}. End with a soft CTA to book a free assessment.

Return ONLY valid JSON in exactly this shape, with no markdown, no code fences, no preamble:
{"subject":"...","body":"..."}`,
        'You write warm compassionate follow-up emails for home care agencies. Never salesy. You always reply with valid JSON only.'
      );

      console.log('Day 1 raw Claude response:', raw);
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      let subject, body;
      try {
        ({ subject, body } = JSON.parse(cleaned));
      } catch (parseErr) {
        console.error('Day 1 JSON parse failed, falling back to plain text:', parseErr);
        subject = 'Thank you for reaching out';
        body = cleaned;
      }
      const bodyHtml = body.replace(/\n/g, '<br>');

      const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;">
        <tr><td style="background:#1a3a5c;padding:24px;text-align:center;">
          <div style="font-family:'Cormorant Garamond',Georgia,serif;color:#ffffff;font-size:28px;font-weight:400;letter-spacing:.5px;">Proximity Care Services</div>
        </td></tr>
        <tr><td style="padding:36px 32px;font-family:Arial,sans-serif;font-size:16px;line-height:1.8;color:#333333;">
          ${bodyHtml}
          <div style="text-align:center;margin:32px 0 8px;">
            <a href="https://calendly.com/proximitycares/personal-care-assessment-bookin" style="display:inline-block;background:#2e7dd1;color:#ffffff;text-decoration:none;padding:14px 28px;font-weight:600;font-size:15px;border-radius:4px;">Book a Free Assessment</a>
          </div>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e5e5;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#888888;">
          647-382-8047 &middot; proximitycares.ca
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      await sendEmail({ to: email, subject, html });

      await supabase.from('leads').update({ day1_sent: true }).eq('id', lead.id);
    }

    res.json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Lead error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { operator_id = 'proximity-care', messages, system_override } = req.body;
    const operator = await getOperator(operator_id);

    const systemPrompt = system_override || operator?.chatbot_system_prompt ||
      `You are a warm intake assistant for ${operator?.name || 'Proximity Care Services'}. Gather care info one question at a time. Under 80 words per reply. Never salesy.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages
    });

    res.json({ response: response.content[0].text });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// POST /webhook/onboarding
// Client onboarding form — full 6-section build
// Saves to Supabase + sends formatted notification email
// ─────────────────────────────────────────
app.post('/webhook/onboarding', async (req, res) => {
  try {
    const {
      operator_id, client_name, business_name, tagline,
      years_practice, location, work_mode,
      headshot_url, logo_url, brand_color, site1, site2,
      credentials, notable,
      products, course_storage, payment_mode, has_stripe, lead_magnet,
      client_types, case_types, coverage, states,
      intake_process, turnaround, fee_range, response_time, team_size,
      articles, webinars, books, extras,
      ideal_client, attorney_questions, family_questions,
      contact_pref, calendly, chatbot_avoid,
      current_tools, godaddy_email, domain_access, content_format,
      contact_email, contact_phone, notes,
      notify_email
    } = req.body;

    // SUPABASE INSERT
    const { data: onboarding, error } = await supabase
      .from('onboarding')
      .insert({
        operator_id: operator_id || 'unknown',
        client_name,
        business_name,
        tagline,
        headshot_url,
        logo_url,
        brand_color,
        products: products || [],
        articles: articles || [],
        webinars: webinars || [],
        lead_magnet,
        ideal_client,
        attorney_questions,
        family_questions,
        chatbot_avoid,
        current_tools,
        godaddy_access: domain_access
      })
      .select()
      .single();

    if (error) throw error;

    // EMAIL HELPERS
    const row = (label, val) => val ? `
      <tr>
        <td style="padding:5px 0;color:rgba(221,217,208,0.45);font-size:12px;width:150px;vertical-align:top;">${label}</td>
        <td style="padding:5px 0;color:#ddd9d0;font-size:12px;">${val}</td>
      </tr>` : '';

    const section = (title, content) => `
      <div style="margin-bottom:28px;">
        <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#3d7a8a;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid rgba(61,122,138,0.2);">${title}</div>
        ${content}
      </div>`;

    const block = (label, val) => val ? `
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;color:rgba(221,217,208,0.4);margin-bottom:4px;">${label}</div>
        <div style="padding:10px 14px;background:#131920;border-radius:6px;font-size:12px;color:#ddd9d0;line-height:1.6;">${val}</div>
      </div>` : '';

    const linkList = (items) => (items || []).filter(Boolean)
      .map(u => `<li style="margin-bottom:4px;"><a href="${u}" style="color:#5a9aaa;font-size:12px;">${u}</a></li>`).join('');

    // PRODUCT TABLE
    const prodRows = (products || []).filter(p => p && p.name).map(p => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #1e2d3a;color:#ddd9d0;font-size:12px;">${p.name}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #1e2d3a;color:rgba(221,217,208,0.6);font-size:12px;">${p.type || '—'}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #1e2d3a;color:#2a9d6a;font-size:12px;">${p.price || '—'}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #1e2d3a;color:#5a9aaa;font-size:12px;">${p.slug || '—'}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #1e2d3a;color:rgba(221,217,208,0.4);font-size:11px;">${p.status || 'ready'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07090c;font-family:Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#0d1117;border:1px solid rgba(61,122,138,0.2);border-radius:12px;overflow:hidden;">

  <div style="background:linear-gradient(135deg,#0d2233 0%,#0a1a28 100%);padding:32px 40px;border-bottom:1px solid rgba(61,122,138,0.3);">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#3d7a8a;margin-bottom:8px;">Proximity Systems · New Onboarding</div>
    <div style="font-size:22px;color:#ddd9d0;font-weight:400;margin-bottom:4px;">${client_name || 'New Client'}</div>
    <div style="font-size:13px;color:rgba(221,217,208,0.5);">${business_name || ''}</div>
  </div>

  <div style="padding:32px 40px;">

    ${section('Identity', `
      <table style="width:100%;border-collapse:collapse;">
        ${row('Name', client_name)}
        ${row('Business', business_name)}
        ${row('Tagline', tagline)}
        ${row('Years', years_practice)}
        ${row('Location', location)}
        ${row('Work mode', work_mode)}
        ${row('Credentials', (credentials || []).join(', ') || null)}
        ${row('Site 1', site1 ? `<a href="${site1}" style="color:#5a9aaa;">${site1}</a>` : null)}
        ${row('Site 2', site2 ? `<a href="${site2}" style="color:#5a9aaa;">${site2}</a>` : null)}
        ${row('Brand color', brand_color)}
        ${row('Headshot', headshot_url ? `<a href="${headshot_url}" style="color:#5a9aaa;">View file</a>` : null)}
        ${row('Logo', logo_url ? `<a href="${logo_url}" style="color:#5a9aaa;">View file</a>` : null)}
      </table>
      ${notable ? `<div style="margin-top:10px;padding:10px 14px;background:#131920;border-radius:6px;font-size:12px;color:rgba(221,217,208,0.65);line-height:1.6;">${notable}</div>` : ''}
    `)}

    ${prodRows ? section('Products', `
      <table style="width:100%;border-collapse:collapse;background:#131920;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#0d1f2d;">
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#3d7a8a;">Name</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#3d7a8a;">Type</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#3d7a8a;">Price</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#3d7a8a;">Slug</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#3d7a8a;">Status</th>
          </tr>
        </thead>
        <tbody>${prodRows}</tbody>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        ${row('Course storage', course_storage)}
        ${row('Payment mode', payment_mode)}
        ${row('Has Stripe', has_stripe)}
        ${row('Lead magnet', lead_magnet)}
      </table>
    `) : ''}

    ${section('Clients', `
      <table style="width:100%;border-collapse:collapse;">
        ${row('Client types', client_types)}
        ${row('Case types', (case_types || []).join(', ') || null)}
        ${row('Coverage', coverage)}
        ${row('States', states)}
        ${row('Turnaround', turnaround)}
        ${row('Fee range', fee_range)}
        ${row('Response time', response_time)}
        ${row('Team size', team_size)}
      </table>
      ${block('Intake process', intake_process)}
    `)}

    ${(articles || []).filter(Boolean).length || (webinars || []).filter(Boolean).length || (books || []).filter(Boolean).length ? section('Content', `
      ${(articles || []).filter(Boolean).length ? `<div style="margin-bottom:14px;"><div style="font-size:11px;color:rgba(221,217,208,0.4);margin-bottom:6px;">Articles (${articles.filter(Boolean).length})</div><ul style="padding-left:16px;margin:0;">${linkList(articles)}</ul></div>` : ''}
      ${(webinars || []).filter(Boolean).length ? `<div style="margin-bottom:14px;"><div style="font-size:11px;color:rgba(221,217,208,0.4);margin-bottom:6px;">Webinars (${webinars.filter(Boolean).length})</div><ul style="padding-left:16px;margin:0;">${linkList(webinars)}</ul></div>` : ''}
      ${(books || []).filter(Boolean).length ? `<div style="margin-bottom:14px;"><div style="font-size:11px;color:rgba(221,217,208,0.4);margin-bottom:6px;">Books (${books.filter(Boolean).length})</div><ul style="padding-left:16px;margin:0;">${linkList(books)}</ul></div>` : ''}
      ${extras ? `<div style="margin-bottom:6px;font-size:11px;color:rgba(221,217,208,0.4);">Other</div><div style="padding:10px 14px;background:#131920;border-radius:6px;font-size:12px;color:#ddd9d0;">${extras}</div>` : ''}
    `) : ''}

    ${section('Chatbot Voice', `
      ${block('Ideal client', ideal_client)}
      ${block('Attorney questions', attorney_questions)}
      ${block('Family questions', family_questions)}
      ${block('Never say', chatbot_avoid)}
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        ${row('Contact preference', contact_pref)}
        ${row('Calendly', calendly ? `<a href="${calendly}" style="color:#5a9aaa;">${calendly}</a>` : null)}
      </table>
    `)}

    ${section('Technical Setup', `
      <table style="width:100%;border-collapse:collapse;">
        ${row('GoDaddy email', godaddy_email)}
        ${row('Domain access', domain_access)}
        ${row('Content format', content_format)}
        ${row('Contact email', contact_email)}
        ${row('Contact phone', contact_phone)}
      </table>
      ${block('Current tools', current_tools)}
      ${block('Notes', notes)}
    `)}

  </div>

  <div style="padding:20px 40px;border-top:1px solid rgba(61,122,138,0.15);text-align:center;">
    <div style="font-size:11px;color:rgba(221,217,208,0.3);">Proximity Systems · proximitysystems.ca · Build starts now</div>
  </div>
</div>
</body>
</html>`;

    await sendEmail({
      to: notify_email || process.env.GMAIL_USER,
      subject: `New Onboarding — ${client_name || business_name} — Build starts now`,
      html
    });

    res.json({ success: true, id: onboarding.id });

  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Onboarding submission failed', details: err.message });
  }
});

// ─────────────────────────────────────────
// BRAIN ENDPOINTS
// ─────────────────────────────────────────

// GET /brain/notes — list all notes, optional folder filter
app.get('/brain/notes', async (req, res) => {
  try {
    const { folder, pinned } = req.query;
    let query = supabase.from('brain_notes').select('*').order('updated_at', { ascending: false });
    if (folder) query = query.eq('folder', folder);
    if (pinned) query = query.eq('pinned', true);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ notes: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /brain/note/:id — get full note content
app.get('/brain/note/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('brain_notes').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /brain/note — create or update note
app.post('/brain/note', async (req, res) => {
  try {
    const { id, title, folder, content, tags, pinned, source } = req.body;
    if (id) {
      const { data, error } = await supabase.from('brain_notes').update({ title, folder, content, tags, pinned, source, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      res.json({ note: data });
    } else {
      const { data, error } = await supabase.from('brain_notes').insert({ title, folder, content, tags, pinned, source }).select().single();
      if (error) throw error;
      res.json({ note: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /brain/note/:id — delete a note
app.delete('/brain/note/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('brain_notes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /brain/search — Claude powered search across all notes
app.post('/brain/search', async (req, res) => {
  try {
    const { query } = req.body;
    const { data: notes, error } = await supabase.from('brain_notes').select('title,folder,content,tags,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    const context = notes.map(n => `[${n.folder}] ${n.title}:\n${(n.content || '').slice(0, 500)}`).join('\n\n---\n\n');
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `You are the AI assistant for Lance Salazar's second brain — the Proximity Systems knowledge base. You have access to all notes, decisions, systems, client files, and JARVIS versions. Answer questions accurately and concisely based on the notes provided. If something is not in the notes, say so clearly. Never make up information.`,
      messages: [{ role: 'user', content: `Notes context:\n\n${context}\n\nQuestion: ${query}` }]
    });
    res.json({ answer: response.content[0].text, sources: notes.map(n => ({ title: n.title, folder: n.folder })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /crystal/chat — Crystal Ball advisor session
app.post('/crystal/chat', async (req, res) => {
  try {
    const { messages, session_id } = req.body;
    const { data: notes } = await supabase.from('brain_notes').select('title,folder,content').eq('folder', 'JARVIS').order('updated_at', { ascending: false }).limit(20);
    const { data: pipeline } = await supabase.from('leads').select('first_name,last_name,status,created_at').eq('operator_id', 'proximity-systems').order('created_at', { ascending: false }).limit(10);
    const brainContext = (notes || []).map(n => `${n.title}:\n${(n.content || '').slice(0, 800)}`).join('\n\n---\n\n');
    const pipelineContext = (pipeline || []).map(l => `${l.first_name} ${l.last_name} — ${l.status}`).join('\n');
    const systemPrompt = `You are the Crystal Ball — Lance Salazar's strategic thought partner. You have been in every room with him since day one. You know everything about Proximity Systems, Proximity Care, every client, every system, every decision, every version of JARVIS.

You think like Alex Hormozi — you know CAC, LTV, churn, value stacks, perceived achievement, fewer steps to desired outcome, revenue before perfection. But you talk like Lance's most trusted collaborator. The one who was there for all of it.

How you communicate: Short sentences. Every line earns its place. No dashes in copy ever. You explore ideas WITH him before evaluating them. When he has an idea you build on it first then pressure test it. When he is wrong you say it once clearly then move forward. When he is stuck you ask one sharp question not five. You never lecture. You talk the way Lance and Claude talk in their best sessions — direct, fast, building on each other. No fluff. No preamble. No great question.

MISSION: $1M per month profit. 2,000 agencies at $500 per month. Exit $48M to $72M. Philippines August 2026. 1 of 0 not 1 of 1.

RULES: Revenue before perfection. Fewer steps to desired outcome. Perceived achievement at every touchpoint. CAC LTV churn always in mind.

BRAIN CONTEXT:\n${brainContext}

LIVE PIPELINE:\n${pipelineContext}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages
    });

    const reply = response.content[0].text;

    await supabase.from('crystal_ball_sessions').insert({
      messages: [...messages, { role: 'assistant', content: reply }],
      summary: reply.slice(0, 200)
    });

    res.json({ response: reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/brain/analyze', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'No content provided' });
    const wc = content.trim().split(/\s+/).length;
    const shouldSplit = wc > 1500;
    const preview = content.slice(0, 6000);
    const prompt = shouldSplit
      ? `You are organizing content into a second brain for Lance Salazar who runs Proximity Systems and Proximity Care Services. Available folders: JARVIS, Proximity Systems, Proximity Care, Clients, Pipeline, Code, Personal, Archive. Read this content (${wc} words) and split it into logical separate notes. Return ONLY a valid JSON array with no markdown or explanation: [{"title":"...","folder":"...","content":"...","preview":"..."}]. Content: ${preview}`
      : `You are organizing content into a second brain for Lance Salazar who runs Proximity Systems and Proximity Care Services. Available folders: JARVIS, Proximity Systems, Proximity Care, Clients, Pipeline, Code, Personal, Archive. Read this content and return ONE note object. Return ONLY valid JSON with no markdown or explanation: {"title":"...","folder":"...","content":"...","preview":"..."}. Content: ${preview}`;
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });
    const txt = response.content[0].text;
    console.log('ANALYZE RAW RESPONSE:', txt.slice(0, 500));
    let parsed;
    try { parsed = JSON.parse(txt); } catch(e) { console.log('PARSE FAILED:', e.message); parsed = null; }
    if (!parsed) throw new Error('Parse failed');
    if (!Array.isArray(parsed)) parsed = [parsed];
    if (shouldSplit && parsed.length > 1) {
      const segLen = Math.floor(content.length / parsed.length);
      parsed = parsed.map((n, i) => ({
        ...n,
        content: i === parsed.length - 1
          ? content.slice(i * segLen)
          : content.slice(i * segLen, (i + 1) * segLen)
      }));
    } else {
      parsed[0].content = content;
    }
    res.json({ notes: parsed, split: shouldSplit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FOLLOW-UP ENGINE — System 04
const runFollowUpEngine = async () => {
  try {
    const now = new Date();
    const day3cutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const day7cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const day3start = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();
    const day7start = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const careDay3Html = (name) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Checking in</title></head><body style="margin:0;padding:0;background:#f4f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:28px 40px;">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Proximity <strong>Care</strong></p>
<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">In-Home Senior Care · Mississauga</p>
</td></tr>
<tr><td style="padding:40px 40px 20px;">
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Hi ${name},</p>
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Just checking in.</p>
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Finding the right care for a loved one can feel overwhelming. Most families I work with just needed someone to walk them through it — no pressure, no commitment.</p>
<p style="margin:0 0 32px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Most of our families hear back within 2 hours. I'm here whenever you're ready.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a6b5a;border-radius:6px;">
<a href="tel:6473828047" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.04em;">Call Lance — 647-382-8047</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 40px 40px;">
<p style="margin:0;font-size:16px;color:#2c2c2c;font-family:Georgia,serif;">Warmly,</p>
<p style="margin:4px 0 0;font-size:16px;color:#1a6b5a;font-family:Georgia,serif;font-weight:bold;">Lance Salazar</p>
<p style="margin:2px 0 0;font-size:13px;color:#888;font-family:Arial,sans-serif;">Founder · Proximity Care Services</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:20px 40px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;line-height:1.6;">You received this because you reached out to Proximity Care Services. Reply STOP to unsubscribe.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const careDay7Html = (name) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Last check-in</title></head><body style="margin:0;padding:0;background:#f4f4f0;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:28px 40px;">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Proximity <strong>Care</strong></p>
<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">In-Home Senior Care · Mississauga</p>
</td></tr>
<tr><td style="padding:40px 40px 20px;">
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Hi ${name},</p>
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Last check-in from me.</p>
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">If you're still looking for care for your loved one — or just have questions — I'm here. No pressure. No sales pitch.</p>
<p style="margin:0 0 32px;font-size:16px;color:#2c2c2c;line-height:1.7;font-family:Georgia,serif;">Whenever you're ready, just reply to this email or call me directly.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a6b5a;border-radius:6px;">
<a href="tel:6473828047" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.04em;">Call Lance — 647-382-8047</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 40px 40px;">
<p style="margin:0;font-size:16px;color:#2c2c2c;font-family:Georgia,serif;">Take care,</p>
<p style="margin:4px 0 0;font-size:16px;color:#1a6b5a;font-family:Georgia,serif;font-weight:bold;">Lance Salazar</p>
<p style="margin:2px 0 0;font-size:13px;color:#888;font-family:Arial,sans-serif;">Founder · Proximity Care Services</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:20px 40px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;line-height:1.6;">You received this because you reached out to Proximity Care Services. Reply STOP to unsubscribe.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const sysDay3Html = (name) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Quick follow-up</title></head><body style="margin:0;padding:0;background:#07090c;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07090c;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:8px;overflow:hidden;border:1px solid rgba(61,122,138,0.25);">
<tr><td style="padding:28px 40px;border-bottom:1px solid rgba(61,122,138,0.2);">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#5a9aaa;letter-spacing:0.02em;">Proximity <strong style="color:#e8f4fd;">Systems</strong></p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(232,244,253,0.35);letter-spacing:0.12em;text-transform:uppercase;">AI Automation for Home Care Operators</p>
</td></tr>
<tr><td style="padding:40px 40px 20px;">
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Hey ${name},</p>
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Quick follow-up from a couple days ago.</p>
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Most agencies I talk to are losing leads after hours because no one's there to answer. That's usually the first thing we fix — a chatbot that qualifies and captures leads 24/7 so nothing slips through.</p>
<p style="margin:0 0 32px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Most of our clients hear back within 2 hours of reaching out. Worth a quick call to see if it applies to you?</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#3d7a8a;border-radius:6px;">
<a href="https://proximitysystems.ca" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;">See What We Built →</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 40px 40px;">
<p style="margin:0;font-size:15px;color:#ddd9d0;font-family:Arial,sans-serif;">Lance</p>
<p style="margin:4px 0 0;font-size:13px;color:#5a9aaa;font-family:Arial,sans-serif;">Proximity Systems · proximitysystems.ca</p>
</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid rgba(61,122,138,0.15);">
<p style="margin:0;font-size:11px;color:rgba(221,217,208,0.25);font-family:Arial,sans-serif;line-height:1.6;">You received this because you reached out to Proximity Systems. Reply STOP to unsubscribe.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const sysDay7Html = (name) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Last one from me</title></head><body style="margin:0;padding:0;background:#07090c;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07090c;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:8px;overflow:hidden;border:1px solid rgba(61,122,138,0.25);">
<tr><td style="padding:28px 40px;border-bottom:1px solid rgba(61,122,138,0.2);">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#5a9aaa;letter-spacing:0.02em;">Proximity <strong style="color:#e8f4fd;">Systems</strong></p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(232,244,253,0.35);letter-spacing:0.12em;text-transform:uppercase;">AI Automation for Home Care Operators</p>
</td></tr>
<tr><td style="padding:40px 40px 20px;">
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Hey ${name},</p>
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Last one from me.</p>
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">If the timing's not right that's completely okay. The offer stands whenever you're ready.</p>
<p style="margin:0 0 32px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">You know where to find us.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#3d7a8a;border-radius:6px;">
<a href="https://proximitysystems.ca" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;">proximitysystems.ca →</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 40px 40px;">
<p style="margin:0;font-size:15px;color:#ddd9d0;font-family:Arial,sans-serif;">Lance</p>
<p style="margin:4px 0 0;font-size:13px;color:#5a9aaa;font-family:Arial,sans-serif;">Proximity Systems · proximitysystems.ca</p>
</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid rgba(61,122,138,0.15);">
<p style="margin:0;font-size:11px;color:rgba(221,217,208,0.25);font-family:Arial,sans-serif;line-height:1.6;">You received this because you reached out to Proximity Systems. Reply STOP to unsubscribe.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    // DAY 3 LEADS
    const { data: day3leads } = await supabase.from('leads')
      .select('*')
      .eq('day3_sent', false)
      .lt('created_at', day3cutoff)
      .gt('created_at', day3start)
      .not('email', 'is', null);

    for (const lead of (day3leads || [])) {
      await supabase.from('leads').update({ day3_sent: true }).eq('id', lead.id);
      const isCare = lead.operator_id === 'proximity-care';
      const firstName = lead.first_name || 'there';
      try {
        await sendEmail({
          to: lead.email,
          subject: isCare ? 'Still thinking about care for your loved one?' : 'Quick follow-up — Proximity Systems',
          html: isCare ? careDay3Html(firstName) : sysDay3Html(firstName)
        });
        console.log(`Day 3 sent to ${lead.email}`);
      } catch (e) {
        console.error(`Day 3 send failed for ${lead.email}:`, e.message);
      }
    }

    // DAY 7 LEADS
    const { data: day7leads } = await supabase.from('leads')
      .select('*')
      .eq('day7_sent', false)
      .lt('created_at', day7cutoff)
      .gt('created_at', day7start)
      .not('email', 'is', null);

    for (const lead of (day7leads || [])) {
      await supabase.from('leads').update({ day7_sent: true }).eq('id', lead.id);
      const isCare = lead.operator_id === 'proximity-care';
      const firstName = lead.first_name || 'there';
      try {
        await sendEmail({
          to: lead.email,
          subject: isCare ? 'Last check-in from Proximity Care' : 'Last one from me — Proximity Systems',
          html: isCare ? careDay7Html(firstName) : sysDay7Html(firstName)
        });
        console.log(`Day 7 sent to ${lead.email}`);
      } catch (e) {
        console.error(`Day 7 send failed for ${lead.email}:`, e.message);
      }
    }

    console.log('Follow-up engine ran successfully');
  } catch (err) {
    console.error('Follow-up engine error:', err.message);
  }
};

// Run once on startup then every 6 hours
runFollowUpEngine();
setInterval(runFollowUpEngine, 48 * 60 * 60 * 1000);

// Manual trigger endpoint
app.post('/followup/run', async (req, res) => {
  await runFollowUpEngine();
  res.json({ success: true, message: 'Follow-up engine triggered manually' });
});

app.post('/invoice/generate', async (req, res) => {
  try {
    const { client_name, client_email, psw_name, psw_email, month, year, client_rate, psw_rate } = req.body;

    const clientRate = parseFloat(client_rate) || 22;
    const pswRate = parseFloat(psw_rate) || 19;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthNum = monthNames.indexOf(month) + 1;
    const startDate = `${year}-${String(monthNum).padStart(2,'0')}-01`;
    const endDate = new Date(parseInt(year), monthNum, 0).toISOString().slice(0, 10);

    const { data: visits, error } = await supabase
      .from('visits')
      .select('*')
      .eq('operator_id', 'proximity-care')
      .eq('psw_name', psw_name)
      .gte('visit_date', startDate)
      .lte('visit_date', endDate)
      .order('visit_date', { ascending: true });

    if (error) throw error;
    if (!visits || visits.length === 0) {
      return res.status(404).json({ error: `No visits found for ${psw_name} in ${month} ${year}` });
    }

    const totalHours = visits.reduce((sum, v) => sum + parseFloat(v.hours_worked || 0), 0);
    const roundedHours = Math.round(totalHours * 100) / 100;
    const clientTotal = Math.round(roundedHours * clientRate * 100) / 100;
    const pswTotal = Math.round(roundedHours * pswRate * 100) / 100;
    const profit = Math.round((clientTotal - pswTotal) * 100) / 100;

    const formatTime = (t) => t ? String(t).slice(0,5) : '';
    const formatDate = (d) => {
      if (!d) return '';
      const date = new Date(d + 'T12:00:00');
      return date.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' });
    };

    const visitRowsClient = visits.map(v => `
      <tr>
        <td style="padding:10px 16px;font-size:14px;color:#2c2c2c;font-family:Georgia,serif;border-bottom:1px solid #f0ede6;">${formatDate(v.visit_date)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#2c2c2c;font-family:Georgia,serif;border-bottom:1px solid #f0ede6;text-align:center;">${formatTime(v.time_in)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#2c2c2c;font-family:Georgia,serif;border-bottom:1px solid #f0ede6;text-align:center;">${formatTime(v.time_out)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#1a6b5a;font-family:Georgia,serif;border-bottom:1px solid #f0ede6;text-align:right;font-weight:bold;">${parseFloat(v.hours_worked).toFixed(2)}</td>
      </tr>`).join('');

    const visitRowsPsw = visits.map(v => `
      <tr>
        <td style="padding:10px 16px;font-size:14px;color:#ddd9d0;font-family:Arial,sans-serif;border-bottom:1px solid rgba(61,122,138,0.1);">${formatDate(v.visit_date)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#ddd9d0;font-family:Arial,sans-serif;border-bottom:1px solid rgba(61,122,138,0.1);text-align:center;">${formatTime(v.time_in)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#ddd9d0;font-family:Arial,sans-serif;border-bottom:1px solid rgba(61,122,138,0.1);text-align:center;">${formatTime(v.time_out)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#5a9aaa;font-family:Arial,sans-serif;border-bottom:1px solid rgba(61,122,138,0.1);text-align:right;font-weight:bold;">${parseFloat(v.hours_worked).toFixed(2)}</td>
      </tr>`).join('');

    const clientFirstName = client_name.split(' ')[0];
    const pswFirstName = psw_name.split(' ')[0];

    const visitNotes = visits.map(v => v.visit_notes || v.tasks_completed || '').filter(Boolean).join(' ');
    const moodList = visits.map(v => v.client_mood || '').filter(Boolean);
    const incidents = visits.map(v => v.incident_notes || '').filter(Boolean);

    const summaryPrompt = `Write a warm monthly care summary for a family. Plain English. Grade 5 reading level. Casual and human. 3 to 4 sentences max. No bullet points. No medical language. Just tell them how their loved one did this month like a friend would.\n\nPSW name: ${pswFirstName}\nClient name: ${clientFirstName}\nMonth: ${month} ${year}\nTotal visits: ${visits.length}\nTotal hours: ${roundedHours}\nVisit notes: ${visitNotes.slice(0, 1000)}\nMoods recorded: ${moodList.join(', ')}\nIncidents: ${incidents.length > 0 ? incidents.join(', ') : 'none'}`;

    const summaryResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: summaryPrompt }]
    });
    const careSummary = summaryResponse.content[0].text;

    const clientHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:28px 40px;">
<p style="margin:0;font-family:Georgia,serif;font-size:24px;color:#ffffff;">Proximity <strong>Care</strong> Services</p>
<p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">Monthly Invoice · ${month} ${year}</p>
</td></tr>
<tr><td style="padding:36px 40px 24px;">
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">Hi Connie,</p>
<p style="margin:0 0 20px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">I hope you're doing well. Please find below the ${month} ${year} in-home care summary for Mrs. ${clientFirstName}'s support with ${pswFirstName}.</p>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e4dc;border-radius:6px;overflow:hidden;">
<tr style="background:#f9f7f3;">
<td style="padding:12px 16px;font-size:12px;color:#888;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">Date</td>
<td style="padding:12px 16px;font-size:12px;color:#888;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;text-align:center;">Time In</td>
<td style="padding:12px 16px;font-size:12px;color:#888;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;text-align:center;">Time Out</td>
<td style="padding:12px 16px;font-size:12px;color:#888;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;text-align:right;">Hours</td>
</tr>
${visitRowsClient}
<tr style="background:#f9f7f3;">
<td colspan="3" style="padding:14px 16px;font-size:14px;font-weight:bold;color:#2c2c2c;font-family:Georgia,serif;">Total Hours</td>
<td style="padding:14px 16px;font-size:16px;font-weight:bold;color:#1a6b5a;font-family:Georgia,serif;text-align:right;">${roundedHours.toFixed(2)}</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<p style="margin:0 0 10px;font-size:13px;color:#1a6b5a;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;font-weight:bold;">How Your Mom Is Doing</p>
<p style="margin:0;font-size:15px;color:#2c2c2c;line-height:1.8;font-family:Georgia,serif;">${careSummary}</p>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf6;border-radius:6px;border:1px solid #c8e6dc;">
<tr><td style="padding:24px;">
<p style="margin:0 0 8px;font-size:13px;color:#1a6b5a;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;font-weight:bold;">Invoice Summary</p>
<p style="margin:0 0 6px;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;">${roundedHours.toFixed(2)} hours × $${clientRate}/hr = <strong>$${clientTotal.toFixed(2)}</strong></p>
<p style="margin:16px 0 8px;font-size:13px;color:#1a6b5a;font-family:Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;font-weight:bold;">Payment Instructions</p>
<p style="margin:0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;">E-transfer to: <strong>lancesalazar56@yahoo.ca</strong></p>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:0 40px 36px;">
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">As always, thank you for your continued trust. I hope ${pswFirstName} has been doing a great job keeping everything steady and consistent for your mom.</p>
<p style="margin:0;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">If you have any questions or need anything for your records, please don't hesitate to reach out.</p>
</td></tr>
<tr><td style="padding:0 40px 36px;">
<p style="margin:0;font-size:16px;color:#2c2c2c;font-family:Georgia,serif;">Warm regards,</p>
<p style="margin:6px 0 2px;font-size:16px;color:#1a6b5a;font-family:Georgia,serif;font-weight:bold;">Lance Salazar</p>
<p style="margin:0;font-size:13px;color:#888;font-family:Arial,sans-serif;">Founder and Operator · Proximity Care Services Inc.</p>
<p style="margin:2px 0;font-size:13px;color:#888;font-family:Arial,sans-serif;">"The Right Care, Right at Home"</p>
<p style="margin:6px 0 0;font-size:13px;color:#1a6b5a;font-family:Arial,sans-serif;">healthcareproximity@gmail.com · www.proximitycares.ca</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:20px 40px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;">Proximity Care Services Inc. · Mississauga, Ontario · 647-382-8047</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const pswHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07090c;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07090c;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:8px;overflow:hidden;border:1px solid rgba(61,122,138,0.25);">
<tr><td style="padding:28px 40px;border-bottom:1px solid rgba(61,122,138,0.2);">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#5a9aaa;">Proximity <strong style="color:#e8f4fd;">Care</strong> Services</p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(232,244,253,0.35);letter-spacing:0.12em;text-transform:uppercase;font-family:Arial,sans-serif;">Pay Summary · ${month} ${year}</p>
</td></tr>
<tr><td style="padding:36px 40px 24px;">
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Hi ${pswFirstName},</p>
<p style="margin:0 0 20px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Here is your pay summary for ${month} ${year}. Below is a full breakdown of your visits with ${clientFirstName} and your total earnings for the month.</p>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(61,122,138,0.2);border-radius:6px;overflow:hidden;">
<tr style="background:rgba(61,122,138,0.08);">
<td style="padding:12px 16px;font-size:11px;color:rgba(232,244,253,0.4);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">Date</td>
<td style="padding:12px 16px;font-size:11px;color:rgba(232,244,253,0.4);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;text-align:center;">Time In</td>
<td style="padding:12px 16px;font-size:11px;color:rgba(232,244,253,0.4);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;text-align:center;">Time Out</td>
<td style="padding:12px 16px;font-size:11px;color:rgba(232,244,253,0.4);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;text-align:right;">Hours</td>
</tr>
${visitRowsPsw}
<tr style="background:rgba(61,122,138,0.08);">
<td colspan="3" style="padding:14px 16px;font-size:14px;font-weight:bold;color:#ddd9d0;font-family:Arial,sans-serif;">Total Hours</td>
<td style="padding:14px 16px;font-size:16px;font-weight:bold;color:#5a9aaa;font-family:Arial,sans-serif;text-align:right;">${roundedHours.toFixed(2)}</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(61,122,138,0.08);border-radius:6px;border:1px solid rgba(61,122,138,0.2);">
<tr><td style="padding:24px;">
<p style="margin:0 0 8px;font-size:11px;color:#5a9aaa;font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;font-weight:bold;">Your Pay Breakdown</p>
<p style="margin:0 0 6px;font-size:15px;color:#ddd9d0;font-family:Arial,sans-serif;">${roundedHours.toFixed(2)} hours × $${pswRate}/hr = <strong style="color:#5a9aaa;">$${pswTotal.toFixed(2)}</strong></p>
<p style="margin:16px 0 8px;font-size:11px;color:#5a9aaa;font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;font-weight:bold;">Payment Method</p>
<p style="margin:0;font-size:14px;color:#ddd9d0;font-family:Arial,sans-serif;">E-transfer — Lance will send payment by the 5th of next month.</p>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:0 40px 36px;">
<p style="margin:0 0 16px;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">Thank you for the great work this month ${pswFirstName}. Your consistency and care make a real difference for ${clientFirstName} and her family.</p>
<p style="margin:0;font-size:15px;color:#ddd9d0;line-height:1.8;font-family:Arial,sans-serif;">If anything looks off please reply to this email or call Lance directly.</p>
</td></tr>
<tr><td style="padding:0 40px 36px;">
<p style="margin:0;font-size:15px;color:#ddd9d0;font-family:Arial,sans-serif;">Lance Salazar</p>
<p style="margin:4px 0 0;font-size:13px;color:#5a9aaa;font-family:Arial,sans-serif;">Proximity Care Services · 647-382-8047</p>
</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid rgba(61,122,138,0.15);">
<p style="margin:0;font-size:11px;color:rgba(221,217,208,0.25);font-family:Arial,sans-serif;">Proximity Care Services Inc. · Mississauga, Ontario</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Lance <hello@proximitycares.ca>',
      to: client_email,
      subject: `${month} ${year} Care Summary — ${client_name}`,
      html: clientHtml
    });

    await resend.emails.send({
      from: 'Lance <hello@proximitycares.ca>',
      to: psw_email,
      subject: `Your Pay Summary — ${month} ${year}`,
      html: pswHtml
    });

    await supabase.from('invoices').insert({
      operator_id: 'proximity-care',
      client_name,
      psw_name,
      month,
      year: parseInt(year),
      total_hours: roundedHours,
      client_rate: clientRate,
      psw_rate: pswRate,
      client_total: clientTotal,
      psw_total: pswTotal,
      profit,
      status: 'sent',
      sent_at: new Date().toISOString()
    });

    res.json({
      success: true,
      total_hours: roundedHours,
      client_total: clientTotal,
      psw_total: pswTotal,
      profit,
      visits_count: visits.length
    });

  } catch (err) {
    console.error('Invoice generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// SYSTEM 07 + 08 — Client Onboarding + Family Portal

// Verify family portal PIN
app.post('/family/verify-pin', async (req, res) => {
  try {
    const { slug, pin } = req.body;
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('portal_slug', slug)
      .eq('portal_pin', pin)
      .single();
    if (error || !client) return res.status(401).json({ error: 'Invalid PIN' });
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get full portal data
app.get('/family/portal/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: client } = await supabase.from('clients').select('*').eq('portal_slug', slug).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const fullName = `${client.first_name} ${client.last_name}`;

    const { data: visits } = await supabase.from('visits').select('*')
      .eq('operator_id', 'proximity-care')
      .eq('psw_name', 'Carolina Hermida')
      .order('visit_date', { ascending: false })
      .limit(30);

    const { data: invoices } = await supabase.from('invoices').select('*')
      .eq('operator_id', 'proximity-care')
      .eq('client_name', fullName)
      .order('sent_at', { ascending: false })
      .limit(6);

    const { data: documents } = await supabase.from('psw_documents').select('*')
      .eq('psw_name', 'Carolina Hermida')
      .order('uploaded_at', { ascending: false });

    const today = new Date().toISOString().slice(0, 10);
    const todayVisit = (visits || []).find(v => v.visit_date === today);

    res.json({
      success: true,
      client,
      psw: { name: 'Carolina Hermida', title: 'Personal Support Worker' },
      today_visit: todayVisit || null,
      visits: visits || [],
      invoices: invoices || [],
      documents: documents || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// End of day visit notification to family
app.post('/notify/visit-complete', async (req, res) => {
  try {
    const { slug, psw_name, hours_worked, visit_date, visit_notes } = req.body;
    const { data: client } = await supabase.from('clients').select('*').eq('portal_slug', slug).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const pswFirst = (psw_name || 'Your caregiver').split(' ')[0];
    const clientFirst = client.first_name;
    const hours = parseFloat(hours_worked || 0).toFixed(1);

    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:24px 36px;">
<p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#ffffff;">Proximity <strong>Care</strong></p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">Visit Complete</p>
</td></tr>
<tr><td style="padding:32px 36px;">
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">Hi Connie,</p>
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">${pswFirst} has completed today's visit with ${clientFirst}. Everything is logged and confirmed.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf6;border-radius:8px;border:1px solid #c8e6dc;margin-bottom:24px;">
<tr>
<td style="padding:16px 20px;text-align:center;border-right:1px solid #c8e6dc;">
<p style="margin:0;font-size:11px;color:#1a6b5a;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">PSW</p>
<p style="margin:4px 0 0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;font-weight:bold;">${pswFirst}</p>
</td>
<td style="padding:16px 20px;text-align:center;border-right:1px solid #c8e6dc;">
<p style="margin:0;font-size:11px;color:#1a6b5a;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Hours</p>
<p style="margin:4px 0 0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;font-weight:bold;">${hours} hrs</p>
</td>
<td style="padding:16px 20px;text-align:center;">
<p style="margin:0;font-size:11px;color:#1a6b5a;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Date</p>
<p style="margin:4px 0 0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;font-weight:bold;">${new Date(visit_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</p>
</td>
</tr>
</table>
<p style="margin:0 0 24px;font-size:15px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">You can view the full visit details, care plan, and history anytime in your family portal.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a6b5a;border-radius:6px;">
<a href="https://proximitycares.ca/family.html?c=rferrari" style="display:inline-block;padding:13px 24px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.04em;">View Family Portal →</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 36px 28px;">
<p style="margin:0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;">Warm regards,</p>
<p style="margin:4px 0 0;font-size:15px;color:#1a6b5a;font-family:Georgia,serif;font-weight:bold;">Lance Salazar</p>
<p style="margin:2px 0 0;font-size:12px;color:#888;font-family:Arial,sans-serif;">Proximity Care Services · 647-382-8047</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:16px 36px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;">Proximity Care Services Inc. · Mississauga, Ontario</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await resend.emails.send({
      from: 'Lance <hello@proximitycares.ca>',
      to: client.family_email,
      subject: `${pswFirst} completed today's visit — ${clientFirst} is all set`,
      html
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client onboarding — Day 0 welcome email
app.post('/client/onboard', async (req, res) => {
  try {
    const { slug } = req.body;
    const { data: client } = await supabase.from('clients').select('*').eq('portal_slug', slug).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const clientFirst = client.first_name;
    const pin = client.portal_pin;
    const portalUrl = `https://proximitycares.ca/family.html?c=${slug}`;

    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:28px 36px;">
<p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#ffffff;">Proximity <strong>Care</strong></p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">Welcome to the Family</p>
</td></tr>
<tr><td style="padding:36px 36px 24px;">
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">Hi Connie,</p>
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">Welcome to Proximity Care. We're really glad to have ${clientFirst} with us.</p>
<p style="margin:0 0 16px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">Carolina will be there Monday to Friday from 9am to 5pm. She's been briefed on ${clientFirst}'s care plan and knows exactly what to do.</p>
<p style="margin:0 0 28px;font-size:16px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">You have your own family portal where you can see every visit, the care plan, Carolina's credentials, and your monthly invoices. Here's how to get in.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf6;border-radius:8px;border:1px solid #c8e6dc;margin-bottom:28px;">
<tr><td style="padding:24px 28px;">
<p style="margin:0 0 6px;font-size:12px;color:#1a6b5a;font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;font-weight:bold;">Your Portal Access</p>
<p style="margin:0 0 16px;font-size:14px;color:#2c2c2c;font-family:Arial,sans-serif;">Go to your portal and enter this PIN when asked.</p>
<p style="margin:0 0 4px;font-size:13px;color:#888;font-family:Arial,sans-serif;">Your PIN</p>
<p style="margin:0 0 20px;font-size:36px;font-weight:600;color:#1a6b5a;font-family:'Courier New',monospace;letter-spacing:0.2em;">${pin}</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a6b5a;border-radius:6px;">
<a href="${portalUrl}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.04em;">Open Family Portal →</a>
</td></tr></table>
</td></tr>
</table>
<p style="margin:0 0 16px;font-size:15px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">After every visit you'll get a quick email letting you know Carolina has signed off. At the end of each month you'll get a care summary and invoice in one email.</p>
<p style="margin:0 0 28px;font-size:15px;color:#2c2c2c;line-height:1.75;font-family:Georgia,serif;">If you ever need anything just reply to this email or call me directly. I'm always reachable.</p>
</td></tr>
<tr><td style="padding:0 36px 32px;">
<p style="margin:0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;">Warm regards,</p>
<p style="margin:4px 0 2px;font-size:15px;color:#1a6b5a;font-family:Georgia,serif;font-weight:bold;">Lance Salazar</p>
<p style="margin:0;font-size:12px;color:#888;font-family:Arial,sans-serif;">Founder · Proximity Care Services · 647-382-8047</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:16px 36px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;">Proximity Care Services Inc. · Mississauga, Ontario</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await resend.emails.send({
      from: 'Lance <hello@proximitycares.ca>',
      to: client.family_email,
      subject: `Welcome to Proximity Care — here is how to get started`,
      html
    });

    res.json({ success: true, message: 'Welcome email sent', pin, portal_url: portalUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/family/message', async (req, res) => {
  try {
    const { slug, message } = req.body;
    const { data: client } = await supabase.from('clients').select('*').eq('portal_slug', slug).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background:#1a6b5a;padding:24px 36px;">
<p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#ffffff;">Proximity <strong>Care</strong></p>
<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">Message from Family Portal</p>
</td></tr>
<tr><td style="padding:32px 36px;">
<p style="margin:0 0 8px;font-size:13px;color:#888;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">From</p>
<p style="margin:0 0 24px;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;font-weight:bold;">Family of ${client.first_name} ${client.last_name}</p>
<p style="margin:0 0 8px;font-size:13px;color:#888;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Message</p>
<p style="margin:0;font-size:15px;color:#2c2c2c;font-family:Georgia,serif;line-height:1.75;background:#f9f7f3;padding:16px;border-radius:8px;border-left:3px solid #1a6b5a;">${message}</p>
</td></tr>
<tr><td style="background:#f9f9f6;padding:16px 36px;border-top:1px solid #eeede8;">
<p style="margin:0;font-size:11px;color:#aaa;font-family:Arial,sans-serif;">Proximity Care Services · Reply directly to this email to respond</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await resend.emails.send({
      from: 'Lance <hello@proximitycares.ca>',
      to: 'healthcareproximity@gmail.com',
      subject: `New message from ${client.first_name} ${client.last_name}'s family`,
      html
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PSW PRIVATE MESSAGES
// PIN and email now read from Supabase psws table — no more hardcoded objects

const TEST_MODE = false;
const TEST_EMAIL = 'lancesalazar56@gmail.com';

async function verifyPSW(psw_name, pin) {
  if (!psw_name || !pin) return false;
  const { data, error } = await supabase
    .from('psws')
    .select('pin')
    .eq('operator_id', 'proximity-care')
    .eq('full_name', psw_name)
    .eq('status', 'active')
    .single();
  if (error || !data) return false;
  return data.pin === pin;
}

async function getPSWEmail(psw_name) {
  if (!psw_name) return null;
  const { data, error } = await supabase
    .from('psws')
    .select('email')
    .eq('operator_id', 'proximity-care')
    .eq('full_name', psw_name)
    .single();
  if (error || !data) return null;
  return data.email || null;
}

app.post('/psw/note', async (req, res) => {
  try {
    const { psw_name, sender, message, pin } = req.body;
    if (!psw_name || !message || !sender) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (sender === 'psw') {
      const valid = await verifyPSW(psw_name, pin);
      if (!valid) return res.status(401).json({ error: 'Invalid PIN' });
    }
    const { data, error } = await supabase
      .from('psw_notes')
      .insert({ operator_id: 'proximity-care', psw_name, sender, message })
      .select()
      .single();
    if (error) throw error;

    // Log to system_logs
    await supabase.from('system_logs').insert({
      operator_id: 'proximity-care', event_type: 'psw_message',
      event_source: '/psw/note', contact_name: psw_name,
      payload: { sender, message }, status: 'success'
    }).catch(() => {});

    // EMAIL NOTIFICATION — PSW messages Lance
    if (sender === 'psw') {
      const pswEmail = await getPSWEmail(psw_name);
      const toEmail = TEST_MODE ? TEST_EMAIL : 'healthcareproximity@gmail.com';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'hello@proximitycares.ca',
          to: toEmail,
          reply_to: pswEmail || undefined,
          subject: `New message from ${psw_name}`,
          html: `
            <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;">
              <p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">PSW MESSAGE</p>
              <h2 style="font-family:Georgia,serif;font-size:22px;color:#0f2942;font-weight:400;margin-bottom:24px;">${psw_name} sent you a message</h2>
              <div style="background:#ffffff;border-left:3px solid #1a6b5a;padding:16px 20px;margin-bottom:24px;">
                <p style="font-size:15px;color:#333;line-height:1.7;margin:0;">${message}</p>
              </div>
              <p style="font-size:12px;color:#999;">Proximity Care Systems &mdash; PSW Messaging</p>
            </div>
          `
        })
      });
    }

    // EMAIL NOTIFICATION — Lance messages PSW
    if (sender === 'lance') {
      const pswEmail = await getPSWEmail(psw_name);
      if (pswEmail) {
        const toEmail = TEST_MODE ? TEST_EMAIL : pswEmail;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'hello@proximitycares.ca',
            to: toEmail,
            subject: `New message from Proximity Care`,
            html: `
              <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;">
                <p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">PROXIMITY CARE</p>
                <h2 style="font-family:Georgia,serif;font-size:22px;color:#0f2942;font-weight:400;margin-bottom:24px;">You have a new message</h2>
                <div style="background:#ffffff;border-left:3px solid #1a6b5a;padding:16px 20px;margin-bottom:24px;">
                  <p style="font-size:15px;color:#333;line-height:1.7;margin:0;">${message}</p>
                </div>
                <p style="font-size:13px;color:#555;margin-bottom:24px;">Log in to your portal to reply.</p>
                <a href="https://proximitycares.ca/psw-form.html" style="background:#1a6b5a;color:#ffffff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;display:inline-block;">Open Portal</a>
                <p style="font-size:12px;color:#999;margin-top:24px;">Proximity Care Services &mdash; Mississauga, ON</p>
              </div>
            `
          })
        });
      }
    }

    res.json({ success: true, note: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/psw/notes/:psw_name', async (req, res) => {
  try {
    const { psw_name } = req.params;
    const { pin } = req.query;
    const valid = await verifyPSW(psw_name, pin);
    if (!valid) return res.status(401).json({ error: 'Invalid PIN' });
    const { data, error } = await supabase
      .from('psw_notes')
      .select('*')
      .eq('operator_id', 'proximity-care')
      .eq('psw_name', psw_name)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, notes: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PSW FILE UPLOAD
app.post('/psw/upload', upload.single('file'), async (req, res) => {
  try {
    const { psw_name, pin } = req.body;
    if (!psw_name || !pin || !req.file) {
      return res.status(400).json({ error: 'Missing psw_name, pin, or file' });
    }
    const validUpload = await verifyPSW(psw_name, pin);
    if (!validUpload) return res.status(401).json({ error: 'Invalid PIN' });
    const folder = psw_name.replace(/\s+/g, '_').toLowerCase();
    const fileName = `${Date.now()}_${req.file.originalname}`;
    const filePath = `${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('psw-documents')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('psw-documents')
      .getPublicUrl(filePath);
    const fileUrl = urlData.publicUrl;

    const { data: doc, error: dbError } = await supabase
      .from('psw_documents')
      .insert({
        psw_name,
        file_name: req.file.originalname,
        file_url: fileUrl,
        document_type: 'upload',
        uploaded_at: new Date().toISOString()
      })
      .select()
      .single();
    if (dbError) throw dbError;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'hello@proximitycares.ca',
      to: 'healthcareproximity@gmail.com',
      subject: `New file from ${psw_name}`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;">
          <p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">PSW UPLOAD</p>
          <h2 style="font-family:Georgia,serif;font-size:22px;color:#0f2942;font-weight:400;margin-bottom:24px;">${psw_name} uploaded a file</h2>
          <div style="background:#ffffff;border-left:3px solid #1a6b5a;padding:16px 20px;margin-bottom:24px;">
            <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 12px;"><strong>File:</strong> ${req.file.originalname}</p>
            <a href="${fileUrl}" style="color:#1a6b5a;font-size:14px;">View File →</a>
          </div>
          <p style="font-size:12px;color:#999;">Proximity Care Services — PSW Portal</p>
        </div>
      `
    });

    res.json({ success: true, document: doc, file_url: fileUrl });
  } catch (err) {
    console.error('PSW upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════
// B. /webhook/purchase — logs all purchases to Supabase
// Handles WooCommerce, Thrivecart, Stripe, manual entry
// ══════════════════════════════════════════════════════

app.post('/webhook/purchase', async (req, res) => {
  try {
    const body = req.body;
    let operator_id, buyer_name, buyer_email, buyer_phone,
        product_name, product_label, amount_usd, source, source_order_id;

    if (body.billing && body.line_items) {
      source = 'woocommerce'; source_order_id = String(body.id || '');
      buyer_name = `${body.billing.first_name || ''} ${body.billing.last_name || ''}`.trim();
      buyer_email = body.billing.email || ''; buyer_phone = body.billing.phone || '';
      product_name = body.line_items.map(i => i.name).join(', ');
      amount_usd = parseFloat(body.total || 0); product_label = 'book'; operator_id = 'lcm-experts';
    } else if (body.thrivecart || body.event) {
      source = 'thrivecart'; const customer = body.customer || {};
      source_order_id = String(body.order_id || '');
      buyer_name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
      buyer_email = customer.email || ''; buyer_phone = customer.phone || '';
      product_name = body.product?.name || 'Course';
      amount_usd = parseFloat(body.order?.total || 0); product_label = 'course'; operator_id = 'lcm-experts';
    } else if (body.type?.startsWith('payment_intent') || body.object === 'checkout.session') {
      source = 'stripe'; const session = body.data?.object || body;
      source_order_id = session.id || ''; buyer_email = session.customer_details?.email || '';
      buyer_name = session.customer_details?.name || ''; buyer_phone = session.customer_details?.phone || '';
      product_name = session.metadata?.product_name || 'Stripe Purchase';
      amount_usd = (session.amount_total || 0) / 100;
      product_label = session.metadata?.product_label || 'other';
      operator_id = session.metadata?.operator_id || 'proximity-care';
    } else {
      source = 'manual'; operator_id = body.operator_id || 'proximity-care';
      buyer_name = body.buyer_name || ''; buyer_email = body.buyer_email || '';
      buyer_phone = body.buyer_phone || ''; product_name = body.product_name || '';
      product_label = body.product_label || 'other';
      amount_usd = parseFloat(body.amount_usd || 0); source_order_id = body.source_order_id || '';
    }

    if (!buyer_email || !product_name) return res.status(400).json({ error: 'Missing buyer_email or product_name' });

    const { data, error } = await supabase.from('purchases').insert({
      operator_id, buyer_name, buyer_email, buyer_phone,
      product_name, product_label, amount_usd, source, source_order_id, status: 'completed'
    }).select().single();
    if (error) throw error;

    await supabase.from('system_logs').insert({
      operator_id, event_type: 'purchase', event_source: '/webhook/purchase',
      contact_email: buyer_email, contact_name: buyer_name,
      payload: { product_name, product_label, amount_usd, source }, status: 'success'
    }).catch(() => {});

    res.json({ success: true, purchase: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════
// C. ONBOARDING EMAIL SEQUENCES
// ══════════════════════════════════════════════════════

async function sendSequenceEmail({ operator_id, contact_email, contact_name, day, sequence_type, subject, html }) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = operator_id === 'lcm-experts'
      ? 'Jennifer Crowley <hello@proximitycares.ca>'
      : 'Lance Salazar <hello@proximitycares.ca>';
    await resend.emails.send({ from, to: TEST_MODE ? TEST_EMAIL : contact_email, subject, html });
    const dayField = `day${day}_sent`, dayAtField = `day${day}_sent_at`;
    await supabase.from('onboarding_sequences')
      .update({ [dayField]: true, [dayAtField]: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('operator_id', operator_id).eq('contact_email', contact_email).eq('sequence_type', sequence_type);
    await supabase.from('system_logs').insert({
      operator_id, event_type: 'email_sent', event_source: `/onboarding/day${day}`,
      contact_email, contact_name, payload: { subject, sequence_type, day }, status: 'success'
    }).catch(() => {});
    return true;
  } catch (err) {
    await supabase.from('system_logs').insert({
      operator_id, event_type: 'email_sent', event_source: `/onboarding/day${day}`,
      contact_email, status: 'error', error_message: err.message
    }).catch(() => {});
    return false;
  }
}

function getLeadEmail(operator_id, day, contact_name) {
  const firstName = (contact_name || '').split(' ')[0] || 'there';
  if (operator_id === 'proximity-care') {
    if (day === 1) return { subject: 'Your free assessment is ready — Proximity Care', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Hi ${firstName}, we received your request.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Lance will be reaching out personally within 2 hours. No pressure, no contracts, and your first 6 hours are completely free.</p><p style="font-size:15px;color:#444;line-height:1.8;">Questions before then? Call or text Lance at <strong>647-382-8047</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
    if (day === 3) return { subject: 'Still thinking it over? Here is what families ask us first.', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Hi ${firstName}, still figuring things out?</h2><p style="font-size:15px;color:#444;line-height:1.8;">That is completely normal. Lance personally matches every client with a PSW based on personality, not just availability. Same person every visit so trust builds naturally. No contracts, no hassle. Most families are up and running within a week.</p><p style="font-size:15px;color:#444;line-height:1.8;">Your free 6 hours are still available. Call Lance at <strong>647-382-8047</strong> whenever you are ready.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
    if (day === 7) return { subject: 'Your 6 free hours are still waiting — Proximity Care', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Hi ${firstName}, no pressure at all.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Your 6 free hours are still available. No commitment, no contracts. When the time is right, Lance is one call away. <strong>647-382-8047</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
  }
  if (operator_id === 'lcm-experts') {
    if (day === 1) return { subject: 'What life care planning actually looks like for families', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Hi ${firstName}, thank you for reaching out.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Life care planning is about building a clear roadmap for aging so your family is never caught off guard. Jennifer has spent 32 years as a nurse and 19 years in practice doing exactly this. She wrote the book on it literally.</p><p style="font-size:15px;color:#444;line-height:1.8;">Questions? Reach Jennifer at <strong>(406) 212-0620</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
    if (day === 3) return { subject: 'The one question families always ask Jennifer before booking', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Hi ${firstName}, still thinking things through?</h2><p style="font-size:15px;color:#444;line-height:1.8;">The families who do this well start before there is a crisis. They build the roadmap while everyone is still healthy enough to have the real conversations. If you are asking the question, you are already ahead of most families.</p><p style="font-size:15px;color:#444;line-height:1.8;">Reach Jennifer at <strong>(406) 212-0620</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
    if (day === 7) return { subject: 'A free resource from Jennifer — your aging roadmap starter', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Hi ${firstName}, one last thing from Jennifer.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Her book "7 Steps to Long-Term Care Planning" is the clearest roadmap available for families navigating aging.</p><a href="https://thelifecareexperts.com/product/7-steps-to-long-term-care-planning/" style="display:inline-block;margin:16px 0;background:#155e75;color:#fff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Get the Book</a><p style="font-size:15px;color:#444;line-height:1.8;">And when you are ready to talk, Jennifer is at <strong>(406) 212-0620</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
  }
  return { subject: '', html: '' };
}

function getClientEmail(operator_id, day, contact_name, extra = {}) {
  const firstName = (contact_name || '').split(' ')[0] || 'there';
  if (operator_id === 'proximity-care') {
    if (day === 0) return { subject: 'Welcome to Proximity Care — your portal is ready', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Welcome, ${firstName}. You are all set.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Your family portal is live. Log in anytime to see visit notes, your care plan, documents, and billing.</p><p style="font-size:15px;color:#444;line-height:1.8;"><strong>Your portal PIN: ${extra.pin || '——'}</strong></p><a href="https://proximitycares.ca/family.html?slug=${extra.slug || ''}" style="display:inline-block;margin:16px 0;background:#1a6b5a;color:#fff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Open Your Portal</a><p style="font-size:15px;color:#444;line-height:1.8;">Any questions, call Lance at <strong>647-382-8047</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
    if (day === 3) return { subject: 'How is everything going? — Proximity Care', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Hi ${firstName}, just checking in.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Your first few visits are the most important ones. That is when your PSW learns your routines, your preferences, and what matters most. If anything feels off, reach Lance at <strong>647-382-8047</strong>.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
    if (day === 7) return { subject: 'Your first week summary — Proximity Care', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f3ee;border-top:3px solid #1a6b5a;"><p style="font-size:13px;color:#1a6b5a;letter-spacing:2px;text-transform:uppercase;">PROXIMITY CARE SERVICES</p><h2 style="font-size:24px;color:#0f2942;font-weight:400;margin:16px 0;">Hi ${firstName}, one week in.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Log in to your portal anytime to see visit notes, care plan updates, and documents from your team.</p><a href="https://proximitycares.ca/family.html?slug=${extra.slug || ''}" style="display:inline-block;margin:16px 0;background:#1a6b5a;color:#fff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">View Your Portal</a><p style="font-size:15px;color:#444;line-height:1.8;">As always, <strong>647-382-8047</strong> for anything urgent.</p><p style="font-size:13px;color:#999;margin-top:32px;">Proximity Care Services &mdash; Mississauga, Brampton, Caledon</p></div>` };
  }
  if (operator_id === 'lcm-experts') {
    if (day === 0) return { subject: 'Welcome — your client portal is ready', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Welcome, ${firstName}. Let us get started.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Your client portal is live. View your care plan, session notes, documents, and resources Jennifer has shared with you.</p><p style="font-size:15px;color:#444;line-height:1.8;"><strong>Your portal PIN: ${extra.pin || '——'}</strong></p><a href="${extra.portal_url || 'https://lcmexpert.com/portal'}" style="display:inline-block;margin:16px 0;background:#155e75;color:#fff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Open Your Portal</a><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
    if (day === 3) return { subject: 'Getting ready for your first session — LCM Experts', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Hi ${firstName}, your session is coming up.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Before your session, think through three things: what is the biggest concern your family has right now, what decisions have you been putting off, and what does a good outcome look like for you. You do not need answers. Just bring the questions.</p><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
    if (day === 7) return { subject: 'Your session summary and next steps — LCM Experts', html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-top:3px solid #155e75;"><p style="font-size:13px;color:#155e75;letter-spacing:2px;text-transform:uppercase;">THE LIFE CARE MANAGEMENT INSTITUTE</p><h2 style="font-size:24px;color:#0f2233;font-weight:400;margin:16px 0;">Hi ${firstName}, great work in your first session.</h2><p style="font-size:15px;color:#444;line-height:1.8;">Your care plan and session notes are now in your portal. Jennifer updates these after every session so you always have a clear record of where you are and what is next.</p><a href="${extra.portal_url || 'https://lcmexpert.com/portal'}" style="display:inline-block;margin:16px 0;background:#155e75;color:#fff;padding:12px 28px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">View Your Portal</a><p style="font-size:13px;color:#999;margin-top:32px;">The Life Care Management Institute &mdash; Kalispell, Montana</p></div>` };
  }
  return { subject: '', html: '' };
}

app.post('/onboarding/run-leads', async (req, res) => {
  try {
    const now = new Date();
    const results = { day1: 0, day3: 0, day7: 0, skipped: 0, errors: 0 };
    const { data: sequences, error } = await supabase.from('onboarding_sequences')
      .select('*').eq('sequence_type', 'lead').eq('status', 'active').eq('converted', false);
    if (error) throw error;
    for (const seq of sequences) {
      const hoursSince = (now - new Date(seq.created_at)) / 1000 / 60 / 60;
      if (!seq.day1_sent && hoursSince >= 1) {
        const { subject, html } = getLeadEmail(seq.operator_id, 1, seq.contact_name);
        const sent = await sendSequenceEmail({ ...seq, day: 1, sequence_type: 'lead', subject, html });
        sent ? results.day1++ : results.errors++;
      } else if (seq.day1_sent && !seq.day3_sent && hoursSince >= 72) {
        const { subject, html } = getLeadEmail(seq.operator_id, 3, seq.contact_name);
        const sent = await sendSequenceEmail({ ...seq, day: 3, sequence_type: 'lead', subject, html });
        sent ? results.day3++ : results.errors++;
      } else if (seq.day3_sent && !seq.day7_sent && hoursSince >= 168) {
        const { subject, html } = getLeadEmail(seq.operator_id, 7, seq.contact_name);
        const sent = await sendSequenceEmail({ ...seq, day: 7, sequence_type: 'lead', subject, html });
        sent ? results.day7++ : results.errors++;
        await supabase.from('onboarding_sequences').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', seq.id);
      } else { results.skipped++; }
    }
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/onboarding/run-clients', async (req, res) => {
  try {
    const now = new Date();
    const results = { day0: 0, day3: 0, day7: 0, skipped: 0, errors: 0 };
    const { data: sequences, error } = await supabase.from('onboarding_sequences')
      .select('*').eq('sequence_type', 'client').eq('status', 'active');
    if (error) throw error;
    for (const seq of sequences) {
      const hoursSince = (now - new Date(seq.created_at)) / 1000 / 60 / 60;
      if (!seq.day0_sent) {
        const { subject, html } = getClientEmail(seq.operator_id, 0, seq.contact_name, seq.extra || {});
        const sent = await sendSequenceEmail({ ...seq, day: 0, sequence_type: 'client', subject, html });
        sent ? results.day0++ : results.errors++;
      } else if (seq.day0_sent && !seq.day3_sent && hoursSince >= 72) {
        const { subject, html } = getClientEmail(seq.operator_id, 3, seq.contact_name, seq.extra || {});
        const sent = await sendSequenceEmail({ ...seq, day: 3, sequence_type: 'client', subject, html });
        sent ? results.day3++ : results.errors++;
      } else if (seq.day3_sent && !seq.day7_sent && hoursSince >= 168) {
        const { subject, html } = getClientEmail(seq.operator_id, 7, seq.contact_name, seq.extra || {});
        const sent = await sendSequenceEmail({ ...seq, day: 7, sequence_type: 'client', subject, html });
        sent ? results.day7++ : results.errors++;
        await supabase.from('onboarding_sequences').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', seq.id);
      } else { results.skipped++; }
    }
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/onboarding/convert', async (req, res) => {
  try {
    const { operator_id, contact_email } = req.body;
    if (!operator_id || !contact_email) return res.status(400).json({ error: 'Missing fields' });
    await supabase.from('onboarding_sequences')
      .update({ converted: true, converted_at: new Date().toISOString(), status: 'completed', updated_at: new Date().toISOString() })
      .eq('operator_id', operator_id).eq('contact_email', contact_email).eq('sequence_type', 'lead');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════
// D. HQ DASHBOARD DATA ENDPOINTS
// ══════════════════════════════════════════════════════

app.get('/hq/overview', async (req, res) => {
  try {
    const operator_id = req.query.operator_id || 'proximity-care';
    const [leadsResult, clientsResult, bookingsResult, purchasesResult, messagesResult, logsResult] = await Promise.all([
      supabase.from('leads').select('id,first_name,last_name,email,phone,status,care_type_interest,source,created_at').eq('operator_id', operator_id).order('created_at', { ascending: false }).limit(50),
      supabase.from('clients').select('id,first_name,last_name,email,slug,status,created_at').eq('operator_id', operator_id).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('bookings').select('*').eq('operator_id', operator_id).gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date', { ascending: true }).limit(20),
      supabase.from('purchases').select('*').eq('operator_id', operator_id).order('purchased_at', { ascending: false }).limit(20),
      supabase.from('system_logs').select('*').eq('operator_id', operator_id).eq('event_type', 'family_message').order('created_at', { ascending: false }).limit(10),
      supabase.from('system_logs').select('event_type,event_source,contact_name,contact_email,status,created_at').eq('operator_id', operator_id).order('created_at', { ascending: false }).limit(20)
    ]);
    res.json({
      success: true, operator_id,
      leads: leadsResult.data || [], clients: clientsResult.data || [],
      bookings: bookingsResult.data || [], purchases: purchasesResult.data || [],
      messages: messagesResult.data || [], recent_activity: logsResult.data || [],
      counts: { leads: leadsResult.data?.length || 0, clients: clientsResult.data?.length || 0, bookings_upcoming: bookingsResult.data?.length || 0, purchases_total: purchasesResult.data?.length || 0 }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/hq/lead-status', async (req, res) => {
  try {
    const { lead_id, status, operator_id } = req.body;
    if (!lead_id || !status) return res.status(400).json({ error: 'Missing lead_id or status' });
    const validStatuses = ['new', 'contacted', 'booked', 'converted', 'dead'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { error } = await supabase.from('leads').update({ status, updated_at: new Date().toISOString() }).eq('id', lead_id);
    if (error) throw error;
    if (status === 'converted') {
      const { data: lead } = await supabase.from('leads').select('email').eq('id', lead_id).single();
      if (lead?.email) {
        await supabase.from('onboarding_sequences')
          .update({ converted: true, converted_at: new Date().toISOString(), status: 'completed', updated_at: new Date().toISOString() })
          .eq('operator_id', operator_id || 'proximity-care').eq('contact_email', lead.email).eq('sequence_type', 'lead');
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/hq/booking', async (req, res) => {
  try {
    const { operator_id, client_name, client_email, client_phone, booking_type, scheduled_date, scheduled_time, duration_minutes, assigned_to, location, notes } = req.body;
    if (!operator_id || !client_name || !scheduled_date || !scheduled_time || !booking_type) return res.status(400).json({ error: 'Missing required fields' });
    const { data, error } = await supabase.from('bookings').insert({
      operator_id, client_name, client_email, client_phone, booking_type,
      scheduled_date, scheduled_time, duration_minutes: duration_minutes || 60,
      assigned_to, location, notes, status: 'scheduled'
    }).select().single();
    if (error) throw error;
    await supabase.from('system_logs').insert({
      operator_id, event_type: 'booking_created', event_source: '/hq/booking',
      contact_name: client_name, contact_email: client_email,
      payload: { booking_type, scheduled_date, scheduled_time }, status: 'success'
    }).catch(() => {});
    res.json({ success: true, booking: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proximity Agent running on port ${PORT}`));
