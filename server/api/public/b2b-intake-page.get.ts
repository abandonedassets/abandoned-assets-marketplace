export default defineEventHandler((event) => {
  setHeader(event, "content-type", "text/html; charset=utf-8");
  setHeader(event, "cache-control", "no-store");
  setHeader(event, "x-content-type-options", "nosniff");
  setHeader(event, "x-frame-options", "DENY");

  const serverUrl = process.env.SUPABASE_URL?.trim() || "";
  const browserUrl = process.env.VITE_SUPABASE_URL?.trim() || "";
  let urlMismatch = false;
  if (serverUrl && browserUrl) {
    try { urlMismatch = new URL(serverUrl).origin !== new URL(browserUrl).origin; }
    catch { urlMismatch = true; }
  }
  const config = JSON.stringify({
    url: urlMismatch ? "" : (browserUrl || serverUrl),
    urlMismatch,
    key:
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      "",
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>B2B Corporate Debt Intake</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #101318; color: #eef1f5; }
    main { max-width: 780px; margin: 0 auto; padding: 28px 16px 60px; }
    h1 { font-size: 1.8rem; margin-bottom: 8px; }
    p, .muted { color: #aab3c0; line-height: 1.5; }
    section, form, .notice { border: 1px solid #39414c; border-radius: 10px; padding: 18px; margin-top: 18px; }
    label { display: block; font-size: .9rem; margin-bottom: 14px; }
    input, textarea, select { box-sizing: border-box; display: block; width: 100%; margin-top: 6px; padding: 10px; border: 1px solid #46505e; border-radius: 6px; color: inherit; background: #181d24; }
    input[type="checkbox"] { display: inline-block; width: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 12px; }
    button, a.link { display: inline-block; padding: 10px 14px; border-radius: 6px; border: 1px solid #64748b; color: #fff; background: #293548; cursor: pointer; text-decoration: none; margin-right: 8px; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .error { color: #ffb4b4; }
    .success { color: #a7f3d0; }
    [hidden] { display: none !important; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
<main>
  <a class="link" href="/">← Marketplace</a>
  <h1>B2B Corporate Debt Intake</h1>
  <p>Evidence-first intake for one corporate invoice or contract. Submission creates a review record only; it does not establish ownership, assignability, collectibility, or funds availability.</p>
  <div class="notice"><strong>Recognition boundary:</strong> recognized amount and available funds remain $0. No payment or external execution is triggered by this form.</div>

  <section id="login-panel">
    <h2>Administrator sign-in</h2>
    <p class="muted">Use your existing application account. Administrator authorization is checked before intake.</p>
    <form id="login-form">
      <label>Email<input id="email" type="email" autocomplete="username" required></label>
      <label>Password<input id="password" type="password" autocomplete="current-password" required></label>
      <button id="login-button" type="submit">Sign in and verify admin access</button>
    </form>
  </section>

  <section id="intake-panel" hidden>
    <div class="grid">
      <div><strong>Access</strong><p class="success">Administrator verified</p></div>
      <div><button id="signout-button" type="button">Sign out</button></div>
    </div>
    <div id="pending-notice" class="notice" hidden>A previous submission may have reached the server. Check its durable status before retrying. If the document is not linked, reattach the same original file and use exactly the same metadata.<p><button id="check-status-button" type="button">Check previous submission status</button></p></div>
    <form id="intake-form">
      <div class="grid">
        <label>Creditor EIN<input id="creditor-ein" required autocomplete="off" placeholder="12-3456789"></label>
        <label>Debtor EIN<input id="debtor-ein" required autocomplete="off" placeholder="98-7654321"></label>
        <label>Invoice face value (USD)<input id="face-value" required type="number" min="0.01" step="0.01"></label>
        <label>Payment terms<select id="terms"><option>NET-0</option><option>NET-15</option><option selected>NET-30</option><option>NET-45</option><option>NET-60</option><option>NET-90</option><option>OTHER_DOCUMENTED</option></select></label>
        <label>Maturity / due date<input id="maturity" required type="date"></label>
      </div>
      <label><input id="assignment-clause" type="checkbox"> Assignment clause appears in the source document</label>
      <label>Assignment-evidence reference<input id="assignment-ref" required placeholder="Document section, clause, or evidence identifier"></label>
      <label>Source provenance<textarea id="provenance" required rows="3" placeholder="Where the document came from and how it was obtained"></textarea></label>
      <label>Original invoice or contract<input id="document" required type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.txt,.doc,.docx"></label>
      <p class="muted">Maximum file size: 15 MB. A successful submission stores the original document and records it for review.</p>
      <button id="submit-button" type="submit">Submit claim for review</button>
      <button id="clear-button" type="button">Clear form / start new claim</button>
    </form>
    <div id="status" class="notice" role="status" hidden></div>
    <section id="result" hidden>
      <h2>Intake response</h2>
      <p>Claim ID: <code id="claim-id"></code></p>
      <p>Document object ID: <code id="document-object-id"></code></p>
      <p>SHA-256: <code id="document-hash"></code></p>
      <p>Recognized / available: $0.00 / $0.00</p>
      <p class="muted">Storage and intake do not establish ownership, enforceability, collectibility, or settlement.</p>
    </section>
  </section>
</main>
<script>
const CONFIG = ${config};
let accessToken = "";
let currentUserId = "";
let successfulSubmission = false;
const STORAGE_KEY = "b2b-intake-idempotency";
const byId = (id) => document.getElementById(id);
function showStatus(message, kind) {
  const node = byId("status");
  node.textContent = message;
  node.className = "notice " + (kind || "");
  node.hidden = false;
}
function readPendingKey(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw);
    return value.userId === userId && typeof value.key === "string" ? value.key : "";
  } catch { return ""; }
}
function storePendingKey(userId, key) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, key })); } catch {}
}
function clearPendingKey(userId, key) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw);
      if (value.userId !== userId || value.key !== key) return;
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
function updatePendingUI() {
  const pending = readPendingKey(currentUserId);
  byId("pending-notice").hidden = !pending;
  byId("check-status-button").hidden = !pending;
  byId("clear-button").disabled = Boolean(pending);
  byId("clear-button").textContent = pending ? "Resolve pending submission first" : "Clear form / start new claim";
}
async function checkPendingStatus() {
  const key = readPendingKey(currentUserId);
  if (!accessToken || !currentUserId || !key) {
    showStatus("Sign in and select a pending submission first.", "error");
    return;
  }
  byId("check-status-button").disabled = true;
  try {
    const response = await fetch("/api/private/b2b-intake", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "status", idempotency_key: key }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "STATUS_LOOKUP_FAILED");
    if (body.found !== true) {
      showStatus("No claim record exists for this retry key yet. The key is retained. Re-submit the same metadata and original file to safely retry.", "error");
      return;
    }
    if (body.document_linked === true &&
        typeof body.claim_id === "string" &&
        typeof body.document_object_id === "string" &&
        typeof body.document_sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(body.document_sha256) &&
        body.recognized_amount === 0 &&
        body.available_amount === 0 &&
        body.external_execution === false) {
      clearPendingKey(currentUserId, key);
      updatePendingUI();
      successfulSubmission = true;
      byId("submit-button").disabled = true;
      byId("claim-id").textContent = body.claim_id;
      byId("document-object-id").textContent = body.document_object_id;
      byId("document-hash").textContent = body.document_sha256;
      byId("result").hidden = false;
      showStatus("Previous submission is confirmed: claim and document link exist. Recognized and available amounts remain $0.", "success");
      return;
    }
    showStatus("A claim record exists, but its document link is not confirmed. Reattach the exact same original file and submit with the same metadata; do not create a new key.", "error");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "STATUS_LOOKUP_FAILED", "error");
  } finally {
    byId("check-status-button").disabled = false;
  }
}
async function signIn(event) {
  event.preventDefault();
  byId("login-button").disabled = true;
  try {
    if (!CONFIG.url || !CONFIG.key) throw new Error("Application Supabase configuration is missing.");
    const response = await fetch(CONFIG.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: CONFIG.key, "content-type": "application/json" },
      body: JSON.stringify({ email: byId("email").value.trim(), password: byId("password").value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token || !data.user?.id) throw new Error(data.msg || data.message || "Sign-in failed.");
    const roleResponse = await fetch(CONFIG.url + "/rest/v1/rpc/has_role", {
      method: "POST",
      headers: { apikey: CONFIG.key, Authorization: "Bearer " + data.access_token, "content-type": "application/json" },
      body: JSON.stringify({ _user_id: data.user.id, _role: "admin" })
    });
    const isAdmin = await roleResponse.json().catch(() => false);
    if (!roleResponse.ok || isAdmin !== true) throw new Error("Administrator access is required.");
    accessToken = data.access_token;
    currentUserId = data.user.id;
    byId("password").value = "";
    byId("login-panel").hidden = true;
    byId("intake-panel").hidden = false;
    updatePendingUI();
  } catch (error) {
    showLoginError(error instanceof Error ? error.message : "Sign-in failed.");
  } finally {
    byId("login-button").disabled = false;
  }
}
function showLoginError(message) {
  let node = byId("login-error");
  if (!node) {
    node = document.createElement("p");
    node.id = "login-error";
    node.className = "error";
    byId("login-form").appendChild(node);
  }
  node.textContent = message;
}
async function submitIntake(event) {
  event.preventDefault();
  if (successfulSubmission) {
    showStatus("Clear the form before starting another claim.", "error");
    return;
  }
  byId("submit-button").disabled = true;
  byId("result").hidden = true;
  try {
    if (!accessToken || !currentUserId) throw new Error("Sign in and verify administrator access first.");
    const file = byId("document").files?.[0];
    if (!file || file.size <= 0 || file.size > 15 * 1024 * 1024) throw new Error("Attach a document between 1 byte and 15 MB.");
    const creditorEin = byId("creditor-ein").value.trim();
    const debtorEin = byId("debtor-ein").value.trim();
    if (creditorEin.replace(/-/g, "") === debtorEin.replace(/-/g, "")) throw new Error("Creditor and debtor EINs must be different.");
    if (!byId("assignment-ref").value.trim() || !byId("provenance").value.trim()) throw new Error("Assignment evidence and source provenance are required.");
    const key = readPendingKey(currentUserId) || "b2b-" + crypto.randomUUID();
    storePendingKey(currentUserId, key);
    updatePendingUI();
    const metadata = {
      creditor_corporate_ein: creditorEin,
      debtor_corporate_ein: debtorEin,
      invoice_face_value: byId("face-value").value,
      currency_code: "USD",
      net_payment_terms: byId("terms").value,
      maturity_date: byId("maturity").value,
      assignment_clause_present: byId("assignment-clause").checked,
      assignment_evidence_ref: byId("assignment-ref").value.trim(),
      source_provenance: byId("provenance").value.trim(),
      idempotency_key: key
    };
    const form = new FormData();
    form.set("document", file, file.name);
    form.set("metadata", JSON.stringify(metadata));
    const response = await fetch("/api/private/b2b-intake", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken },
      body: form,
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || response.status !== 201) {
      const detail = body.field ? (body.error || "INTAKE_FAILED") + " (" + body.field + ")" : (body.error || "HTTP_" + response.status);
      throw new Error(detail);
    }
    if (typeof body.claim_id !== "string" || !body.claim_id ||
        typeof body.document_object_id !== "string" || !body.document_object_id ||
        typeof body.document_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.document_sha256) ||
        body.original_document_stored !== true || body.external_execution !== false ||
        body.recognized_amount !== 0 || body.available_amount !== 0) {
      throw new Error("INTAKE_RESPONSE_INCOMPLETE_RETRY_SAME_IDEMPOTENCY_KEY");
    }
    clearPendingKey(currentUserId, key);
    updatePendingUI();
    successfulSubmission = true;
    byId("submit-button").disabled = true;
    byId("claim-id").textContent = body.claim_id;
    byId("document-object-id").textContent = body.document_object_id;
    byId("document-hash").textContent = body.document_sha256;
    byId("result").hidden = false;
    showStatus("Claim stored for review. Recognized and available amounts remain $0.", "success");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "INTAKE_FAILED", "error");
  } finally {
    byId("submit-button").disabled = successfulSubmission;
  }
}
byId("login-form").addEventListener("submit", signIn);
byId("intake-form").addEventListener("submit", submitIntake);
byId("check-status-button").addEventListener("click", checkPendingStatus);
byId("signout-button").addEventListener("click", () => {
  accessToken = "";
  currentUserId = "";
  successfulSubmission = false;
  byId("submit-button").disabled = false;
  byId("intake-form").reset();
  byId("result").hidden = true;
  byId("status").hidden = true;
  byId("intake-panel").hidden = true;
  byId("login-panel").hidden = false;
  byId("password").value = "";
});
byId("clear-button").addEventListener("click", () => {
  if (readPendingKey(currentUserId)) {
    showStatus("Retry the same submission before starting a new claim.", "error");
    return;
  }
  byId("intake-form").reset();
  successfulSubmission = false;
  byId("submit-button").disabled = false;
  byId("status").hidden = true;
  byId("result").hidden = true;
});
if (!CONFIG.url || !CONFIG.key) {
  showLoginError(CONFIG.urlMismatch ? "Application Supabase URL settings conflict. Contact the administrator." : "Application Supabase configuration is missing. Contact the administrator.");
  byId("login-button").disabled = true;
}
</script>
</body>
</html>`;
});
