// Server-only SMS transport. Twilio creds are read per-request (Workers bind env at request time).
// Failures NEVER stall a pipeline — callers get a status object, not an exception.

export type SmsResult = { ok: boolean; status: string; detail?: string };

export function twilioConfigured(): boolean {
  return Boolean(
    process.env["TWILIO_ACCOUNT_SID"] &&
      process.env["TWILIO_AUTH_TOKEN"] &&
      process.env["TWILIO_FROM_NUMBER"],
  );
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!sid || !token || !from) {
    return { ok: false, status: "not_configured", detail: "Twilio credentials missing" };
  }
  if (!/^\+\d{8,16}$/.test(to)) {
    return { ok: false, status: "invalid_number", detail: "Destination must be E.164 (+15551234567)" };
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1500) }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error(`[sendSms] twilio ${res.status}: ${text}`);
      return { ok: false, status: `twilio_${res.status}`, detail: text.slice(0, 300) };
    }
    return { ok: true, status: "sent" };
  } catch (e) {
    console.error("[sendSms] transport failure", e);
    return { ok: false, status: "transport_error", detail: (e as Error).message };
  }
}
