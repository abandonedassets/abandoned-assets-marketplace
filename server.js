const { data, error } = await supabase
  .from('qre_institutional_deal_tape')
  .upsert([
    { 
      id: dealData.id, 
      deal_name: dealData.name, 
      deal_value: dealData.value, 
      assignment_fee: dealData.fee, 
      status: dealData.status 
    }
  ], { onConflict: 'id' });

if (error) console.error("Upsert Failed:", error);
