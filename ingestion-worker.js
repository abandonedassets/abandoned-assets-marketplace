const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { extractAllFields } = require('./extractors/deterministic-extraction');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const CONFIDENCE_THRESHOLD = 0.80;

const runIngestion = async () => {
    console.log('[INGESTION] Radar Scanning: Checking Storage & Database...');
    try {
        // 1. Fetch documents from Supabase Storage (bucket: documents)
        const { data: storageFiles, error: storageError } = await supabase.storage.from('documents').list('', { limit: 100 });
        
        // 2. Fetch documents from local folder (./uploads)
        const localUploadsPath = path.join(__dirname, 'uploads');
        let localFiles = [];
        if (fs.existsSync(localUploadsPath)) {
            localFiles = fs.readdirSync(localUploadsPath).filter(f => f.endsWith('.pdf') || f.endsWith('.txt'));
        }

        const allDocuments = [
            ...(storageFiles || []).map(f => ({ name: f.name, source: 'supabase' })),
            ...localFiles.map(f => ({ name: f, source: 'local' }))
        ];

        console.log(`[INGESTION] Radar Tracking: ${allDocuments.length} documents detected.`);

        for (const doc of allDocuments) {
            // Idempotency Check: Has this document been processed?
            const { data: existing } = await supabase
                .from('document_extractions')
                .select('id')
                .eq('source_document', doc.name)
                .limit(1);

            if (existing && existing.length > 0) continue;

            console.log(`[INGESTION] Processing: ${doc.name}`);
            
            // Get content (simulating PDF text extraction for this refactor)
            let content = "";
            if (doc.source === 'local') {
                content = fs.readFileSync(path.join(localUploadsPath, doc.name), 'utf8');
            } else {
                const { data: blob } = await supabase.storage.from('documents').download(doc.name);
                if (blob) content = await blob.text();
            }

            const extractions = extractAllFields(content, doc.name);
            
            // Map to deals_master (find deal by address in doc name or content)
            const { data: deal } = await supabase.from('deals_master').select('id').ilike('address', `%${doc.name.split('.')[0]}%`).limit(1).single();

            if (deal) {
                for (const [field, result] of Object.entries(extractions)) {
                    // 1. Populate document_extractions
                    await supabase.from('document_extractions').insert({
                        deal_id: deal.id,
                        field_name: field,
                        field_value: result.value,
                        matched_text: result.matched_text,
                        source_document: doc.name,
                        page_number: result.page,
                        confidence: result.confidence,
                        review_required: result.review_required
                    });

                    // 2. Update deals_master only if confidence >= threshold
                    if (result.confidence >= CONFIDENCE_THRESHOLD && result.value) {
                        const updateObj = {};
                        if (field === 'closing_date') updateObj.target_closing_date = result.value;
                        if (field === 'buyer') updateObj.buyer_name = result.value; // Assuming column exists
                        
                        if (Object.keys(updateObj).length > 0) {
                            await supabase.from('deals_master').update(updateObj).eq('id', deal.id);
                        }
                    }
                }
            }
        }
        console.log('[INGESTION] Reality Sync Complete.');
    } catch (e) {
        console.error('[INGESTION] Engine Stall:', e.message);
    }
};

setInterval(runIngestion, 5 * 60 * 1000);
runIngestion();
