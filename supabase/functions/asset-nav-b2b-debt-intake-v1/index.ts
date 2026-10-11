import { createClient } from "npm:@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://abandonedasset.online","https://www.abandonedasset.online"]);
function corsHeaders(req:Request):Record<string,string> {
 const origin=req.headers.get("Origin")??"";
 return {"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin",...(allowedOrigins.has(origin)?{"Access-Control-Allow-Origin":origin}:{})};
}
const bucket = "b2b-claim-source-documents";
const BRIDGE_PUBLIC_KEY_B64 = "3x3jqddrm93OG408SAU1uX4CkYcZ+nDoqLC2nFtzOew=";
const BRIDGE_MAX_SKEW_MS = 5 * 60 * 1000;
const allowedTypes = new Set(["application/pdf","image/png","image/jpeg","image/tiff","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword"]);
function reply(req:Request,status:number,body:Record<string,unknown>) { return new Response(JSON.stringify(body),{status,headers:corsHeaders(req)}); }
function hex(bytes:Uint8Array) { return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join(""); }
function signatureMatches(type:string, bytes:Uint8Array):boolean {
 const starts=(sig:number[])=>sig.every((b,i)=>bytes[i]===b);
 switch(type) {
  case "application/pdf": return new TextDecoder().decode(bytes.slice(0,5))==="%PDF-";
  case "image/png": return starts([137,80,78,71,13,10,26,10]);
  case "image/jpeg": return starts([255,216,255]);
  case "image/tiff": return starts([73,73,42,0])||starts([77,77,0,42])||starts([73,73,43,0])||starts([77,77,0,43]);
  case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return starts([80,75,3,4]);
  case "application/msword": return starts([208,207,17,224,161,177,26,225]);
  case "text/plain":
   if(bytes.includes(0)) return false;
   try { new TextDecoder("utf-8",{fatal:true}).decode(bytes); return true; } catch { return false; }
  default: return false;
 }
}
async function sha256(bytes:Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",asArrayBuffer(bytes)))); }
function decodeBase64(value:string):Uint8Array { return Uint8Array.from(atob(value),c=>c.charCodeAt(0)); }
function asArrayBuffer(value:Uint8Array):ArrayBuffer { const copy=new Uint8Array(value.byteLength); copy.set(value); return copy.buffer; }
async function verifyBridgeSignature(req:Request,body:Uint8Array):Promise<boolean> {
 const timestamp=req.headers.get("x-b2b-timestamp")??"";
 const signature=req.headers.get("x-b2b-signature")??"";
 const suppliedHash=(req.headers.get("x-b2b-body-sha256")??"").toLowerCase();
 if(!/^\d{13}$/.test(timestamp)||!/^[0-9a-f]{64}$/.test(suppliedHash)||!signature) return false;
 const issuedAt=Number(timestamp);
 if(!Number.isSafeInteger(issuedAt)||Math.abs(Date.now()-issuedAt)>BRIDGE_MAX_SKEW_MS) return false;
 const actualHash=await sha256(body);
 if(actualHash!==suppliedHash) return false;
 try {
  const publicKey=await crypto.subtle.importKey("raw",asArrayBuffer(decodeBase64(BRIDGE_PUBLIC_KEY_B64)),{name:"Ed25519"},false,["verify"]);
  const message=new TextEncoder().encode(["v1",timestamp,"POST","asset-nav-b2b-debt-intake-v1",actualHash].join("\n"));
  return await crypto.subtle.verify("Ed25519",publicKey,asArrayBuffer(decodeBase64(signature)),asArrayBuffer(message));
 } catch {
  return false;
 }
}
function canonicalJson(value:unknown):string {
 if(value===null||typeof value!=="object") return JSON.stringify(value);
 if(Array.isArray(value)) return "["+value.map(canonicalJson).join(",")+"]";
 const obj=value as Record<string,unknown>;
 return "{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonicalJson(obj[k])).join(",")+"}";
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders(req)});
 if(req.method!=="POST") return reply(req, 405,{error:"METHOD_NOT_ALLOWED"});
 const authHeader=req.headers.get("Authorization");
 if(!authHeader?.startsWith("Bearer ")) return reply(req, 401,{error:"AUTHENTICATION_REQUIRED"});
 const url=Deno.env.get("SUPABASE_URL"), serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!serviceKey) return reply(req, 503,{error:"SERVER_CONFIGURATION_INCOMPLETE"});
 const ct=(req.headers.get("content-type")??"").toLowerCase();
 if(!ct.includes("multipart/form-data")) return reply(req, 415,{error:"MULTIPART_FORM_DATA_REQUIRED",fields:["document","metadata"]});
 const lengthHeader=req.headers.get("content-length");
 if(lengthHeader===null) return reply(req, 411,{error:"CONTENT_LENGTH_REQUIRED"});
 const requestLength=Number(lengthHeader);
 if(!Number.isSafeInteger(requestLength)||requestLength<1) return reply(req, 400,{error:"INVALID_CONTENT_LENGTH"});
 if(requestLength>16*1024*1024) return reply(req, 413,{error:"REQUEST_SIZE_LIMIT_EXCEEDED"});
 let rawBody:Uint8Array;
 try { rawBody=new Uint8Array(await req.arrayBuffer()); } catch { return reply(req, 400,{error:"INVALID_REQUEST_BODY"}); }
 if(rawBody.byteLength!==requestLength) return reply(req, 400,{error:"CONTENT_LENGTH_MISMATCH"});
 if(!await verifyBridgeSignature(req,rawBody)) return reply(req, 401,{error:"BRIDGE_SIGNATURE_INVALID_OR_EXPIRED"});
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 let form:FormData;
 try { form=await new Response(asArrayBuffer(rawBody),{headers:{"content-type":req.headers.get("content-type")??""}}).formData(); } catch { return reply(req, 400,{error:"INVALID_MULTIPART_FORM"}); }
 const file=form.get("document"), metadataText=form.get("metadata");
 if(!(file instanceof File)||typeof metadataText!=="string") return reply(req, 400,{error:"DOCUMENT_AND_METADATA_REQUIRED"});
 if(file.size<=0||file.size>15*1024*1024) return reply(req, 413,{error:"DOCUMENT_SIZE_LIMIT_EXCEEDED"});
 const contentType=(file.type||"application/octet-stream").toLowerCase();
 if(!allowedTypes.has(contentType)) return reply(req, 415,{error:"UNSUPPORTED_DOCUMENT_TYPE"});
 let input:Record<string,unknown>;
 try { input=JSON.parse(metadataText); if(!input||typeof input!=="object"||Array.isArray(input)) throw new Error(); }
 catch { return reply(req, 400,{error:"METADATA_MUST_BE_JSON_OBJECT"}); }
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!signatureMatches(contentType,bytes)) return reply(req, 415,{error:"DOCUMENT_CONTENT_TYPE_SIGNATURE_MISMATCH"});
 const documentHash=await sha256(bytes);
 if(typeof input.source_document_sha256==="string"&&input.source_document_sha256.toLowerCase()!==documentHash) return reply(req, 422,{error:"SUPPLIED_HASH_MISMATCH",computed_sha256:documentHash});
 const forbidden=/\b(property|parcel|acreage|land bank|residential|foreclosure|zillow|realtor\.com|apn)\b/i;
 const textToCheck=[input.source_provenance,input.assignment_evidence_ref,input.document_description,file.name].filter(v=>typeof v==="string").join(" ");
 if(forbidden.test(textToCheck)) return reply(req, 422,{error:"REAL_ESTATE_INTAKE_NOT_SUPPORTED",computed_sha256:documentHash});
 for(const key of ["creditor_corporate_ein","debtor_corporate_ein","net_payment_terms","maturity_date","assignment_evidence_ref","source_provenance","idempotency_key"]) if(typeof input[key]!=="string"||!(input[key] as string).trim()) return reply(req, 422,{error:"REQUIRED_FIELD_MISSING",field:key});
 if(typeof input.assignment_clause_present!=="boolean") return reply(req, 422,{error:"ASSIGNMENT_CLAUSE_BOOLEAN_REQUIRED"});
 if(!(typeof input.invoice_face_value==="number"||typeof input.invoice_face_value==="string")) return reply(req, 422,{error:"FACE_VALUE_REQUIRED"});
 const payload:Record<string,unknown>={creditor_corporate_ein:input.creditor_corporate_ein,debtor_corporate_ein:input.debtor_corporate_ein,invoice_face_value:input.invoice_face_value,currency_code:input.currency_code??"USD",net_payment_terms:input.net_payment_terms,maturity_date:input.maturity_date,assignment_clause_present:input.assignment_clause_present,assignment_evidence_ref:input.assignment_evidence_ref,source_document_sha256:documentHash,source_provenance:input.source_provenance,idempotency_key:input.idempotency_key};
 payload.request_fingerprint=await sha256(new TextEncoder().encode(canonicalJson(payload)));
 const recordFailure=async(eventType:"DOCUMENT_UPLOAD_FAILED"|"DOCUMENT_LINK_FAILED",claimId:string,errorCode:"STORAGE_UPLOAD_ERROR"|"DOCUMENT_LINK_ERROR")=>{
   const {data,error}=await admin.rpc("asset_nav_b2b_intake_failure_v1",{p_event_type:eventType,p_claim_id:claimId,p_document_sha256:documentHash,p_error_code:errorCode});
   return !error && typeof data==="number";
 };
 const {data:claimResult,error:claimError}=await admin.rpc("asset_nav_b2b_claim_submit_v1",{p_claim:payload});
 if(claimError) return reply(req, claimError.code==="42501"?403:claimError.code==="23505"?409:claimError.code==="22023"?422:500,{error:"CLAIM_SUBMISSION_FAILED",code:claimError.code??null,document_sha256:documentHash});
 const claim=claimResult as Record<string,unknown>|null, claimId=claim?.claim_id;
 if(typeof claimId!=="string") return reply(req, 500,{error:"CLAIM_ID_MISSING_FROM_RPC_RESULT"});
 const objectPath=claimId+"/"+documentHash;
 const {error:uploadError}=await admin.storage.from(bucket).upload(objectPath,bytes,{contentType,upsert:true,cacheControl:"0"});
 if(uploadError) {
   const failureAuditRecorded=await recordFailure("DOCUMENT_UPLOAD_FAILED",claimId,"STORAGE_UPLOAD_ERROR");
   return reply(req, 502,{error:"CLAIM_RECORDED_DOCUMENT_UPLOAD_FAILED_RETRY_SAME_IDEMPOTENCY_KEY",claim_id:claimId,document_sha256:documentHash,failure_audit_recorded:failureAuditRecorded});
 }
 const {data:linkId,error:linkError}=await admin.rpc("asset_nav_b2b_document_link_v1",{p_claim_id:claimId,p_object_path:objectPath,p_sha256:documentHash,p_filename:file.name||"uploaded-document",p_content_type:contentType,p_byte_size:file.size});
 if(linkError) {
   const failureAuditRecorded=await recordFailure("DOCUMENT_LINK_FAILED",claimId,"DOCUMENT_LINK_ERROR");
   return reply(req, 502,{error:"DOCUMENT_UPLOADED_BUT_METADATA_LINK_FAILED_RETRY_SAME_IDEMPOTENCY_KEY",claim_id:claimId,document_sha256:documentHash,failure_audit_recorded:failureAuditRecorded});
 }
 return reply(req, 201,{claim_id:claimId,document_object_id:linkId,claim_status:claim?.claim_status,review_status:claim?.review_status,document_sha256:documentHash,original_document_stored:true,recognized_amount:0,available_amount:0,legal_assignability:"UNVERIFIED",external_execution:false});
});