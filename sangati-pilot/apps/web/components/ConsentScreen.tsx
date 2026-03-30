import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

interface ConsentScreenProps {
  venueId: string;
  onAccepted: () => void;
}

export function ConsentScreen({ venueId, onAccepted }: ConsentScreenProps) {
  const [name, setName]       = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!name.trim() || !checked) return;
    setLoading(true);
    await fetch(`${API}/api/compliance/consent`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ venue_id: venueId, accepted_by: name.trim(), version: '1.0' }),
    });
    onAccepted();
  };

  return (
    <div className="fixed inset-0 bg-[#040608] flex items-center justify-center p-6 z-50">
      <div className="max-w-lg w-full bg-[#0D1120] border border-[#1C2340] rounded-2xl p-8">

        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">&#x1F6E1;</span>
          <div>
            <h1 className="text-xl font-bold text-white">SANGATI Setup</h1>
            <p className="text-gray-400 text-sm">Data Collection Notice — Required Before Use</p>
          </div>
        </div>

        <div className="bg-[#111828] rounded-xl p-5 mb-6 text-sm text-gray-300 space-y-3">
          <p><strong className="text-white">What SANGATI collects:</strong></p>
          <ul className="space-y-1.5 list-none">
            <li>&#x2713; Table session timing events (seat, order, serve, bill, pay)</li>
            <li>&#x2713; Alert and acknowledgement timestamps</li>
            <li>&#x2713; Camera-based table occupancy (yes/no per table)</li>
          </ul>

          <p className="pt-2"><strong className="text-white">What SANGATI does NOT collect:</strong></p>
          <ul className="space-y-1.5 list-none">
            <li>&#x2715; No facial images or biometric data</li>
            <li>&#x2715; No guest names, phone numbers, or personal details</li>
            <li>&#x2715; No video footage stored or transmitted</li>
            <li>&#x2715; No data leaves this device</li>
          </ul>

          <p className="pt-2 text-xs text-gray-500">
            All data is stored locally on this device under your control.
            You may delete all data at any time from Setup &#x2192; Data Management.
            This system complies with the Digital Personal Data Protection Act 2023 (India).
          </p>
        </div>

        <div className="mb-5">
          <label className="block text-sm text-gray-400 mb-1.5">
            Restaurant owner / authorised person name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your full name"
            className="w-full bg-[#111828] border border-[#1C2340] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-teal-600"
          />
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 accent-teal-500"
          />
          <span className="text-sm text-gray-300">
            I confirm that camera monitoring has been disclosed to all staff members at this venue,
            and I accept SANGATI&apos;s terms of service and data collection practices described above.
          </span>
        </label>

        <button
          onClick={handleAccept}
          disabled={!name.trim() || !checked || loading}
          className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-[#1C2340] disabled:text-gray-600 text-white rounded-xl font-semibold text-sm transition-colors"
        >
          {loading ? 'Setting up…' : 'Accept & Start SANGATI'}
        </button>
      </div>
    </div>
  );
}
