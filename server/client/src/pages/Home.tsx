import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Home() {
  const [form, setForm] = useState({ address:"", price:"", arv:"", apn:"" });
  const submit = trpc.seller.submit.useMutation({
    onSuccess: (d) => {
      toast.success(`Routed to ${d.pipeline === "juggernaut" ? "⚡ Juggernaut" : "🌲 Ironclad Asset"}`);
    },
  });
  const { data: feed } = trpc.deals.feed.useQuery();

  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-3xl font-black mb-8 gold-shimmer">Juggernaut Acquisition Engine</h1>
      
      <div className="bg-card border p-6 rounded-xl max-w-lg mb-10">
        <h2 className="font-bold mb-4">Submit Property</h2>
        <form onSubmit={e => { e.preventDefault(); submit.mutate({ address: form.address, price: form.price ? parseFloat(form.price) : undefined, arv: form.arv ? parseFloat(form.arv) : undefined, apn: form.apn || undefined }); }} className="flex flex-col gap-4">
          <Input placeholder="Address" value={form.address} onChange={e => setForm(f => ({...f,address:e.target.value}))} required />
          <Input type="number" placeholder="Asking Price" value={form.price} onChange={e => setForm(f => ({...f,price:e.target.value}))} />
          <Button type="submit" className="bg-[var(--color-gold)] text-black font-bold">Run Valuation Engine</Button>
        </form>
      </div>

      <div className="grid gap-4">
        {feed?.items.map((item: any) => (
          <div key={item.id} className="border p-4 rounded-lg flex justify-between">
            <div>{item.address}</div>
            <div className="font-bold text-[var(--color-emerald)]">+${item.gross_arbitrage_spread?.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
