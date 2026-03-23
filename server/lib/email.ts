import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "AI Trip <noreply@aitrip.app>";

export async function sendTripInviteEmail(params: {
  to: string;
  inviterName: string;
  tripDestination: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}) {
  const expiresFormatted = params.expiresAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  await getResend().emails.send({
    from: FROM_EMAIL,
    to: params.to,
    subject: `${params.inviterName} invited you to plan a trip to ${params.tripDestination}`,
    html: `
      <div style="font-family: 'DM Sans', system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #3d3328; font-size: 22px; margin: 0;">You're invited!</h2>
        <p style="color: #6e5c46; font-size: 15px; line-height: 1.6; margin-top: 12px;">
          <strong>${params.inviterName}</strong> invited you as <strong>${params.role}</strong>
          to collaborate on a trip to <strong>${params.tripDestination}</strong>.
        </p>
        <a href="${params.acceptUrl}"
           style="display: inline-block; background: #e85d3a; color: white; text-decoration: none;
                  padding: 12px 28px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-top: 20px;">
          Accept Invite
        </a>
        <p style="color: #6e5c46; font-size: 13px; margin-top: 20px; line-height: 1.5;">
          Click the button above to join. If you don't have an account yet,
          you'll be asked to sign in with Google first — use this email address
          (<strong>${params.to}</strong>).
        </p>
        <p style="color: #b8a78f; font-size: 12px; margin-top: 16px;">
          This invite expires on ${expiresFormatted}.
        </p>
      </div>
    `,
  });
}
