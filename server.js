async function validateAndUpsert(dealData) {
    // 1. Hard Protection: Never overwrite protected assets
    if (dealData.id === 'roar-protected-id') { 
        console.log("Protecting Roar Commercial Pack...");
        return; 
    }

    // 2. Sniper Validation: Sanity check the numbers
    if (dealData.deal_value > 100000000 || dealData.deal_value < 1000) {
        throw new Error("Data Out of Range: Sanity check failed.");
    }

    // 3. Execution
    await supabase.from('qre_institutional_deal_tape').upsert(dealData);
}
