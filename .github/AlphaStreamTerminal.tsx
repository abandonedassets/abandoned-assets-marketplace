import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Deal {
  id: string;
  address: string;
  status: string;
  gross_arbitrage_spread: number;
  contract_status: string;
}

export default function AlphaStreamTerminal() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDeals = async () => {
      setLoading(true);
      // Querying the confirmed table 'deals_master'
      const { data, error } = await supabase
        .from('deals_master')
        .select('id, address, status, gross_arbitrage_spread, contract_status')
        .or('status.ilike.%escrow%,status.ilike.%pending%');
      
      if (error) {
        console.error("Error fetching deals:", error);
      } else if (data) {
        setDeals(data);
      }
      setLoading(false);
    };

    fetchDeals();
  }, []);

  if (loading) return <div className="p-4 text-white">Loading Terminal...</div>;

  return (
    <div className="w-full p-6 bg-black min-h-screen text-white">
      <h1 className="text-2xl font-bold mb-6">Alpha Stream Terminal</h1>
      
      <table className="w-full text-left border-collapse border border-gray-800">
        <thead>
          <tr className="bg-gray-900 border-b border-gray-700 text-gray-400 uppercase text-xs tracking-wider">
            <th className="p-4">Address</th>
            <th className="p-4">Status</th>
            <th className="p-4">Contract</th>
            <th className="p-4">Spread</th>
          </tr>
        </thead>
        <tbody>
          {deals.length > 0 ? (
            deals.map((deal) => (
              <tr key={deal.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td className="p-4 font-medium">{deal.address}</td>
                <td className="p-4 text-blue-400 capitalize">{deal.status}</td>
                <td className="p-4">{deal.contract_status}</td>
                <td className="p-4 text-green-400">${deal.gross_arbitrage_spread?.toLocaleString()}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="p-8 text-center text-gray-500">No escrow/pending deals found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
