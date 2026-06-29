
import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * AlphaStreamTerminal
 * 
 * A high-frequency trading style terminal for real-time real estate data.
 * Connects to Supabase Realtime for instant UI updates.
 * 
 * ROLE: Principal Quant UI/UX Architect
 */

interface PipelineItem {
  id: number;
  address: string;
  status: string;
  synthetic_yield: number;
}

// Robust Error Boundary style component for display
const TerminalError: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-black p-6">
    <div className="border-2 border-red-600 bg-red-900/20 p-8 rounded-lg shadow-[0_0_20px_rgba(220,38,38,0.3)]">
      <h2 className="text-red-500 font-mono text-2xl font-bold mb-4 uppercase tracking-tighter">
        Critical System Failure
      </h2>
      <p className="text-red-400 font-mono text-lg leading-relaxed max-w-md">
        {message}
      </p>
      <div className="mt-6 text-red-600 font-mono text-sm animate-pulse">
        RETRYING CONNECTION...
      </div>
    </div>
  </div>
);

const AlphaStreamTerminal: React.FC = () => {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pulsingCardId, setPulsingCardId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Initial Data Fetch (NASA-Level Read-Only)
    const fetchInitialData = async () => {
      try {
        setIsLoading(true);
        const { data, error: fetchError } = await supabase
          .from('closing_pipeline_items')
          .select('id, address, status, synthetic_yield');

        if (fetchError) throw fetchError;
        setItems(data || []);
      } catch (err: any) {
        setError(err.message || "Failed to establish database connection.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();

    // 2. Real-Time Subscription (Algorithmic Real-Time)
    const channel = supabase
      .channel('public:closing_pipeline_items')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'closing_pipeline_items' },
        (payload) => {
          console.log('Real-time update received:', payload);
          
          if (payload.eventType === 'INSERT') {
            const newItem = payload.new as PipelineItem;
            setItems(prev => [...prev, newItem]);
            triggerPulse(newItem.id);
          } 
          else if (payload.eventType === 'UPDATE') {
            const updatedItem = payload.new as PipelineItem;
            setItems(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
            triggerPulse(updatedItem.id);
          } 
          else if (payload.eventType === 'DELETE') {
            const deletedItem = payload.old as { id: number };
            setItems(prev => prev.filter(item => item.id !== deletedItem.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const triggerPulse = (id: number) => {
    setPulsingCardId(id);
    setTimeout(() => setPulsingCardId(null), 1000);
  };

  if (error) return <TerminalError message={error} />;

  return (
    <div className="min-h-screen bg-black text-gray-300 font-mono p-4 md:p-8 selection:bg-green-500/30">
      {/* Header Section */}
      <div className="mb-10 flex flex-col md:flex-row justify-between items-end border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-green-400 text-3xl font-black tracking-tighter uppercase italic">
            AlphaStream<span className="text-white">Terminal</span>
          </h1>
          <p className="text-gray-500 text-xs mt-1 uppercase tracking-widest">
            Supabase Realtime Feed // Closing Pipeline Items
          </p>
        </div>
        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-green-500 uppercase font-bold">Live Stream Active</span>
          </div>
          <div className="text-[10px] text-gray-600 border border-gray-800 px-2 py-1 rounded">
            GPU ACCELERATION: ON
          </div>
        </div>
      </div>

      {/* Grid Layout */}
      {isLoading && items.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-green-400 animate-pulse">
          INITIALIZING DATA STREAM...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`
                relative group bg-gray-900/40 border border-gray-800 p-5 rounded-sm
                transition-all duration-300 ease-out will-change-transform
                hover:scale-[1.02] hover:border-blue-500/50 hover:bg-gray-900/60
                animate-in fade-in slide-in-from-bottom-4 duration-700
                ${pulsingCardId === item.id ? 'ring-2 ring-blue-500 ring-opacity-100 border-blue-500 bg-blue-500/10' : ''}
              `}
              style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
            >
              {/* Card Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                  #{item.id.toString().padStart(4, '0')}
                </div>
                <div className={`
                  text-[9px] px-1.5 py-0.5 rounded font-bold uppercase
                  ${item.status === 'Active' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}
                `}>
                  {item.status}
                </div>
              </div>

              {/* Address */}
              <div className="text-sm font-bold text-white mb-6 line-clamp-2 min-h-[2.5rem] leading-tight group-hover:text-blue-400 transition-colors">
                {item.address}
              </div>

              {/* Yield Metric */}
              <div className="mt-auto pt-4 border-t border-gray-800/50 flex justify-between items-end">
                <div className="text-[10px] text-gray-500 uppercase font-bold">Synthetic Yield</div>
                <div className="text-xl font-black text-green-400 tabular-nums">
                  {(item.synthetic_yield * 100).toFixed(2)}%
                </div>
              </div>

              {/* Live Update Indicator */}
              {pulsingCardId === item.id && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <span className="text-[8px] text-blue-400 font-bold animate-pulse">UPDATE</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tailwind Animations & Global Styles */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-in {
          animation: fadeIn 0.5s ease-out forwards;
        }

        /* Hardware Acceleration Optimization */
        .will-change-transform {
          will-change: transform, border-color, background-color;
        }
      `}</style>
    </div>
  );
};

export default AlphaStreamTerminal;
