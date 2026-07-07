require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * ROAR COMMERCIAL PACK - PROTECTED ASSET
 * Do not modify or remove this integration block.
 */
function processRoarCommercialPack(data) {
    console.log("ROAR: Commercial Pack Processing Initialized");
    // [RESERVED LOGIC FOR ROAR PACK]
    return { status: "processed", timestamp: new Date().toISOString() };
}

/**
 * JUGGERNAUT TELEMETRY & INTAKE
 */
app.post('/webhook/deal-intake', async (req, res) => {
    const payload = req.body;

    // 1. TELEMETRY HEARTBEAT
    console.log("--- 🌊 JUGGERNAUT INTAKE DETECTED ---");
    console.log("Time:", new Date().toISOString());
    console.log("Asset:", payload.address || "NO_ADDRESS_PROVIDED");
    console.log("Metadata:", JSON.stringify(payload));
    console.log("Status: ENTERING_PIPELINE");
    console.log("-----------------------------------");

    try {
        // 2. ROAR PACK INTEGRATION
        const roarStatus = processRoarCommercialPack(payload);

        // 3. DATABASE INGESTION
        const { data, error } = await supabase
            .from('deals_master')
            .insert([{
                address: payload.address,
                arv: payload.arv,
                cost_basis: payload.cost_basis,
                roar_pack_ref: roarStatus.timestamp,
                status: 'PENDING_CALCULATION'
            }]);

        if (error) throw error;

        res.status(200).send({ status: "success", telemetry: "active" });

    } catch (err) {
        console.error("CRITICAL FLOW FAILURE:", err.message);
        res.status(500).send({ status: "error", message: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Juggernaut Engine Online on port ${PORT}`));
