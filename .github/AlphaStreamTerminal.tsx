import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

interface Deal {
  id: string;
  address: string;
  status: string;
  // Add other fields as necessary from your schema
}

export default function AlphaStreamTerminal() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function fetchDatabaseData() {
      setLoading(true);
      setError(null);

      try {
        // STRICT READ-ONLY QUERY
        const { data, error: fetchError } = await supabase
          .from('deals_master')
          .select('id, address, status');

        if (fetchError) throw fetchError;
        
        // Ensure data is set to an array, even if empty
        setDeals(data as Deal[] || []);
      } catch (err: any) {
        console.error("Supabase Read Error:", err.message);
        setError("Failed to load assets: " + err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchDatabaseData();
  }, []);

  if (loading) return <div className="text-white p-10">Loading live assets...</div>;
  if (error) return <div className="text-red-500 p-10 font-bold">Error: {error}</div>;

  return (
    <div className="p-10 bg-black text-white min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Live Assets Terminal</h1>
      {deals.length === 0 ? (
        <p>No assets found in database.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deals.map((deal) => (
            <div key={deal.id} className="p-4 border border-gray-700 rounded bg-gray-900">
              <h2 className="text-lg font-semibold">{deal.address}</h2>
              <p className="text-blue-400">Status: {deal.status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
