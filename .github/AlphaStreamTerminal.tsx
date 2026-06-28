import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient'; // Adjust path if needed

export default function AlphaStreamTerminal() {
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<string>('');

  useEffect(() => {
    const fetchDeals = async () => {
      setLoading(true);
      // Fetch everything without filters to see if we get anything
      const { data, error } = await supabase
        .from('deals_master')
        .select('*')
        .limit(5); // Just grab 5 to test
      
      if (error) {
        setDebug("ERROR: " + JSON.stringify(error));
        console.error("Supabase Error:", error);
      } else {
        setDeals(data || []);
        setDebug("Fetched " + data?.length + " rows.");
      }
      setLoading(false);
    };

    fetchDeals();
  }, []);

  return (
    <div className="p-10 bg-black text-white min-h-screen">
      <h1 className="text-xl font-bold">Diagnostic Mode</h1>
      <p className="text-yellow-400">Status: {debug}</p>
      
      <div className="mt-4 p-4 bg-gray-900 font-mono text-xs overflow-auto">
        <pre>{JSON.stringify(deals, null, 2)}</pre>
      </div>
    </div>
  );
}
