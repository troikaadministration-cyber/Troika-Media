// Supabase Edge Function: Send payment reminder email with invoice PDF

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigin && origin === allowedOrigin ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabaseAuth = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "coordinator") throw new Error("Unauthorized");

    const { payment_id } = await req.json();
    if (!payment_id) throw new Error("payment_id required");

    // Fetch payment with student details
    const { data: payment, error: payErr } = await supabase
      .from("payment_records")
      .select(`
        *,
        student:students(
          id, full_name, email, parent_email,
          instrument:instruments(name),
          location:locations(name, address)
        )
      `)
      .eq("id", payment_id)
      .single();

    if (payErr || !payment) throw new Error("Payment not found");

    const student = payment.student;
    const studentName = student?.full_name || "Student";
    const instrumentName = student?.instrument?.name || "";

    // Get total instalments count for this student/plan
    const { count: totalInstalments } = await supabase
      .from("payment_records")
      .select("id", { count: "exact", head: true })
      .eq("student_id", payment.student_id)
      .eq("plan", payment.plan);

    // Get enrolment details
    const currentYear = new Date().getFullYear().toString();
    const { data: enrolmentList } = await supabase
      .from("student_enrolments")
      .select("*, lesson_rate:lesson_rates(category, rate_per_lesson)")
      .eq("student_id", payment.student_id)
      .eq("academic_year", currentYear);
    const enrolment = enrolmentList?.[0] || null;

    const planLabel = (payment.plan || "").replace(/_/g, " ");
    const dueDate = new Date(payment.due_date + "T00:00:00").toLocaleDateString("en-IN", {
      day: "2-digit", month: "long", year: "numeric",
    });
    const issuedDate = new Date().toLocaleDateString("en-IN", {
      day: "2-digit", month: "long", year: "numeric",
    });
    const lessonCategory = enrolment?.lesson_rate?.category?.replace(/_/g, " ") || "";
    const lessonsRemaining = enrolment ? enrolment.total_lessons - enrolment.lessons_used : "";

    // Build reminder invoice HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .logo { font-size: 28px; font-weight: bold; color: #1a1a2e; }
    .logo span { color: #2d9596; }
    .invoice-label { font-size: 28px; font-weight: 300; color: #e05c5c; text-align: right; }
    .invoice-sub { font-size: 13px; color: #666; text-align: right; margin-top: 4px; }
    .due-badge { display: inline-block; background: #fef3f2; color: #e05c5c; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; border: 1px solid #fecaca; margin-top: 6px; }
    .details { display: flex; justify-content: space-between; margin-bottom: 30px; gap: 20px; }
    .details-col { font-size: 13px; line-height: 1.8; }
    .details-col strong { display: block; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f8f9fa; text-align: left; padding: 12px 16px; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; border-bottom: 2px solid #eee; }
    td { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .amount { text-align: right; font-weight: 600; font-size: 15px; }
    .total-row td { border-top: 2px solid #1a1a2e; font-weight: 700; font-size: 16px; padding: 16px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
    .note { background: #fef3f2; border-left: 3px solid #e05c5c; padding: 12px 16px; font-size: 13px; margin-bottom: 24px; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">troika <span>music</span></div>
      <p style="font-size:12px;color:#999;margin-top:4px;">Music Education</p>
    </div>
    <div style="text-align:right;">
      <div class="invoice-label">PAYMENT REMINDER</div>
      <div class="invoice-sub">Issued: ${issuedDate}</div>
      <div class="due-badge">Due: ${dueDate}</div>
    </div>
  </div>

  <div class="note">
    This is a friendly reminder that instalment <strong>#${payment.instalment_number}</strong> of your music lesson fees is due on <strong>${dueDate}</strong>. Please arrange payment at your earliest convenience.
  </div>

  <div class="details">
    <div class="details-col">
      <strong>Bill To</strong>
      ${studentName}<br/>
      ${instrumentName ? instrumentName + "<br/>" : ""}
      ${student?.location?.name ? student.location.name : ""}
    </div>
    <div class="details-col" style="text-align:right;">
      <strong>Payment Details</strong>
      <span style="font-weight:600;">Plan: ${planLabel}</span><br/>
      Instalment: ${payment.instalment_number} of ${totalInstalments || payment.instalment_number}<br/>
      Academic Year: ${enrolment?.academic_year || currentYear}
      ${lessonsRemaining !== "" ? "<br/>Lessons Remaining: <strong>" + lessonsRemaining + " / " + (enrolment?.total_lessons || 39) + "</strong>" : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right;">Amount Due</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          ${lessonCategory ? lessonCategory + " — " : ""}${instrumentName ? instrumentName + " lessons" : "Music lessons"}<br/>
          <span style="font-size:12px;color:#999;">Instalment ${payment.instalment_number} of ${totalInstalments || payment.instalment_number} · Academic Year ${enrolment?.academic_year || currentYear}</span>
        </td>
        <td class="amount">₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td>Total Due by ${dueDate}</td>
        <td class="amount" style="color:#e05c5c;">₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    Troika Music · This is a payment reminder<br/>
    Please contact us if you have any questions about this invoice.
  </div>
</body>
</html>`;

    // Mark reminder sent in DB
    await supabase.from("payment_records").update({ reminder_sent: true }).eq("id", payment_id);

    // Build recipient list
    const emailRecipients: string[] = [];
    if (student?.email) emailRecipients.push(student.email);
    if (student?.parent_email) emailRecipients.push(student.parent_email);

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ success: true, emailed: false, reason: "RESEND_API_KEY not configured" }),
        { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    if (emailRecipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, emailed: false, reason: "No email address on record for this student" }),
        { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Attach as HTML file (named as .html — renders like a PDF in email clients)
    const htmlBase64 = btoa(unescape(encodeURIComponent(html)));
    const safeStudentName = studentName.replace(/[^a-zA-Z0-9]/g, "_");

    const emailHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#1a1a2e;">Payment Reminder — Troika Music</h2>
        <p>Dear ${studentName},</p>
        <p>This is a friendly reminder that your upcoming music lesson payment is due.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f8f9fa;border-radius:8px;">
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;">Instalment</td><td style="padding:10px 16px;font-size:13px;font-weight:600;">#${payment.instalment_number} of ${totalInstalments || payment.instalment_number}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;">Amount Due</td><td style="padding:10px 16px;font-size:15px;font-weight:700;color:#e05c5c;">₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;">Due Date</td><td style="padding:10px 16px;font-size:13px;font-weight:600;">${dueDate}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;">Plan</td><td style="padding:10px 16px;font-size:13px;">${planLabel}</td></tr>
        </table>
        <p style="font-size:13px;">The full invoice is attached to this email for your records.</p>
        <p style="font-size:13px;">Please contact us if you have any questions.</p>
        <p style="color:#999;font-size:12px;margin-top:30px;">Troika Music · This is an automated reminder</p>
      </div>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Troika Music <reminders@troikamusic.in>",
        to: emailRecipients,
        subject: `Payment Reminder — ₹${Number(payment.amount).toLocaleString("en-IN")} due ${dueDate}`,
        html: emailHtml,
        attachments: [
          {
            filename: `Troika_Invoice_Reminder_${safeStudentName}_Instalment${payment.instalment_number}.html`,
            content: htmlBase64,
          },
        ],
      }),
    });

    const emailResult = await emailRes.json();

    return new Response(
      JSON.stringify({ success: true, emailed: emailRes.ok, to: emailRecipients, resend: emailResult }),
      { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-payment-reminder error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: (err as Error).message === "Unauthorized" ? 401 : 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
