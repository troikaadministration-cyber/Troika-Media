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
    // Auth: validate user + require coordinator role
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabaseAuth = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Role check: only coordinators can generate invoices
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "coordinator") {
      return new Response(
        JSON.stringify({ error: "Only coordinators can generate invoices" }),
        {
          status: 403,
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        }
      );
    }

    const { payment_id } = await req.json();
    if (!payment_id) {
      return new Response(
        JSON.stringify({ error: "payment_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        }
      );
    }

    // Idempotency: check if invoice already exists for this payment
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id, invoice_number, pdf_path")
      .eq("payment_id", payment_id)
      .single();

    if (existingInvoice) {
      const { data: signedUrl } = await supabase.storage
        .from("invoices")
        .createSignedUrl(existingInvoice.pdf_path || "", 3600);
      return new Response(
        JSON.stringify({
          invoice_id: existingInvoice.id,
          invoice_number: existingInvoice.invoice_number,
          pdf_url: signedUrl?.signedUrl || null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        }
      );
    }

    // 1. Fetch payment with student and enrolment details
    const { data: payment, error: payErr } = await supabase
      .from("payment_records")
      .select(
        `
        *,
        student:students(
          id, full_name, email, parent_email,
          instrument:instruments(name),
          location:locations(name)
        )
      `
      )
      .eq("id", payment_id)
      .single();

    if (payErr || !payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        {
          status: 404,
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        }
      );
    }

    // Set verified fields on payment record
    await supabase
      .from("payment_records")
      .update({
        paid_date: payment.paid_date || new Date().toISOString().split("T")[0],
        verified_at: new Date().toISOString(),
        verified_by: user.id,
      })
      .eq("id", payment_id);

    // 2. Fetch enrolments for this student (current academic year — may have multiple)
    const currentYear = new Date().getFullYear().toString();
    const { data: enrolmentList } = await supabase
      .from("student_enrolments")
      .select("*, lesson_rate:lesson_rates(category, rate_per_lesson)")
      .eq("student_id", payment.student_id)
      .eq("academic_year", currentYear);
    const enrolment = enrolmentList?.[0] || null;

    // 3. Get total instalments for this plan
    const { count: totalInstalments } = await supabase
      .from("payment_records")
      .select("id", { count: "exact", head: true })
      .eq("student_id", payment.student_id)
      .eq("plan", payment.plan);

    // 4. Generate invoice number
    const { data: invoiceNumber } = await supabase.rpc("next_invoice_number");

    // 5. Build invoice HTML
    const studentName = payment.student?.full_name || "Student";
    const instrumentName = payment.student?.instrument?.name || "";
    const locationName = payment.student?.location?.name || "";
    const lessonCategory =
      enrolment?.lesson_rate?.category?.replace(/_/g, " ") || "";
    const ratePerLesson = enrolment?.rate_per_lesson || "";
    const lessonsRemaining = enrolment
      ? enrolment.total_lessons - enrolment.lessons_used
      : "";
    const lessonsCompleted = enrolment ? enrolment.lessons_used : "";
    const planLabel = payment.plan?.replace(/_/g, " ");

    // Build multi-enrolment summary if more than one
    const multiEnrolmentHtml = (enrolmentList && enrolmentList.length > 1)
      ? enrolmentList.map((e: any) => {
          const cat = e.lesson_rate?.category?.replace(/_/g, " ") || "General";
          return `<tr><td style="padding:6px 0;font-size:13px;">${cat}</td><td style="padding:6px 0;font-size:13px;text-align:right;">${e.lessons_used} / ${e.total_lessons}</td></tr>`;
        }).join("")
      : "";
    const issuedDate = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

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
    .invoice-label { font-size: 32px; font-weight: 300; color: #999; text-align: right; }
    .invoice-number { font-size: 14px; color: #666; text-align: right; margin-top: 4px; }
    .details { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .details-col { font-size: 13px; line-height: 1.8; }
    .details-col strong { display: block; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f8f9fa; text-align: left; padding: 12px 16px; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; border-bottom: 2px solid #eee; }
    td { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .amount { text-align: right; font-weight: 600; font-size: 15px; }
    .total-row td { border-top: 2px solid #1a1a2e; font-weight: 700; font-size: 16px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
    .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">troika <span>music</span></div>
      <p style="font-size:12px;color:#999;margin-top:4px;">Music Education</p>
    </div>
    <div>
      <div class="invoice-label">INVOICE</div>
      <div class="invoice-number">${invoiceNumber}</div>
      <div class="invoice-number">${issuedDate}</div>
    </div>
  </div>

  <div class="details">
    <div class="details-col">
      <strong>Bill To</strong>
      ${studentName}<br/>
      ${instrumentName ? instrumentName + "<br/>" : ""}
      ${locationName ? locationName : ""}
    </div>
    <div class="details-col" style="text-align:right;">
      <strong>Payment Details</strong>
      <span style="font-size:15px;font-weight:600;color:#1a1a2e;">Plan: ${planLabel}</span><br/>
      Instalment: ${payment.instalment_number} of ${totalInstalments || payment.instalment_number}<br/>
      Academic Year: ${enrolment?.academic_year || currentYear}
      ${lessonsCompleted !== "" ? "<br/>Lessons Completed: <strong>" + lessonsCompleted + "</strong>" : ""}
      ${lessonsRemaining !== "" ? "<br/>Lessons Remaining: <strong>" + lessonsRemaining + "</strong> / " + (enrolment?.total_lessons || 39) : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          ${lessonCategory ? lessonCategory + " — " : ""}${instrumentName ? instrumentName + " lessons" : "Music lessons"}<br/>
          <span style="font-size:12px;color:#999;">
            ${ratePerLesson ? "Rate: ₹" + Number(ratePerLesson).toLocaleString("en-IN") + "/lesson" : ""}
            ${enrolment ? " × " + enrolment.total_lessons + " lessons" : ""}
          </span>
        </td>
        <td class="amount">₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td>Total <span class="badge">PAID</span></td>
        <td class="amount">₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
    </tfoot>
  </table>

  ${multiEnrolmentHtml ? `
  <div style="margin-top:20px;">
    <h3 style="font-size:13px;text-transform:uppercase;color:#999;letter-spacing:0.5px;margin-bottom:8px;">Enrolment Progress</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="text-align:left;font-size:11px;text-transform:uppercase;color:#999;padding:6px 0;border-bottom:1px solid #eee;">Category</th><th style="text-align:right;font-size:11px;text-transform:uppercase;color:#999;padding:6px 0;border-bottom:1px solid #eee;">Used / Total</th></tr></thead>
      <tbody>${multiEnrolmentHtml}</tbody>
    </table>
  </div>
  ` : ""}

  <div class="footer">
    Troika Music · Thank you for your payment<br/>
    This is a system-generated invoice.
  </div>
</body>
</html>`;

    // 6. Store as PDF-ready HTML — sanitize filename
    const safeInvoiceNumber = (invoiceNumber || "UNKNOWN").replace(
      /[^a-zA-Z0-9\-]/g,
      ""
    );
    const pdfContent = new TextEncoder().encode(html);
    const fileName = `${safeInvoiceNumber}.html`;
    const storagePath = `${currentYear}/${fileName}`;

    // Upload to storage
    const { error: uploadErr } = await supabase.storage
      .from("invoices")
      .upload(storagePath, pdfContent, {
        contentType: "text/html",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Upload error:", uploadErr);
    }

    // 7. Build email recipients
    const emailRecipients: string[] = [];
    if (payment.student?.email) emailRecipients.push(payment.student.email);
    if (payment.student?.parent_email)
      emailRecipients.push(payment.student.parent_email);
    const emailedTo = emailRecipients.join(", ");

    // 8. Insert invoice record
    const description = `${planLabel} — Instalment ${payment.instalment_number}/${totalInstalments || payment.instalment_number} — ${instrumentName || "Music"} lessons`;
    const { data: invoice, error: insertErr } = await supabase
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        payment_id: payment_id,
        student_id: payment.student_id,
        amount: payment.amount,
        currency: "INR",
        description,
        issued_date: new Date().toISOString().split("T")[0],
        pdf_path: storagePath,
        emailed_to: emailedTo || null,
        emailed_at: emailRecipients.length > 0 ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // 9. Send email via Resend (if API key configured and recipients exist)
    if (resendApiKey && emailRecipients.length > 0) {
      try {
        const emailHtml = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#1a1a2e;">Invoice ${invoiceNumber}</h2>
            <p>Dear ${studentName},</p>
            <p>Your payment of <strong>₹${Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong> has been received and verified.</p>
            <p>Invoice Number: <strong>${invoiceNumber}</strong><br/>
            Plan: ${planLabel}<br/>
            Instalment: ${payment.instalment_number} of ${totalInstalments || payment.instalment_number}</p>
            ${lessonsRemaining !== "" ? `<p>Lessons remaining this year: <strong>${lessonsRemaining} / ${enrolment?.total_lessons || 39}</strong></p>` : ""}
            <p>Please find your invoice attached to this email.</p>
            <p style="color:#999;font-size:12px;margin-top:30px;">Troika Music · System-generated invoice</p>
          </div>`;

        const htmlBase64 = btoa(html);

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Troika Music <invoices@troikamusic.in>",
            to: emailRecipients,
            subject: `Invoice ${invoiceNumber} — Troika Music`,
            html: emailHtml,
            attachments: [
              {
                filename: `${safeInvoiceNumber}.html`,
                content: htmlBase64,
              },
            ],
          }),
        });
      } catch (emailErr) {
        console.error("Email send error:", emailErr);
        // Non-fatal: invoice is still created even if email fails
      }
    }

    // 10. Generate signed download URL
    const { data: signedUrl } = await supabase.storage
      .from("invoices")
      .createSignedUrl(storagePath, 3600);

    return new Response(
      JSON.stringify({
        invoice_id: invoice.id,
        invoice_number: invoiceNumber,
        pdf_url: signedUrl?.signedUrl || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: (err as Error).message === "Unauthorized" ? 401 : 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
