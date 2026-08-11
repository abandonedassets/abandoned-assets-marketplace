import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/_authenticated/admin/institutional-data-room')({
  component: InstitutionalDataRoomComponent,
});

function InstitutionalDataRoomComponent() {
  const [lenderStatus, setLenderStatus] = useState<Record<string, string>>({
    'Live Oak SBA Pipeline': 'Term Sheet Issued',
    'Private Credit DSCR Facility': 'Term Sheet Issued',
    'Regional Commercial Bank': 'Term Sheet Issued',
    'Asset-Backed Institutional Fund': 'DECLINED / ACCESS REVOKED',
  });

  const [dealTape, setDealTape] = useState([
    { id: 'e5a207ea', class: 'SFR', val: '$25,157,500.00', status: 'UNVERIFIED', hash: '—' },
    { id: '3316 S 3RD ST [1031-PROBABLE]', class: 'SFR', val: '$8,426,598.00', status: 'UNVERIFIED', hash: '—' },
    { id: '3C8122c6', class: 'SFR', val: '$7,715,000.00', status: 'UNVERIFIED', hash: '—' },
    { id: '301 W MISSISSIPPI AVE [1031-PROBABLE]', class: 'SFR', val: '$7,475,600.00', status: 'UNVERIFIED', hash: '—' },
    { id: '1504 SEABREEZE AVE [1031-PROBABLE]', class: 'SFR', val: '$5,465,865.00', status: 'UNVERIFIED', hash: '—' },
    { id: '8109 PELHAM DR, PARMA, OH', class: 'Infill-Lot', val: '$5,332,800.00', status: 'UNVERIFIED', hash: '—' },
    { id: '13558 CEDAR RD, UNIVERSITY HEIGHTS, OH', class: 'Infill-Lot', val: '$5,332,800.00', status: 'UNVERIFIED', hash: '—' },
    { id: '1222 E 16TH AVE [1031-PROBABLE]', class: 'SFR', val: '$5,116,800.00', status: 'UNVERIFIED', hash: '—' },
  ]);

  const handleBroadcast = () => {
    setLenderStatus({
      'Live Oak SBA Pipeline': 'Term Sheet Issued',
      'Private Credit DSCR Facility': 'Term Sheet Issued',
      'Regional Commercial Bank': 'Term Sheet Issued',
      'Asset-Backed Institutional Fund': 'DECLINED / ACCESS REVOKED',
    });
  };

  const handleAccept = (acceptedLender: string) => {
    setLenderStatus((prev) => {
      const nextState: Record<string, string> = {};
      Object.keys(prev).forEach((lender) => {
        nextState[lender] = lender === acceptedLender ? 'ACCEPTED / EXECUTED' : 'DECLINED / ACCESS REVOKED';
      });
      return nextState;
    });
  };

  const handleBulkAudit = () => {
    setDealTape((prev) =>
      prev.map((item) => ({
        ...item,
        status: 'AUDITED COLLATERAL',
        hash: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
      }))
    );
  };

  // Client-side CSV export (no fetch, no backend dependency)
  const handleExportCSV = () => {
    const headers = ["Commit Hash", "Timestamp", "Author", "Hours", "Hourly Rate", "Capitalized Value", "Module Description"];
    const sampleRows = [
      ["c8f1a23", "2026-08-10 18:30:00", "Lead Architect", "2.5", "$150.00", "$375.00", "Core ESCROW Deal Tape Pipeline"],
      ["e5a207e", "2026-08-10 15:12:00", "Senior Engineer", "4.0", "$150.00", "$600.00", "GAAP ASC 350-40 Balance Sheet Engine"],
      ["3c8122c", "2026-08-09 21:05:00", "DevOps Lead", "3.0", "$150.00", "$450.00", "HMAC-SHA256 Cryptographic Hash Verification"]
    ];

    // Escape double-quotes by doubling them (CSV RFC)
    const escapeCell = (val: string) => `"${val.replace(/"/g, '""')}"`;

    const csvString = [
      headers.join(","),
      ...sampleRows.map(row => row.map(val => escapeCell(val)).join(","))
    ].join("\n");

    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "system_audit_commit_ledger.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 bg-slate-950 text-white min-h-screen space-y-6 font-mono">
      {/* Lender Syndication Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <h1 className="text-sm font-bold tracking-widest uppercase text-slate-200">
            AUTONOMOUS LENDER SYNDICATION & TERM SHEET ENGINE
          </h1>
          <button
            onClick={handleBroadcast}
            className="bg-white text-slate-950 hover:bg-slate-200 px-4 py-2 text-xs font-bold rounded shadow transition"
          >
            Broadcast Package to Lender Network
          </button>
        </div>

        <div className="space-y-2">
          {Object.entries(lenderStatus).map(([lender, status]) => (
            <div key={lender} className="flex justify-between items-center bg-slate-950 p-3 rounded border border-slate-800/60 text-xs">
              <span className="font-semibold text-slate-300">{lender}</span>
              <div className="flex items-center space-x-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  status === 'ACCEPTED / EXECUTED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  status === 'Term Sheet Issued' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                  'bg-red-950/40 text-red-400 border border-red-900/40'
                }`}>
                  {status}
                </span>
                {status === 'Term Sheet Issued' && (
                  <button
                    onClick={() => handleAccept(lender)}
                    className="bg-slate-100 hover:bg-white text-slate-950 px-3 py-1 font-bold rounded transition"
                  >
                    Accept & Lock Facility
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deal Tape & Bulk Audit */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <h2 className="text-sm font-bold tracking-widest uppercase text-slate-200">
            ACTIVE DEAL TAPE ({dealTape.length} of {dealTape.length})
          </h2>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleBulkAudit}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-bold rounded shadow transition"
            >
              Audit & Lock Title Hashes (All {dealTape.length})
            </button>

            {/* Export Commit Ledger (CSV) button wired to client-side generator */}
            <button
              onClick={handleExportCSV}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 text-xs font-bold rounded shadow transition"
            >
              Export Commit Ledger (CSV)
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {dealTape.map((item) => (
            <div key={item.id} className="flex justify-between items-center text-xs py-2 px-3 bg-slate-950/60 rounded border border-slate-800/40">
              <span className="w-1/3 font-medium text-slate-300 truncate">{item.id}</span>
              <span className="w-1/6 text-slate-400">{item.class}</span>
              <span className="w-1/6 text-slate-200">{item.val}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                item.status === 'AUDITED COLLATERAL' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
              }`}>
                {item.status}
              </span>
              <span className="w-1/4 text-right font-mono text-[11px] text-slate-500">{item.hash}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
