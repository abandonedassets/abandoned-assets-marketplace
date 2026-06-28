import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Deal {
  id: string;
  address: string;
  status: string;
  optimized_acquisition_premium: number;
}

export default function AlphaStreamTerminal() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Initial Data Load
    const fetchDeals = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('closing_pipeline_items')
        .select('*')
        .in('status', ['Locked-Escrow-Pending', 'Buyer-Signed', 'In-Escrow']);
      
      if (error) {
        console.error("Error fetching deals:", error);
      } else if (data) {
        setDeals(data);
      }
      setLoading(false);
    };

    fetchDeals();

    // 2. Real-time Subscription Setup
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'closing_pipeline_items' }, 
        () => {
          fetchDeals(); // Refresh list immediately on DB change
        }
      )
      .subscribe();

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) return <div className="p-4 text-white">Loading Terminal...</div>;

  return (
    <div className="w-full p-6 bg-black min-h-screen text-white">
      <h1 className="text-2xl font-bold mb-6">Alpha Stream Terminal</h1>
      
      <table className="w-full text-left border-collapse border border-gray-800">
        <thead>
          <tr className="bg-gray-900 border-b border-gray-700 text-gray-400 uppercase text-xs tracking-wider">
            <th className="p-4">Asset Address</th>
            <th className="p-4">Status</th>
            <th className="p-4">Spread</th>
            <th className="p-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {deals.length > 0 ? (
            deals.map((deal) => (
              <tr key={deal.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="p-4 font-medium">{deal.address}</td>
                <td className="p-4 text-blue-400">{deal.status}</td>
                <td className="p-4 text-green-400">${deal.optimized_acquisition_premium?.toLocaleString()}</td>
                <td className="p-4 text-right">
                  <button 
                    onClick={() => console.log('Accelerating deal:', deal.id)}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold transition-all"
                  >
                    Accelerate
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="p-8 text-center text-gray-500">No active pipeline items found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
