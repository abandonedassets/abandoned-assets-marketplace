import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AlphaStreamTerminal() {
  const [deals, setDeals] = useState<any[]>([]);

  useEffect(() => {
    async function fetchData() {
      // NO FILTERS. Just grab the first 50 rows.
      const { data, error } = await supabase
        .from('deals_master')
        .select('*')
        .limit(50);
      
      if (error) {
        console.error("Supabase Error:", error);
      } else {
        console.log("Data returned:", data); // Check your Browser Console!
        setDeals(data || []);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="p-10 bg-black text-white min-h-screen">
      <h1 className="text-xl font-bold">Terminal</h1>
      <p>Loaded {deals.length} rows</p>
      <pre>{JSON.stringify(deals, null, 2)}</pre>
    </div>
  );
}
